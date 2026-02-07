/**
 * Shared types for TrustChain Agent UI components.
 * Extracted from the monolithic TrustChainAgentApp.tsx.
 */

export type ThemeMode = 'light' | 'dark';
export type Tier = 'oss' | 'pro' | 'enterprise';

export interface Artifact {
    id: string;
    type: 'code' | 'report' | 'table' | 'document' | 'chart' | 'plan' | 'graph' | 'compliance' | 'analytics';
    title: string;
    language?: string;
    content: string;
    createdAt: Date;
    signature?: string;
    version: number;
    tier?: Tier;
}

export interface ExecutionStep {
    id: string;
    type: 'planning' | 'tool' | 'artifacts';
    label: string;
    detail?: string;
    latencyMs?: number;
    tier?: Tier;
    signed?: boolean;
    toolName?: string;
    args?: Record<string, unknown>;
    result?: string;
    signature?: string;
    artifactIds?: string[];
}

export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    signature?: string;
    verified?: boolean;
    tool_calls?: ToolCall[];
    thinking?: string;
    artifactId?: string;
    artifactIds?: string[];
    executionSteps?: ExecutionStep[];
}

export interface ToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
    result?: string;
    signature?: string;
    latencyMs?: number;
    tier?: Tier;
}

export interface Conversation {
    id: string;
    title: string;
    lastMessage: string;
    timestamp: Date;
    messageCount: number;
    trustScore: number;
}
