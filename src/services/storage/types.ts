/**
 * Storage Backend Types
 * Defines the interface for pluggable storage backends
 * (localStorage, Docker volume, local folder, Google Drive)
 */

export interface FileEntry {
    name: string;
    path: string;
    type: 'file' | 'directory';
    size: number;
    modified: number; // Unix timestamp ms
}

export interface FileStat {
    path: string;
    type: 'file' | 'directory';
    size: number;
    modified: number;
    created: number;
}

export interface StorageUsage {
    used: number;       // bytes
    quota: number;      // bytes (0 = unlimited)
    backend: StorageBackendType;
    mountPath?: string; // for local/docker backends
}

export type StorageBackendType = 'memory' | 'local-folder' | 'docker-volume' | 'google-drive';

export interface StorageBackend {
    readonly type: StorageBackendType;

    /** Initialize the backend (create dirs, verify access, etc.) */
    init(): Promise<void>;

    /** Read a file's contents as string */
    read(path: string): Promise<string>;

    /** Write string content to a file (creates parent dirs) */
    write(path: string, content: string): Promise<void>;

    /** Write binary content to a file (ArrayBuffer) */
    writeBinary(path: string, buffer: ArrayBuffer): Promise<void>;

    /** List entries in a directory */
    list(path: string): Promise<FileEntry[]>;

    /** Delete a file or directory */
    delete(path: string): Promise<void>;

    /** Check if a path exists */
    exists(path: string): Promise<boolean>;

    /** Get file/dir metadata */
    stat(path: string): Promise<FileStat>;

    /** Get usage stats */
    usage(): Promise<StorageUsage>;
}

/**
 * Standard user directory structure
 */
export const USER_DIRS = {
    config: 'config',          // policies.json, session.json, preferences.json
    uploads: 'uploads',        // user-uploaded files
    outputs: 'outputs',        // agent-generated artifacts
    transcripts: 'transcripts', // conversation logs
    skills: 'skills',          // custom user skills
} as const;

/**
 * Config keys stored in config/ directory
 */
export type ConfigKey = 'policies' | 'session' | 'preferences';
