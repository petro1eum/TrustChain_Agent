/**
 * Сервис метрик выполнения
 * Выделен из smart-ai-agent.ts для улучшения структуры кода
 */

export interface ExecutionMetrics {
  toolCalls: number;
  successfulSteps: number;
  failedSteps: number;
  retryCount: number;
  totalThinkingTime: number;
  averageConfidence: number;
  startTime: number;
  endTime: number;
  confidenceSum: number;
  thinkingIterations: number;
  toolLatency: Map<string, number[]>;
  toolRetries: Map<string, number>;
  toolFailures: Map<string, number>;
  cacheHitRate: number;
  cacheMisses: number;
  asyncTimeouts: number;
  validationFailures: number;
  fallbackUsages: number;
}

export class MetricsService {
  private metrics: ExecutionMetrics;

  constructor() {
    this.metrics = this.createEmptyMetrics();
  }

  createEmptyMetrics(): ExecutionMetrics {
    return {
      toolCalls: 0,
      successfulSteps: 0,
      failedSteps: 0,
      retryCount: 0,
      totalThinkingTime: 0,
      averageConfidence: 0,
      startTime: Date.now(),
      endTime: 0,
      confidenceSum: 0,
      thinkingIterations: 0,
      toolLatency: new Map<string, number[]>(),
      toolRetries: new Map<string, number>(),
      toolFailures: new Map<string, number>(),
      cacheHitRate: 0,
      cacheMisses: 0,
      asyncTimeouts: 0,
      validationFailures: 0,
      fallbackUsages: 0
    };
  }

  reset(): void {
    this.metrics = this.createEmptyMetrics();
  }

  getMetrics(): ExecutionMetrics {
    return { ...this.metrics };
  }

  recordToolCall(toolName: string, latency: number): void {
    this.metrics.toolCalls++;
    const latencies = this.metrics.toolLatency.get(toolName) || [];
    latencies.push(latency);
    this.metrics.toolLatency.set(toolName, latencies);
  }

  recordToolFailure(toolName: string): void {
    const failures = this.metrics.toolFailures.get(toolName) || 0;
    this.metrics.toolFailures.set(toolName, failures + 1);
  }

  recordToolRetry(toolName: string): void {
    const retries = this.metrics.toolRetries.get(toolName) || 0;
    this.metrics.toolRetries.set(toolName, retries + 1);
    this.metrics.retryCount++;
  }

  recordCacheHit(): void {
    this.metrics.cacheHitRate++;
  }

  recordCacheMiss(): void {
    this.metrics.cacheMisses++;
  }

  recordSuccessfulStep(): void {
    this.metrics.successfulSteps++;
  }

  recordFailedStep(): void {
    this.metrics.failedSteps++;
  }

  recordValidationFailure(): void {
    this.metrics.validationFailures++;
  }

  recordAsyncTimeout(): void {
    this.metrics.asyncTimeouts++;
  }

  recordFallbackUsage(): void {
    this.metrics.fallbackUsages++;
  }

  recordThinking(confidence: number, time: number): void {
    this.metrics.thinkingIterations++;
    this.metrics.confidenceSum += confidence;
    this.metrics.averageConfidence = this.metrics.confidenceSum / this.metrics.thinkingIterations;
    this.metrics.totalThinkingTime += time;
  }

  incrementThinkingIterations(): void {
    this.metrics.thinkingIterations++;
  }

  addConfidence(confidence: number): void {
    this.metrics.confidenceSum += confidence;
    if (this.metrics.thinkingIterations > 0) {
      this.metrics.averageConfidence = this.metrics.confidenceSum / this.metrics.thinkingIterations;
    }
  }

  finish(): void {
    this.metrics.endTime = Date.now();
  }

  getExecutionStats() {
    const stats: any = {
      ...this.metrics,
      averageLatencyByTool: new Map<string, number>(),
      slowestTool: '',
      mostFailedTool: '',
      cacheHitRatePercent: 0,
      validationSuccessRate: 0,
      overallSuccessRate: 0
    };
    
    for (const [tool, lat] of this.metrics.toolLatency.entries()) {
      if (lat.length) {
        const avg = Math.round(lat.reduce((a, b) => a + b, 0) / lat.length);
        stats.averageLatencyByTool.set(tool, avg);
      }
    }
    
    let maxAvg = 0;
    let slow = '';
    for (const [tool, avg] of stats.averageLatencyByTool.entries()) {
      if (avg > maxAvg) {
        maxAvg = avg;
        slow = `${tool} (${avg}ms)`;
      }
    }
    stats.slowestTool = slow;
    
    let maxFail = 0;
    let worst = '';
    for (const [tool, fails] of this.metrics.toolFailures.entries()) {
      if (fails > maxFail) {
        maxFail = fails as number;
        worst = `${tool} (${fails} failures)`;
      }
    }
    stats.mostFailedTool = worst;
    
    const totalCache = this.metrics.cacheHitRate + this.metrics.cacheMisses;
    stats.cacheHitRatePercent = totalCache 
      ? Math.round((this.metrics.cacheHitRate / totalCache) * 100) 
      : 0;
    
    const totalValidations = this.metrics.toolCalls;
    stats.validationSuccessRate = totalValidations 
      ? Math.round(((totalValidations - this.metrics.validationFailures) / totalValidations) * 100) 
      : 0;
    
    const totalSteps = this.metrics.successfulSteps + this.metrics.failedSteps;
    stats.overallSuccessRate = totalSteps 
      ? Math.round((this.metrics.successfulSteps / totalSteps) * 100) 
      : 0;
    
    return stats;
  }

  logExecutionSummary(): void {
    const s = this.getExecutionStats();
    console.group('🤖 Agent Execution Summary');
    console.log(`⏱️  Total time: ${s.endTime - s.startTime}ms`);
    console.log(`🔧 Tool calls: ${s.toolCalls}`);
    console.log(`✅ Successful steps: ${s.successfulSteps}`);
    console.log(`❌ Failed steps: ${s.failedSteps}`);
    console.log(`🔄 Retries: ${s.retryCount}`);
    console.log(`📊 Success rate: ${s.overallSuccessRate}%`);
    console.log(`💾 Cache hit rate: ${s.cacheHitRatePercent}%`);
    console.log(`✔️  Validation success: ${s.validationSuccessRate}%`);
    if (s.slowestTool) console.log(`🐌 Slowest tool: ${s.slowestTool}`);
    if (s.mostFailedTool) console.log(`⚠️  Most failed tool: ${s.mostFailedTool}`);
    if (s.asyncTimeouts > 0) console.warn(`⏰ Async timeouts: ${s.asyncTimeouts}`);
    if (s.fallbackUsages > 0) console.log(`🔄 Fallback usages: ${s.fallbackUsages}`);
    console.groupEnd();
  }
}

