/**
 * Resource Manager — rate limiting and usage tracking.
 * Provides checkRateLimit, checkLimits, recordUsage, recordApiUsage, trackUsage.
 */

export interface RateLimitConfig {
    maxTokensPerMinute: number;
    maxRequestsPerMinute: number;
    enabled: boolean;
    defaultLimits?: {
        maxToolCalls?: number;
        maxTokens?: number;
        maxCost?: number;
        maxApiRequests?: number;
        periodMs?: number;
    };
}

export interface LimitCheckResult {
    allowed: boolean;
    reason?: string;
}

export interface UsageInfo {
    toolCalls: number;
    tokens: number;
    apiRequests: number;
}

export class ResourceManager {
    private totalTokens = 0;
    private totalRequests = 0;
    private config: RateLimitConfig;

    constructor(config?: RateLimitConfig) {
        this.config = config ?? { maxTokensPerMinute: 100000, maxRequestsPerMinute: 60, enabled: false };
    }

    async checkRateLimit(): Promise<boolean> {
        if (!this.config.enabled) return true;
        return this.totalRequests < this.config.maxRequestsPerMinute;
    }

    checkLimits(_toolName: string, _model?: string, _estimatedTokens?: number): LimitCheckResult {
        if (!this.config.enabled) return { allowed: true };
        if (this.totalRequests >= this.config.maxRequestsPerMinute) {
            return { allowed: false, reason: 'Rate limit exceeded' };
        }
        return { allowed: true };
    }

    recordUsage(_toolName: string, _model?: string, _usage?: UsageInfo): void {
        this.totalRequests++;
        if (_usage) {
            this.totalTokens += _usage.tokens || 0;
        }
    }

    /** Record API usage from OpenAI response.usage (used by InternalReasoningService) */
    recordApiUsage(model: string, usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }): void {
        this.totalRequests++;
        this.totalTokens += usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
    }

    async trackUsage(tokens: number): Promise<void> {
        this.totalTokens += tokens;
    }

    getUsageStats() {
        return { tokensUsed: this.totalTokens, requestsUsed: this.totalRequests, rateLimited: false };
    }
}
