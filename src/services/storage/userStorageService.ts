/**
 * User Storage Service
 * High-level service wrapping StorageBackend with config helpers.
 * Singleton — auto-detects available backend on first use.
 * 
 * Usage:
 *   import { userStorageService } from './userStorageService';
 *   
 *   // Config (replaces localStorage for policies, session, etc.)
 *   const policies = await userStorageService.getConfig<PolicyState>('policies');
 *   await userStorageService.setConfig('policies', { sign_all_outputs: true });
 *   
 *   // Files
 *   await userStorageService.writeFile('outputs/report.md', '# Report...');
 *   const files = await userStorageService.listDir('outputs');
 */

import type { StorageBackend, FileEntry, FileStat, StorageUsage, StorageBackendType, ConfigKey } from './types';
import { MemoryBackend } from './backends/memoryBackend';

type StorageListener = (key: ConfigKey, value: any) => void;

class UserStorageService {
    private backend: StorageBackend | null = null;
    private initPromise: Promise<void> | null = null;
    private listeners: StorageListener[] = [];

    /**
     * Get the current backend, initializing if needed.
     * Starts with MemoryBackend, can be swapped via setBackend().
     */
    private async getBackend(): Promise<StorageBackend> {
        if (!this.backend) {
            this.backend = new MemoryBackend();
            this.initPromise = this.backend.init();
        }
        if (this.initPromise) {
            await this.initPromise;
            this.initPromise = null;
        }
        return this.backend;
    }

    /**
     * Switch to a different storage backend.
     * Optionally migrate existing data from the current backend.
     */
    async setBackend(newBackend: StorageBackend, migrate = false): Promise<void> {
        const oldBackend = this.backend;

        await newBackend.init();

        if (migrate && oldBackend) {
            await this.migrateData(oldBackend, newBackend);
        }

        this.backend = newBackend;
        console.log(`[UserStorage] Switched to ${newBackend.type} backend`);
    }

    /** Get current backend type */
    getBackendType(): StorageBackendType {
        return this.backend?.type || 'memory';
    }

    // ── Config API (key-value, stored as JSON in config/ directory) ──

    async getConfig<T>(key: ConfigKey): Promise<T | null> {
        try {
            const backend = await this.getBackend();
            const content = await backend.read(`config/${key}.json`);
            return JSON.parse(content) as T;
        } catch {
            return null;
        }
    }

    async setConfig<T>(key: ConfigKey, value: T): Promise<void> {
        const backend = await this.getBackend();
        await backend.write(`config/${key}.json`, JSON.stringify(value, null, 2));

        // Notify listeners
        for (const listener of this.listeners) {
            try { listener(key, value); } catch { /* ignore */ }
        }
    }

    /**
     * Subscribe to config changes. Returns unsubscribe function.
     */
    onConfigChange(listener: StorageListener): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    // ── File API ──

    async readFile(path: string): Promise<string> {
        const backend = await this.getBackend();
        return backend.read(path);
    }

    async writeFile(path: string, content: string): Promise<void> {
        const backend = await this.getBackend();
        return backend.write(path, content);
    }

    async writeBinary(path: string, buffer: ArrayBuffer): Promise<void> {
        const backend = await this.getBackend();
        return backend.writeBinary(path, buffer);
    }

    async listDir(path: string): Promise<FileEntry[]> {
        const backend = await this.getBackend();
        return backend.list(path);
    }

    async deleteFile(path: string): Promise<void> {
        const backend = await this.getBackend();
        return backend.delete(path);
    }

    async exists(path: string): Promise<boolean> {
        const backend = await this.getBackend();
        return backend.exists(path);
    }

    async stat(path: string): Promise<FileStat> {
        const backend = await this.getBackend();
        return backend.stat(path);
    }

    async getUsage(): Promise<StorageUsage> {
        const backend = await this.getBackend();
        return backend.usage();
    }

    // ── Migration ──

    /**
     * Import existing localStorage config into the VFS.
     * Call this once when transitioning from localStorage to VFS.
     */
    async importFromLocalStorage(): Promise<{ imported: string[] }> {
        const imported: string[] = [];
        const backend = await this.getBackend();

        // Migrate policies
        const policiesRaw = localStorage.getItem('tc_policies');
        if (policiesRaw) {
            try {
                await backend.write('config/policies.json', policiesRaw);
                imported.push('policies');
            } catch { /* ignore */ }
        }

        // Migrate session config
        const model = localStorage.getItem('tc_model');
        const signer = localStorage.getItem('tc_signer');
        const tsa = localStorage.getItem('tc_tsa');
        if (model || signer || tsa) {
            const session = {
                model: model || 'google/gemini-2.5-flash',
                signer: signer || 'Ed25519',
                tsa: tsa || 'rfc3161.ai',
            };
            await backend.write('config/session.json', JSON.stringify(session, null, 2));
            imported.push('session');
        }

        console.log(`[UserStorage] Imported ${imported.length} configs from localStorage:`, imported);
        return { imported };
    }

    // ── Private ──

    private async migrateData(from: StorageBackend, to: StorageBackend): Promise<void> {
        const dirs = ['config', 'uploads', 'outputs', 'transcripts', 'skills'];

        for (const dir of dirs) {
            try {
                const entries = await from.list(dir);
                for (const entry of entries) {
                    if (entry.type === 'file') {
                        const content = await from.read(entry.path);
                        await to.write(entry.path, content);
                    }
                }
            } catch {
                // Directory might not exist in source, skip
            }
        }

        console.log('[UserStorage] Migration completed');
    }
}

/** Singleton instance */
export const userStorageService = new UserStorageService();
