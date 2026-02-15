/**
 * Gap #8: Фреймворк оценки качества ответов агента
 * Объединяет execution metrics + answer validation в единый quality score
 */

import { MetricsService, type ExecutionMetrics } from './metricsService';

export interface QualityDimension {
    name: string;
    score: number; // 0-1
    weight: number;
    details: string;
}

export interface QualityReport {
    overallScore: number; // 0-100
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    dimensions: QualityDimension[];
    suggestions: string[];
    timestamp: Date;
}

export interface ResponseEvaluationInput {
    /** Оригинальный запрос пользователя */
    userQuery: string;
    /** Финальный ответ агента */
    agentResponse: string;
    /** Инструменты, которые были вызваны */
    executedTools: string[];
    /** Результаты tool calls */
    toolResults: Array<{ tool: string; success: boolean; latencyMs: number }>;
    /** Execution metrics из MetricsService */
    metrics?: ExecutionMetrics;
    /** Количество циклов ReAct */
    reactCycles: number;
    /** Был ли ответ валидирован через LLM */
    llmValidated?: boolean;
    /** Результат LLM-валидации */
    llmValidationResult?: { isComplete: boolean; isRelevant: boolean };
}

export class ResponseQualityEvaluator {

    /**
     * Оценивает качество ответа по нескольким измерениям
     */
    evaluate(input: ResponseEvaluationInput): QualityReport {
        const dimensions: QualityDimension[] = [
            this.evaluateCompleteness(input),
            this.evaluateEfficiency(input),
            this.evaluateToolUsage(input),
            this.evaluateResponseQuality(input),
            this.evaluateReliability(input),
        ];

        const totalWeight = dimensions.reduce((s, d) => s + d.weight, 0);
        const weightedScore = dimensions.reduce((s, d) => s + d.score * d.weight, 0);
        const overallScore = Math.round((weightedScore / totalWeight) * 100);

        const grade = this.scoreToGrade(overallScore);
        const suggestions = this.generateSuggestions(dimensions, input);

        return {
            overallScore,
            grade,
            dimensions,
            suggestions,
            timestamp: new Date(),
        };
    }

    /**
     * 1. Полнота ответа (30% веса)
     * Был ли запрос выполнен до конца?
     */
    private evaluateCompleteness(input: ResponseEvaluationInput): QualityDimension {
        let score = 0.5; // baseline

        // LLM-валидация доступна и прошла
        if (input.llmValidated && input.llmValidationResult) {
            if (input.llmValidationResult.isComplete && input.llmValidationResult.isRelevant) {
                score = 1.0;
            } else if (input.llmValidationResult.isComplete || input.llmValidationResult.isRelevant) {
                score = 0.7;
            } else {
                score = 0.3;
            }
        } else {
            // Эвристика: если есть ответ > 50 символов и были tool calls — скорее всего ОК
            if (input.agentResponse.length > 50 && input.executedTools.length > 0) {
                score = 0.7;
            } else if (input.agentResponse.length > 200) {
                score = 0.6;
            }
        }

        return {
            name: 'Полнота',
            score,
            weight: 0.30,
            details: input.llmValidated
                ? `LLM: complete=${input.llmValidationResult?.isComplete}, relevant=${input.llmValidationResult?.isRelevant}`
                : `Эвристика: ответ ${input.agentResponse.length} символов, ${input.executedTools.length} tool calls`
        };
    }

    /**
     * 2. Эффективность (20% веса)
     * Сколько циклов и инструментов понадобилось?
     */
    private evaluateEfficiency(input: ResponseEvaluationInput): QualityDimension {
        let score = 1.0;

        // Штраф за избыточные циклы ReAct
        if (input.reactCycles > 5) score -= 0.4;
        else if (input.reactCycles > 3) score -= 0.2;

        // Штраф за дублирование tool calls
        const uniqueTools = new Set(input.executedTools).size;
        const totalTools = input.executedTools.length;
        if (totalTools > 0 && uniqueTools < totalTools * 0.5) {
            score -= 0.3; // Больше половины вызовов — дубли
        }

        // Средняя латентность
        if (input.toolResults.length > 0) {
            const avgLatency = input.toolResults.reduce((s, r) => s + r.latencyMs, 0) / input.toolResults.length;
            if (avgLatency > 10000) score -= 0.2;
            else if (avgLatency > 5000) score -= 0.1;
        }

        score = Math.max(0, score);

        return {
            name: 'Эффективность',
            score,
            weight: 0.20,
            details: `${input.reactCycles} циклов, ${totalTools} вызовов (${uniqueTools} уникальных)`
        };
    }

    /**
     * 3. Корректность использования инструментов (20% веса)
     */
    private evaluateToolUsage(input: ResponseEvaluationInput): QualityDimension {
        if (input.toolResults.length === 0) {
            return { name: 'Инструменты', score: 0.5, weight: 0.20, details: 'Нет tool calls' };
        }

        const successCount = input.toolResults.filter(r => r.success).length;
        const successRate = successCount / input.toolResults.length;

        // Проверяем антипаттерны
        let penalized = false;
        const tools = input.executedTools;

        // Anti-pattern: calling extract_table_to_excel after a search/match tool
        // (redundant extraction after results are already found)
        const matchIdx = tools.findIndex(t => t.includes('match_') || t.includes('search'));
        const extractIdx = tools.indexOf('extract_table_to_excel');
        if (matchIdx !== -1 && extractIdx !== -1 && extractIdx > matchIdx) {
            penalized = true;
        }

        let score = successRate;
        if (penalized) score *= 0.5;

        return {
            name: 'Инструменты',
            score,
            weight: 0.20,
            details: `${successCount}/${input.toolResults.length} успешных${penalized ? ' (обнаружен антипаттерн)' : ''}`
        };
    }

    /**
     * 4. Качество текста ответа (15% веса)
     */
    private evaluateResponseQuality(input: ResponseEvaluationInput): QualityDimension {
        const response = input.agentResponse;
        let score = 0.5;

        // Структурированность (наличие заголовков, списков)
        if (response.includes('#') || response.includes('- ') || response.includes('1.')) {
            score += 0.2;
        }

        // Не слишком короткий
        if (response.length > 100) score += 0.1;
        // Не слишком длинный без структуры
        if (response.length > 2000 && !response.includes('#')) score -= 0.2;

        // Не содержит нерелевантных метаданных процесса
        if (response.includes('Сначала я попробовал') || response.includes('Давай продолжим')) {
            score -= 0.1;
        }

        score = Math.max(0, Math.min(1, score));

        return {
            name: 'Качество текста',
            score,
            weight: 0.15,
            details: `${response.length} символов, структурирован: ${response.includes('#')}`
        };
    }

    /**
     * 5. Надёжность (15% веса)
     */
    private evaluateReliability(input: ResponseEvaluationInput): QualityDimension {
        let score = 1.0;

        // Ошибки tool calls
        const failures = input.toolResults.filter(r => !r.success).length;
        if (failures > 2) score -= 0.4;
        else if (failures > 0) score -= 0.2;

        // Metrics-based проверки
        if (input.metrics) {
            if (input.metrics.retryCount > 3) score -= 0.2;
            if (input.metrics.asyncTimeouts > 0) score -= 0.2;
            if (input.metrics.fallbackUsages > 1) score -= 0.1;
        }

        score = Math.max(0, score);

        return {
            name: 'Надёжность',
            score,
            weight: 0.15,
            details: `${failures} ошибок tool calls, ${input.metrics?.retryCount || 0} retries`
        };
    }

    private scoreToGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
        if (score >= 90) return 'A';
        if (score >= 75) return 'B';
        if (score >= 60) return 'C';
        if (score >= 40) return 'D';
        return 'F';
    }

    private generateSuggestions(dims: QualityDimension[], input: ResponseEvaluationInput): string[] {
        const suggestions: string[] = [];

        for (const d of dims) {
            if (d.score < 0.6) {
                switch (d.name) {
                    case 'Полнота':
                        suggestions.push('Ответ неполный — рекомендуется валидация через LLM');
                        break;
                    case 'Эффективность':
                        suggestions.push(`Избыточные циклы (${input.reactCycles}) — оптимизировать планирование`);
                        break;
                    case 'Инструменты':
                        suggestions.push('Ошибки в использовании инструментов — проверить routing');
                        break;
                    case 'Качество текста':
                        suggestions.push('Ответ плохо структурирован — добавить заголовки и списки');
                        break;
                    case 'Надёжность':
                        suggestions.push('Высокий уровень ошибок — проверить стабильность backend');
                        break;
                }
            }
        }

        return suggestions;
    }

    /**
     * Формирует однострочный лог для мониторинга
     */
    formatLogLine(report: QualityReport, userQuery: string): string {
        const dims = report.dimensions.map(d => `${d.name}:${Math.round(d.score * 100)}%`).join(' ');
        const query = userQuery.slice(0, 50).replace(/\n/g, ' ');
        return `[Quality ${report.grade}|${report.overallScore}%] "${query}" — ${dims}`;
    }
}
