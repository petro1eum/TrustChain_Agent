/**
 * Artifacts types — shared between services and UI
 */

export interface ArtifactData {
    id: string;
    type: string;
    title: string;
    content: string;
    language?: string;
    filename?: string;
    mimeType?: string;
    size?: number;
    timestamp: Date;
}

export type ArtifactType = 'code' | 'text' | 'markdown' | 'html' | 'image' | 'pdf' | 'excel' | 'svg' | 'react' | 'word';

/** Artifact listing info (returned by listArtifacts) */
export interface ArtifactInfo {
    filename: string;
    type: string;
    size: number;
    created_at?: string;
    modified_at?: string;
    path?: string;
}

/** Full artifact content (returned by getArtifact) */
export interface ArtifactContent {
    filename: string;
    path: string;
    content: string;
    type: string;
    size: number;
    created_at?: string;
    mimeType?: string;
    language?: string;
}
