/**
 * Google Drive Backend
 * Uses Google Drive API v3 as a storage backend.
 * 
 * Files are stored under a designated "TrustChain Agent" folder in the user's Drive.
 * Uses OAuth2 implicit grant flow for browser-based authentication.
 * 
 * Note: Requires a Google Cloud Project with:
 *   - Google Drive API enabled
 *   - OAuth2 client ID (web application type)
 *   - Authorized JavaScript origins matching the app's domain
 */

import type { StorageBackend, FileEntry, FileStat, StorageUsage } from '../types';

const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const ROOT_FOLDER_NAME = 'TrustChain Agent';

interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    size?: string;
    modifiedTime?: string;
    createdTime?: string;
}

export class GoogleDriveBackend implements StorageBackend {
    readonly type = 'google-drive' as const;

    private clientId: string;
    private accessToken: string | null = null;
    private rootFolderId: string | null = null;
    private folderCache = new Map<string, string>(); // path → Drive folder ID

    constructor(clientId?: string) {
        this.clientId = clientId || import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
    }

    // ── OAuth2 Flow ──

    /**
     * Initiate OAuth2 login via popup window.
     * Returns true if the user successfully authenticated.
     */
    async authenticate(): Promise<boolean> {
        if (!this.clientId) {
            throw new Error('Google OAuth Client ID not configured. Set VITE_GOOGLE_CLIENT_ID.');
        }

        // Check for stored token
        const stored = localStorage.getItem('tc_gdrive_token');
        if (stored) {
            try {
                const { token, expires } = JSON.parse(stored);
                if (expires > Date.now()) {
                    this.accessToken = token;
                    return true;
                }
            } catch { /* expired or corrupt */ }
        }

        return new Promise<boolean>((resolve) => {
            const redirectUri = `${window.location.origin}/oauth/callback`;
            const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
                `client_id=${encodeURIComponent(this.clientId)}` +
                `&redirect_uri=${encodeURIComponent(redirectUri)}` +
                `&response_type=token` +
                `&scope=${encodeURIComponent(SCOPES)}` +
                `&include_granted_scopes=true` +
                `&prompt=consent`;

            const popup = window.open(authUrl, 'gdrive-auth', 'width=500,height=600');

            // Listen for the OAuth callback
            const handler = (event: MessageEvent) => {
                if (event.origin !== window.location.origin) return;
                if (event.data?.type === 'oauth-callback') {
                    window.removeEventListener('message', handler);
                    const { access_token, expires_in } = event.data;
                    if (access_token) {
                        this.accessToken = access_token;
                        localStorage.setItem('tc_gdrive_token', JSON.stringify({
                            token: access_token,
                            expires: Date.now() + (parseInt(expires_in) || 3600) * 1000,
                        }));
                        resolve(true);
                    } else {
                        resolve(false);
                    }
                    popup?.close();
                }
            };
            window.addEventListener('message', handler);

            // Fallback: poll for popup close
            const pollTimer = setInterval(() => {
                if (popup?.closed) {
                    clearInterval(pollTimer);
                    window.removeEventListener('message', handler);
                    if (!this.accessToken) resolve(false);
                }
            }, 500);
        });
    }

    /**
     * Disconnect — clear stored token.
     */
    disconnect(): void {
        this.accessToken = null;
        this.rootFolderId = null;
        this.folderCache.clear();
        localStorage.removeItem('tc_gdrive_token');
    }

    get isAuthenticated(): boolean {
        return !!this.accessToken;
    }

    // ── Google Drive API Helpers ──

    private async driveRequest(
        endpoint: string,
        options: RequestInit = {},
    ): Promise<any> {
        if (!this.accessToken) throw new Error('Not authenticated with Google Drive');

        const url = endpoint.startsWith('http')
            ? endpoint
            : `https://www.googleapis.com/drive/v3${endpoint}`;

        const response = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                ...options.headers,
            },
        });

        if (!response.ok) {
            if (response.status === 401) {
                this.disconnect();
                throw new Error('Google Drive authentication expired. Please reconnect.');
            }
            const err = await response.text().catch(() => 'Unknown error');
            throw new Error(`Drive API error (${response.status}): ${err}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return response.json();
        }
        return response.text();
    }

    private async ensureRootFolder(): Promise<string> {
        if (this.rootFolderId) return this.rootFolderId;

        // Search for existing root folder
        const query = `name='${ROOT_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const result = await this.driveRequest(`/files?q=${encodeURIComponent(query)}&fields=files(id,name)`);

        if (result.files?.length > 0) {
            this.rootFolderId = result.files[0].id;
        } else {
            // Create it
            const folder = await this.driveRequest('/files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: ROOT_FOLDER_NAME,
                    mimeType: 'application/vnd.google-apps.folder',
                }),
            });
            this.rootFolderId = folder.id;
        }

        this.folderCache.set('', this.rootFolderId!);
        return this.rootFolderId!;
    }

    /**
     * Get or create a folder by path (e.g. "config" or "uploads/images").
     */
    private async getFolderId(path: string): Promise<string> {
        if (this.folderCache.has(path)) return this.folderCache.get(path)!;

        const parts = path.split('/').filter(Boolean);
        let parentId = await this.ensureRootFolder();

        let currentPath = '';
        for (const part of parts) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            if (this.folderCache.has(currentPath)) {
                parentId = this.folderCache.get(currentPath)!;
                continue;
            }

            // Search for subfolder
            const query = `name='${part}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
            const result = await this.driveRequest(`/files?q=${encodeURIComponent(query)}&fields=files(id)`);

            if (result.files?.length > 0) {
                parentId = result.files[0].id;
            } else {
                // Create subfolder
                const folder = await this.driveRequest('/files', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: part,
                        mimeType: 'application/vnd.google-apps.folder',
                        parents: [parentId],
                    }),
                });
                parentId = folder.id;
            }
            this.folderCache.set(currentPath, parentId);
        }

        return parentId;
    }

    // ── StorageBackend Interface ──

    async init(): Promise<void> {
        await this.ensureRootFolder();

        // Create standard directories
        const dirs = ['config', 'uploads', 'outputs', 'transcripts', 'skills'];
        for (const dir of dirs) {
            await this.getFolderId(dir);
        }
    }

    async read(path: string): Promise<string> {
        const normalized = path.replace(/^\/+|\/+$/g, '');
        const parts = normalized.split('/');
        const fileName = parts.pop()!;
        const dirPath = parts.join('/');

        const parentId = dirPath ? await this.getFolderId(dirPath) : await this.ensureRootFolder();

        // Find the file
        const query = `name='${fileName}' and '${parentId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
        const result = await this.driveRequest(`/files?q=${encodeURIComponent(query)}&fields=files(id)`);

        if (!result.files?.length) {
            throw new Error(`File not found: ${path}`);
        }

        // Download content
        const content = await this.driveRequest(`/files/${result.files[0].id}?alt=media`);
        return typeof content === 'string' ? content : JSON.stringify(content);
    }

    async write(path: string, content: string): Promise<void> {
        const normalized = path.replace(/^\/+|\/+$/g, '');
        const parts = normalized.split('/');
        const fileName = parts.pop()!;
        const dirPath = parts.join('/');

        const parentId = dirPath ? await this.getFolderId(dirPath) : await this.ensureRootFolder();

        // Check if file already exists
        const query = `name='${fileName}' and '${parentId}' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'`;
        const result = await this.driveRequest(`/files?q=${encodeURIComponent(query)}&fields=files(id)`);

        if (result.files?.length > 0) {
            // Update existing file
            await fetch(`https://www.googleapis.com/upload/drive/v3/files/${result.files[0].id}?uploadType=media`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': 'text/plain',
                },
                body: content,
            });
        } else {
            // Create new file using multipart upload
            const metadata = JSON.stringify({
                name: fileName,
                parents: [parentId],
            });

            const boundary = '---trustchain-boundary-' + Date.now();
            const body = [
                `--${boundary}`,
                'Content-Type: application/json; charset=UTF-8',
                '',
                metadata,
                `--${boundary}`,
                'Content-Type: text/plain',
                '',
                content,
                `--${boundary}--`,
            ].join('\r\n');

            await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`,
                },
                body,
            });
        }
    }

    async list(path: string): Promise<FileEntry[]> {
        const normalized = (path || '').replace(/^\/+|\/+$/g, '');
        const parentId = normalized ? await this.getFolderId(normalized) : await this.ensureRootFolder();

        const query = `'${parentId}' in parents and trashed=false`;
        const fields = 'files(id,name,mimeType,size,modifiedTime,createdTime)';
        const result = await this.driveRequest(`/files?q=${encodeURIComponent(query)}&fields=${fields}&orderBy=folder,name`);

        return (result.files || []).map((f: DriveFile) => ({
            name: f.name,
            path: normalized ? `${normalized}/${f.name}` : f.name,
            type: f.mimeType === 'application/vnd.google-apps.folder' ? 'directory' as const : 'file' as const,
            size: parseInt(f.size || '0', 10),
            modified: new Date(f.modifiedTime || 0).getTime(),
        }));
    }

    async delete(path: string): Promise<void> {
        const normalized = path.replace(/^\/+|\/+$/g, '');
        const parts = normalized.split('/');
        const fileName = parts.pop()!;
        const dirPath = parts.join('/');

        const parentId = dirPath ? await this.getFolderId(dirPath) : await this.ensureRootFolder();

        const query = `name='${fileName}' and '${parentId}' in parents and trashed=false`;
        const result = await this.driveRequest(`/files?q=${encodeURIComponent(query)}&fields=files(id)`);

        if (result.files?.length > 0) {
            await this.driveRequest(`/files/${result.files[0].id}`, { method: 'DELETE' });
        }
    }

    async exists(path: string): Promise<boolean> {
        try {
            const normalized = path.replace(/^\/+|\/+$/g, '');
            const parts = normalized.split('/');
            const fileName = parts.pop()!;
            const dirPath = parts.join('/');

            const parentId = dirPath ? await this.getFolderId(dirPath) : await this.ensureRootFolder();
            const query = `name='${fileName}' and '${parentId}' in parents and trashed=false`;
            const result = await this.driveRequest(`/files?q=${encodeURIComponent(query)}&fields=files(id)`);
            return result.files?.length > 0;
        } catch {
            return false;
        }
    }

    async stat(path: string): Promise<FileStat> {
        const normalized = path.replace(/^\/+|\/+$/g, '');
        const parts = normalized.split('/');
        const fileName = parts.pop()!;
        const dirPath = parts.join('/');

        const parentId = dirPath ? await this.getFolderId(dirPath) : await this.ensureRootFolder();
        const query = `name='${fileName}' and '${parentId}' in parents and trashed=false`;
        const fields = 'files(id,name,mimeType,size,modifiedTime,createdTime)';
        const result = await this.driveRequest(`/files?q=${encodeURIComponent(query)}&fields=${fields}`);

        if (!result.files?.length) {
            throw new Error(`Path not found: ${path}`);
        }

        const f: DriveFile = result.files[0];
        return {
            path,
            type: f.mimeType === 'application/vnd.google-apps.folder' ? 'directory' : 'file',
            size: parseInt(f.size || '0', 10),
            modified: new Date(f.modifiedTime || 0).getTime(),
            created: new Date(f.createdTime || 0).getTime(),
        };
    }

    async usage(): Promise<StorageUsage> {
        const about = await this.driveRequest('/about?fields=storageQuota');
        const quota = about.storageQuota || {};

        return {
            used: parseInt(quota.usageInDrive || '0', 10),
            quota: parseInt(quota.limit || '0', 10),
            backend: 'google-drive',
        };
    }
}
