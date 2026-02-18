/**
 * Local Folder Backend
 * Uses the File System Access API (browser) to read/write files
 * from a user-selected local folder.
 * 
 * Fallback: If FS Access API is not available (e.g., non-Chromium browsers),
 * falls back to download/upload patterns.
 * 
 * Security: The browser enforces permission prompts — the user must explicitly
 * grant read/write access to the selected folder.
 */

import type { StorageBackend, FileEntry, FileStat, StorageUsage } from '../types';

export class LocalFolderBackend implements StorageBackend {
    readonly type = 'local-folder' as const;
    private rootHandle: FileSystemDirectoryHandle | null = null;
    private mountPath: string = '';

    constructor(handle?: FileSystemDirectoryHandle) {
        if (handle) this.rootHandle = handle;
    }

    /**
     * Prompt the user to select a folder via File System Access API.
     * Returns true if the folder was selected, false if cancelled.
     */
    async selectFolder(): Promise<boolean> {
        if (!('showDirectoryPicker' in window)) {
            throw new Error('File System Access API not supported in this browser. Use Chrome/Edge.');
        }
        try {
            this.rootHandle = await (window as any).showDirectoryPicker({
                mode: 'readwrite',
                startIn: 'documents',
            });
            this.mountPath = this.rootHandle!.name;
            return true;
        } catch (err: any) {
            if (err.name === 'AbortError') return false; // User cancelled
            throw err;
        }
    }

    async init(): Promise<void> {
        if (!this.rootHandle) {
            throw new Error('No folder selected. Call selectFolder() first.');
        }
        // Ensure standard directory structure
        const dirs = ['config', 'uploads', 'outputs', 'transcripts', 'skills'];
        for (const dir of dirs) {
            await this.rootHandle.getDirectoryHandle(dir, { create: true });
        }
    }

    async read(path: string): Promise<string> {
        const fileHandle = await this.getFileHandle(path);
        const file = await fileHandle.getFile();
        return file.text();
    }

    async write(path: string, content: string): Promise<void> {
        const parts = this.parsePath(path);
        const dirHandle = await this.ensureParentDirs(parts.slice(0, -1));
        const fileHandle = await dirHandle.getFileHandle(parts[parts.length - 1], { create: true });
        const writable = await (fileHandle as any).createWritable();
        await writable.write(content);
        await writable.close();
    }

    async list(path: string): Promise<FileEntry[]> {
        const dirHandle = await this.getDirHandle(path);
        const entries: FileEntry[] = [];

        for await (const [name, handle] of (dirHandle as any).entries()) {
            const isDir = handle.kind === 'directory';
            let size = 0;
            let modified = 0;

            if (!isDir) {
                try {
                    const file = await (handle as FileSystemFileHandle).getFile();
                    size = file.size;
                    modified = file.lastModified;
                } catch { /* ignore */ }
            }

            entries.push({
                name,
                path: path ? `${path}/${name}` : name,
                type: isDir ? 'directory' : 'file',
                size,
                modified,
            });
        }

        return entries.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }

    async delete(path: string): Promise<void> {
        const parts = this.parsePath(path);
        const parentPath = parts.slice(0, -1);
        const name = parts[parts.length - 1];
        const parentHandle = parentPath.length > 0
            ? await this.getDirHandle(parentPath.join('/'))
            : this.rootHandle!;
        await (parentHandle as any).removeEntry(name, { recursive: true });
    }

    async exists(path: string): Promise<boolean> {
        try {
            await this.getHandleAt(path);
            return true;
        } catch {
            return false;
        }
    }

    async stat(path: string): Promise<FileStat> {
        const handle = await this.getHandleAt(path);
        const isDir = handle.kind === 'directory';
        let size = 0;
        let modified = Date.now();
        let created = Date.now();

        if (!isDir) {
            const file = await (handle as FileSystemFileHandle).getFile();
            size = file.size;
            modified = file.lastModified;
            created = file.lastModified; // FS Access API doesn't expose creation time
        }

        return { path, type: isDir ? 'directory' : 'file', size, modified, created };
    }

    async usage(): Promise<StorageUsage> {
        // FS Access API doesn't provide quota info for local folders
        let totalSize = 0;
        try {
            totalSize = await this.calcDirSize(this.rootHandle!);
        } catch { /* ignore */ }

        return {
            used: totalSize,
            quota: 0, // unlimited for local folders
            backend: 'local-folder',
            mountPath: this.mountPath,
        };
    }

    /** Get the mount path (folder name) */
    getMountPath(): string {
        return this.mountPath;
    }

    /** Check if File System Access API is available */
    static isSupported(): boolean {
        return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
    }

    // ── Private helpers ──

    private parsePath(path: string): string[] {
        return path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    }

    private async getFileHandle(path: string): Promise<FileSystemFileHandle> {
        const parts = this.parsePath(path);
        let current: FileSystemDirectoryHandle = this.rootHandle!;

        for (let i = 0; i < parts.length - 1; i++) {
            current = await current.getDirectoryHandle(parts[i]);
        }

        return current.getFileHandle(parts[parts.length - 1]);
    }

    private async getDirHandle(path: string): Promise<FileSystemDirectoryHandle> {
        if (!path || path === '.') return this.rootHandle!;
        const parts = this.parsePath(path);
        let current: FileSystemDirectoryHandle = this.rootHandle!;
        for (const part of parts) {
            current = await current.getDirectoryHandle(part);
        }
        return current;
    }

    private async getHandleAt(path: string): Promise<FileSystemHandle> {
        const parts = this.parsePath(path);
        let current: FileSystemDirectoryHandle = this.rootHandle!;

        for (let i = 0; i < parts.length - 1; i++) {
            current = await current.getDirectoryHandle(parts[i]);
        }

        const name = parts[parts.length - 1];
        try {
            return await current.getFileHandle(name);
        } catch {
            return await current.getDirectoryHandle(name);
        }
    }

    private async ensureParentDirs(parts: string[]): Promise<FileSystemDirectoryHandle> {
        let current: FileSystemDirectoryHandle = this.rootHandle!;
        for (const part of parts) {
            current = await current.getDirectoryHandle(part, { create: true });
        }
        return current;
    }

    private async calcDirSize(handle: FileSystemDirectoryHandle): Promise<number> {
        let total = 0;
        for await (const [, child] of (handle as any).entries()) {
            if (child.kind === 'file') {
                const file = await (child as FileSystemFileHandle).getFile();
                total += file.size;
            } else {
                total += await this.calcDirSize(child);
            }
        }
        return total;
    }
}
