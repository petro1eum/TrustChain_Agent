/**
 * Memory Storage Backend
 * In-browser storage using localStorage with a virtual filesystem layer.
 * Used when no Docker container or local folder is available (standalone mode).
 * 
 * Storage format in localStorage:
 *   tc_vfs:{path} → file content (string)
 *   tc_vfs_meta:{path} → JSON metadata (size, modified, type)
 *   tc_vfs_dir:{path} → JSON array of child names
 */

import type { StorageBackend, FileEntry, FileStat, StorageUsage } from '../types';

const PREFIX = 'tc_vfs:';
const META_PREFIX = 'tc_vfs_meta:';
const DIR_PREFIX = 'tc_vfs_dir:';

interface FileMeta {
    type: 'file' | 'directory';
    size: number;
    modified: number;
    created: number;
}

export class MemoryBackend implements StorageBackend {
    readonly type = 'memory' as const;

    async init(): Promise<void> {
        // Ensure root directories exist
        const rootDirs = ['config', 'uploads', 'outputs', 'transcripts', 'skills'];
        for (const dir of rootDirs) {
            await this.ensureDir(dir);
        }
    }

    async read(path: string): Promise<string> {
        const key = PREFIX + this.normalizePath(path);
        const content = localStorage.getItem(key);
        if (content === null) {
            throw new Error(`File not found: ${path}`);
        }
        return content;
    }

    async write(path: string, content: string): Promise<void> {
        const p = this.normalizePath(path);
        const parts = p.split('/');

        // Ensure parent directories exist
        if (parts.length > 1) {
            const parentPath = parts.slice(0, -1).join('/');
            await this.ensureDir(parentPath);
        }

        // Write file content
        localStorage.setItem(PREFIX + p, content);

        // Write metadata
        const meta: FileMeta = {
            type: 'file',
            size: new Blob([content]).size,
            modified: Date.now(),
            created: this.getMeta(p)?.created || Date.now(),
        };
        localStorage.setItem(META_PREFIX + p, JSON.stringify(meta));

        // Register in parent directory
        if (parts.length > 1) {
            const parentPath = parts.slice(0, -1).join('/');
            const fileName = parts[parts.length - 1];
            this.addToDir(parentPath, fileName);
        } else {
            this.addToDir('', parts[0]);
        }
    }

    async writeBinary(path: string, buffer: ArrayBuffer): Promise<void> {
        const p = this.normalizePath(path);
        const parts = p.split('/');

        // Ensure parent directories exist
        if (parts.length > 1) {
            const parentPath = parts.slice(0, -1).join('/');
            await this.ensureDir(parentPath);
        }

        // Convert ArrayBuffer to base64 string
        const bytes = new Uint8Array(buffer);
        let binary = '';
        // Process in chunks to avoid max call stack size exceeded
        for (let i = 0; i < bytes.byteLength; i += 8192) {
            binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)));
        }
        const b64 = btoa(binary);
        const content = `data:application/octet-stream;base64,${b64}`;

        // Write file content
        localStorage.setItem(PREFIX + p, content);

        // Write metadata
        const meta: FileMeta = {
            type: 'file',
            size: buffer.byteLength,
            modified: Date.now(),
            created: this.getMeta(p)?.created || Date.now(),
        };
        localStorage.setItem(META_PREFIX + p, JSON.stringify(meta));

        // Register in parent directory
        if (parts.length > 1) {
            const parentPath = parts.slice(0, -1).join('/');
            const fileName = parts[parts.length - 1];
            this.addToDir(parentPath, fileName);
        } else {
            this.addToDir('', parts[0]);
        }
    }

    async list(path: string): Promise<FileEntry[]> {
        const p = this.normalizePath(path);
        const dirKey = DIR_PREFIX + p;
        const childrenJson = localStorage.getItem(dirKey);
        if (!childrenJson) return [];

        const children: string[] = JSON.parse(childrenJson);
        const entries: FileEntry[] = [];

        for (const name of children) {
            const childPath = p ? `${p}/${name}` : name;
            const meta = this.getMeta(childPath);
            entries.push({
                name,
                path: childPath,
                type: meta?.type || 'file',
                size: meta?.size || 0,
                modified: meta?.modified || 0,
            });
        }

        return entries.sort((a, b) => {
            // Directories first, then alphabetical
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }

    async delete(path: string): Promise<void> {
        const p = this.normalizePath(path);
        const meta = this.getMeta(p);

        if (meta?.type === 'directory') {
            // Recursively delete children
            const children = await this.list(p);
            for (const child of children) {
                await this.delete(child.path);
            }
            localStorage.removeItem(DIR_PREFIX + p);
        } else {
            localStorage.removeItem(PREFIX + p);
        }

        localStorage.removeItem(META_PREFIX + p);

        // Remove from parent directory
        const parts = p.split('/');
        if (parts.length > 1) {
            const parentPath = parts.slice(0, -1).join('/');
            const fileName = parts[parts.length - 1];
            this.removeFromDir(parentPath, fileName);
        }
    }

    async exists(path: string): Promise<boolean> {
        const p = this.normalizePath(path);
        return this.getMeta(p) !== null;
    }

    async stat(path: string): Promise<FileStat> {
        const p = this.normalizePath(path);
        const meta = this.getMeta(p);
        if (!meta) throw new Error(`Path not found: ${path}`);
        return { path: p, ...meta };
    }

    async usage(): Promise<StorageUsage> {
        let used = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith('tc_vfs')) {
                used += (localStorage.getItem(key) || '').length * 2; // UTF-16
            }
        }
        return {
            used,
            quota: 5 * 1024 * 1024, // ~5MB localStorage limit
            backend: 'memory',
        };
    }

    // ── Helpers ──

    private normalizePath(path: string): string {
        return path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
    }

    private getMeta(path: string): FileMeta | null {
        const raw = localStorage.getItem(META_PREFIX + path);
        return raw ? JSON.parse(raw) : null;
    }

    private async ensureDir(path: string): Promise<void> {
        const p = this.normalizePath(path);
        if (!p) return;

        const parts = p.split('/');
        let current = '';

        for (const part of parts) {
            const parent = current;
            current = current ? `${current}/${part}` : part;

            const meta = this.getMeta(current);
            if (!meta) {
                // Create directory
                localStorage.setItem(META_PREFIX + current, JSON.stringify({
                    type: 'directory',
                    size: 0,
                    modified: Date.now(),
                    created: Date.now(),
                } as FileMeta));

                // Initialize empty dir listing
                if (!localStorage.getItem(DIR_PREFIX + current)) {
                    localStorage.setItem(DIR_PREFIX + current, '[]');
                }

                // Register in parent
                this.addToDir(parent, part);
            }
        }
    }

    private addToDir(dirPath: string, name: string): void {
        const key = DIR_PREFIX + dirPath;
        const existing = localStorage.getItem(key);
        const children: string[] = existing ? JSON.parse(existing) : [];
        if (!children.includes(name)) {
            children.push(name);
            localStorage.setItem(key, JSON.stringify(children));
        }
    }

    private removeFromDir(dirPath: string, name: string): void {
        const key = DIR_PREFIX + dirPath;
        const existing = localStorage.getItem(key);
        if (existing) {
            const children: string[] = JSON.parse(existing);
            localStorage.setItem(key, JSON.stringify(children.filter(c => c !== name)));
        }
    }
}
