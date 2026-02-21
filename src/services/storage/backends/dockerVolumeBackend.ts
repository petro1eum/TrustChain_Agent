/**
 * Docker Volume Backend
 * Proxies file operations to the Docker agent container via the backend API.
 * Files are stored in /mnt/user-data/{userId}/ inside the container.
 * 
 * Uses dockerAgentService for:
 *   - bash_tool: mkdir, rm, ls, du
 *   - view: read file contents
 *   - create_file: write file contents
 */

import type { StorageBackend, FileEntry, FileStat, StorageUsage } from '../types';

// Dynamic import to avoid circular dependency if needed
let _dockerService: any = null;
async function getDockerService() {
    if (!_dockerService) {
        const mod = await import('../../dockerAgentService');
        _dockerService = mod.dockerAgentService;
    }
    return _dockerService;
}

const BASE_PATH = '/mnt/user-data';

export class DockerVolumeBackend implements StorageBackend {
    readonly type = 'docker-volume' as const;
    private userId: string;

    constructor(userId: string = 'default') {
        this.userId = userId;
    }

    private get root(): string {
        return `${BASE_PATH}/${this.userId}`;
    }

    private fullPath(path: string): string {
        const normalized = path.replace(/^\/+|\/+$/g, '');
        return normalized ? `${this.root}/${normalized}` : this.root;
    }

    async init(): Promise<void> {
        const docker = await getDockerService();
        const dirs = ['config', 'uploads', 'outputs', 'transcripts', 'skills'];
        const mkdirCmd = dirs.map(d => `${this.root}/${d}`).join(' ');
        await docker.bashTool({
            command: `mkdir -p ${mkdirCmd}`,
            description: 'Initialize user storage directories',
        });
    }

    async read(path: string): Promise<string> {
        const docker = await getDockerService();
        const result = await docker.view({
            path: this.fullPath(path),
            description: `Read file: ${path}`,
        });
        if (!result.content && result.content !== '') {
            throw new Error(`File not found: ${path}`);
        }
        return result.content;
    }

    async write(path: string, content: string): Promise<void> {
        const docker = await getDockerService();
        const fp = this.fullPath(path);

        // Ensure parent directory exists
        const parentDir = fp.substring(0, fp.lastIndexOf('/'));
        await docker.bashTool({
            command: `mkdir -p "${parentDir}"`,
            description: `Ensure parent dir for: ${path}`,
        });

        await docker.createFile({
            path: fp,
            file_text: content,
            description: `Write file: ${path}`,
        });
    }

    async writeBinary(path: string, buffer: ArrayBuffer): Promise<void> {
        const docker = await getDockerService();
        const fp = this.fullPath(path);

        // Ensure parent directory exists
        const parentDir = fp.substring(0, fp.lastIndexOf('/'));
        await docker.bashTool({
            command: `mkdir -p "${parentDir}"`,
            description: `Ensure parent dir for: ${path}`,
        });

        // Convert ArrayBuffer to base64 string
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i += 8192) {
            binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 8192)));
        }
        const b64 = btoa(binary);

        // Write base64 to container and decode it natively to preserve binary
        await docker.bashTool({
            command: `echo "${b64}" | base64 -d > "${fp}"`,
            description: `Write binary file: ${path} (${bytes.length} bytes)`,
        });
    }

    async list(path: string): Promise<FileEntry[]> {
        const docker = await getDockerService();
        const fp = this.fullPath(path);

        // Use ls with JSON-like output
        const result = await docker.bashTool({
            command: `find "${fp}" -maxdepth 1 -mindepth 1 -printf '%y %s %T@ %f\n' 2>/dev/null || echo ''`,
            description: `List directory: ${path}`,
        });

        if (!result.stdout?.trim()) return [];

        const entries: FileEntry[] = [];
        for (const line of result.stdout.trim().split('\n')) {
            if (!line.trim()) continue;
            const match = line.match(/^(\w)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
            if (!match) continue;
            const [, type, size, mtime, name] = match;
            entries.push({
                name,
                path: path ? `${path}/${name}` : name,
                type: type === 'd' ? 'directory' : 'file',
                size: parseInt(size, 10),
                modified: Math.floor(parseFloat(mtime) * 1000),
            });
        }

        return entries.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }

    async delete(path: string): Promise<void> {
        const docker = await getDockerService();
        await docker.bashTool({
            command: `rm -rf "${this.fullPath(path)}"`,
            description: `Delete: ${path}`,
        });
    }

    async exists(path: string): Promise<boolean> {
        const docker = await getDockerService();
        const result = await docker.bashTool({
            command: `test -e "${this.fullPath(path)}" && echo "yes" || echo "no"`,
            description: `Check exists: ${path}`,
        });
        return result.stdout?.trim() === 'yes';
    }

    async stat(path: string): Promise<FileStat> {
        const docker = await getDockerService();
        const fp = this.fullPath(path);
        const result = await docker.bashTool({
            command: `stat --format='%F %s %Y %W' "${fp}" 2>/dev/null || echo "NOTFOUND"`,
            description: `Stat: ${path}`,
        });

        if (result.stdout?.trim() === 'NOTFOUND') {
            throw new Error(`Path not found: ${path}`);
        }

        const parts = result.stdout!.trim().split(' ');
        const isDir = parts[0] === 'directory';

        return {
            path,
            type: isDir ? 'directory' : 'file',
            size: parseInt(parts[1], 10),
            modified: parseInt(parts[2], 10) * 1000,
            created: parseInt(parts[3], 10) * 1000 || Date.now(),
        };
    }

    async usage(): Promise<StorageUsage> {
        const docker = await getDockerService();
        const result = await docker.bashTool({
            command: `du -sb "${this.root}" 2>/dev/null | cut -f1 || echo "0"`,
            description: 'Get storage usage',
        });

        const used = parseInt(result.stdout?.trim() || '0', 10);

        return {
            used,
            quota: 0, // Docker volumes typically have no built-in quota
            backend: 'docker-volume',
            mountPath: this.root,
        };
    }

    /**
     * Check if the Docker container is available and has the expected directory structure.
     */
    static async isAvailable(): Promise<boolean> {
        try {
            const docker = await getDockerService();
            const status = await docker.getContainerStatus();
            return status.available === true;
        } catch {
            return false;
        }
    }
}
