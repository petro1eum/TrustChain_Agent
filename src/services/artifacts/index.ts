/**
 * Artifacts Service — manages artifact creation, listing, retrieval, and deletion.
 * Provides both instance and static methods used by toolHandlersService.
 */

import type { ArtifactInfo, ArtifactContent } from './types';

export type { ArtifactInfo, ArtifactContent };

export interface ArtifactEntry {
    id: string;
    type: string;
    title: string;
    content: string;
    language?: string;
    timestamp: Date;
}

// ── Backend URL ──

const _proc = typeof process !== 'undefined' ? (process as any).env ?? {} : {};
const BACKEND_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_BACKEND_URL)
    || _proc.VITE_BACKEND_URL
    || '';

// ── Service ──

export class ArtifactsService {
    private artifacts: Map<string, ArtifactEntry> = new Map();

    create(artifact: Omit<ArtifactEntry, 'id' | 'timestamp'>): ArtifactEntry {
        const entry: ArtifactEntry = {
            ...artifact,
            id: `art_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            timestamp: new Date(),
        };
        this.artifacts.set(entry.id, entry);
        return entry;
    }

    get(id: string): ArtifactEntry | undefined {
        return this.artifacts.get(id);
    }

    getAll(): ArtifactEntry[] {
        return Array.from(this.artifacts.values());
    }

    // ── Static methods for backend interaction ──

    /** List all artifacts from backend */
    static async listArtifacts(): Promise<ArtifactInfo[]> {
        try {
            const resp = await fetch(`${BACKEND_URL}/api/artifacts`, { signal: AbortSignal.timeout(5000) });
            if (!resp.ok) return [];
            const data = await resp.json();
            return Array.isArray(data) ? data : (data.artifacts ?? []);
        } catch {
            // Fallback: return locally stored artifacts
            try {
                const stored = localStorage.getItem('kb_agent_artifacts');
                if (stored) return JSON.parse(stored);
            } catch { /* ignore */ }
            return [];
        }
    }

    /** Get a single artifact's content by filename */
    static async getArtifact(filename: string): Promise<ArtifactContent | null> {
        try {
            const resp = await fetch(`${BACKEND_URL}/api/artifacts/${encodeURIComponent(filename)}`, { signal: AbortSignal.timeout(10000) });
            if (!resp.ok) return null;
            return await resp.json();
        } catch {
            // Fallback: check localStorage
            try {
                const stored = localStorage.getItem(`kb_artifact_${filename}`);
                if (stored) return JSON.parse(stored);
            } catch { /* ignore */ }
            return null;
        }
    }

    /** Delete an artifact by filename */
    static async deleteArtifact(filename: string): Promise<boolean> {
        try {
            const resp = await fetch(`${BACKEND_URL}/api/artifacts/${encodeURIComponent(filename)}`, {
                method: 'DELETE',
                signal: AbortSignal.timeout(5000),
            });
            return resp.ok;
        } catch {
            // Fallback: remove from localStorage
            try {
                localStorage.removeItem(`kb_artifact_${filename}`);
                return true;
            } catch { return false; }
        }
    }

    /** Upload artifact (used by toolHandlersService) */
    static async uploadArtifact(params: {
        filename: string;
        contentBase64?: string;
        content_base64?: string;
        content?: string;
    }): Promise<{ success: boolean; filename?: string; path?: string; error?: string }> {
        try {
            const content = params.contentBase64 || params.content_base64 || params.content || '';
            const filename = params.filename;

            // Try backend first
            try {
                const resp = await fetch(`${BACKEND_URL}/api/artifacts/upload`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename, content }),
                    signal: AbortSignal.timeout(10000),
                });
                if (resp.ok) {
                    const data = await resp.json();
                    return { success: true, filename, path: data.path || `/mnt/user-data/outputs/${filename}` };
                }
            } catch { /* fallback below */ }

            // Fallback: store locally
            localStorage.setItem(`kb_artifact_${filename}`, JSON.stringify({
                filename,
                content,
                type: filename.split('.').pop() || 'text',
                size: content.length,
                path: `/mnt/user-data/outputs/${filename}`,
            }));

            return { success: true, filename, path: `/mnt/user-data/outputs/${filename}` };
        } catch (err: any) {
            return { success: false, error: err.message };
        }
    }
}

export const artifactsService = new ArtifactsService();

// ── Polling Service ──

class ArtifactsPollingService {
    private intervalId: ReturnType<typeof setInterval> | null = null;
    private pollIntervalMs = 5000;

    start(callback: (artifacts: ArtifactInfo[]) => void): void {
        this.stop();
        this.intervalId = setInterval(async () => {
            try {
                const list = await ArtifactsService.listArtifacts();
                callback(list);
            } catch { /* silent */ }
        }, this.pollIntervalMs);
    }

    stop(): void {
        if (this.intervalId !== null) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
}

export const artifactsPollingService = new ArtifactsPollingService();
