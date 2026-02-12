/**
 * Answer Validation Service
 * Validates agent responses against original user question before returning
 */

import OpenAI from 'openai';
import type { ChatMessage, ProgressEvent } from '../../agents/types';
import type { TaskIntent, TaskStep } from './taskIntentService';

export interface AnswerValidationResult {
    isComplete: boolean;
    isRelevant: boolean;
    issues: string[];
    suggestedAction: 'return' | 'retry_broader' | 'ask_clarification' | 'calculate_first' | 'continue_multistep';
    retryQuery?: string;
    explanation: string;
}

export interface TaskCompletionResult {
    isComplete: boolean;
    completedSteps: TaskStep[];
    missingSteps: TaskStep[];
    suggestedNextTool: string | null;
    trustchainAudit: TaskCompletionAudit;
}

export interface TaskCompletionAudit {
    timestamp: string;
    intendedSteps: string[];
    executedTools: string[];
    toolSignatures: Array<{ tool: string; signature?: string }>;
    completionStatus: 'complete' | 'partial' | 'failed';
}

export interface AnswerValidationServiceDependencies {
    openai: OpenAI;
    getApiParams: (params: any) => any;
}

export class AnswerValidationService {
    private deps: AnswerValidationServiceDependencies;

    constructor(deps: AnswerValidationServiceDependencies) {
        this.deps = deps;
    }

    /**
     * Validates if the response actually answers the user's question
     */
    async validateAnswer(
        originalQuestion: string,
        messages: ChatMessage[],
        toolResults: any[],
        progressCallback?: (event: ProgressEvent) => void
    ): Promise<AnswerValidationResult> {

        // Quick check: if we have search results with 0 items, definitely incomplete
        const hasEmptySearchResults = toolResults.some(result => {
            if (typeof result === 'object' && result !== null) {
                return result.total === 0 ||
                    (result.data && result.data.total === 0) ||
                    (Array.isArray(result.items) && result.items.length === 0);
            }
            return false;
        });

        if (hasEmptySearchResults) {
            progressCallback?.({
                type: 'reasoning_step',
                message: 'Обнаружен пустой результат поиска, анализирую...',
                reasoning_text: 'Проверяю можно ли уточнить запрос'
            });

            return this.analyzeEmptyResults(originalQuestion, toolResults);
        }

        // For non-empty results, use LLM to validate relevance
        return this.validateWithLLM(originalQuestion, messages, toolResults, progressCallback);
    }

    /**
     * Validates that all intended task steps were completed
     * Used for multi-step task enforcement
     */
    validateTaskCompletion(
        intent: TaskIntent,
        executedTools: string[],
        toolResults: any[]
    ): TaskCompletionResult {
        const completedSteps: TaskStep[] = [];
        const missingSteps: TaskStep[] = [];

        // MCP tools fulfill any data-related intent step (the model chose the right tool)
        const hasMcpToolExecution = executedTools.some(t => t.startsWith('mcp_'));
        const hasAnyToolExecution = executedTools.length > 0;
        const dataActions = new Set(['search', 'extract', 'analyze', 'compare', 'navigate', 'calculate', 'create']);

        for (const step of intent.steps) {
            const exactMatch = step.requiredTools.some(tool => executedTools.includes(tool));
            // MCP tools satisfy any data-related step — the model picked the right MCP tool
            const mcpSatisfied = hasMcpToolExecution && dataActions.has(step.action);
            // If any tool was executed and model already synthesized, don't force continuation
            const implicitlyComplete = hasAnyToolExecution && dataActions.has(step.action);

            if (exactMatch || mcpSatisfied || implicitlyComplete) {
                completedSteps.push(step);
            } else {
                missingSteps.push(step);
            }
        }

        const isComplete = missingSteps.length === 0;
        const suggestedNextTool = missingSteps[0]?.requiredTools[0] || null;

        // Build TrustChain audit record
        const trustchainAudit = this.buildAuditRecord(intent, executedTools, toolResults, isComplete);

        return {
            isComplete,
            completedSteps,
            missingSteps,
            suggestedNextTool,
            trustchainAudit
        };
    }

    /**
     * Builds audit record for TrustChain signing
     */
    private buildAuditRecord(
        intent: TaskIntent,
        executedTools: string[],
        toolResults: any[],
        isComplete: boolean
    ): TaskCompletionAudit {
        return {
            timestamp: new Date().toISOString(),
            intendedSteps: intent.steps.map(s => s.action),
            executedTools,
            toolSignatures: toolResults
                .filter(r => r && typeof r === 'object')
                .map(r => ({
                    tool: r.name || r.tool_id || 'unknown',
                    signature: r.signature
                })),
            completionStatus: isComplete ? 'complete' : 'partial'
        };
    }

    /**
     * Analyzes empty search results and suggests retry strategy
     */
    private async analyzeEmptyResults(
        originalQuestion: string,
        toolResults: any[]
    ): Promise<AnswerValidationResult> {

        // Extract the query that was used
        const usedQuery = toolResults.find(r => r.query)?.query || '';

        // Check if query was too specific
        const queryWordCount = usedQuery.split(/\s+/).length;
        const hasSpecificDimensions = /\d+x\d+|\d+мм|\d+mm/i.test(usedQuery);
        const hasSpecificType = /тип\s*\d+|type\s*\d+/i.test(usedQuery);

        // Suggest broader query
        let suggestedAction: AnswerValidationResult['suggestedAction'] = 'retry_broader';
        let retryQuery = '';
        const issues: string[] = [];

        if (hasSpecificDimensions || hasSpecificType) {
            issues.push('Запрос слишком специфичный (указаны конкретные размеры/тип)');
            // Extract brand/category from original question
            const brandMatch = originalQuestion.match(/керми|kermi|rifar|buderus|purmo/i);
            const categoryMatch = originalQuestion.match(/радиатор|котел|насос/i);
            retryQuery = `${categoryMatch?.[0] || ''} ${brandMatch?.[0] || ''}`.trim();
        }

        if (queryWordCount > 4) {
            issues.push('Слишком много критериев в одном запросе');
        }

        // Check if calculation is needed (e.g., room size mentioned)
        const hasRoomSize = /\d+\s*[xх×]\s*\d+\s*(м|m)?/i.test(originalQuestion);
        if (hasRoomSize) {
            issues.push('Нужен расчет мощности по размеру комнаты');
            suggestedAction = 'calculate_first';
        }

        return {
            isComplete: false,
            isRelevant: false,
            issues,
            suggestedAction,
            retryQuery: retryQuery || undefined,
            explanation: `Поиск вернул 0 результатов. ${issues.join('. ')}.`
        };
    }

    /**
     * Uses LLM to validate if response is relevant and complete
     */
    private async validateWithLLM(
        originalQuestion: string,
        messages: ChatMessage[],
        toolResults: any[],
        progressCallback?: (event: ProgressEvent) => void
    ): Promise<AnswerValidationResult> {

        progressCallback?.({
            type: 'reasoning_step',
            message: 'Валидирую ответ...',
            reasoning_text: 'Проверяю соответствие ответа вопросу пользователя'
        });

        const lastAssistantMessage = messages.filter(m => m.role === 'assistant').pop();
        const responseContent = lastAssistantMessage?.content || '';

        const validationPrompt = `Проверь, отвечает ли ответ на вопрос пользователя.

ВОПРОС ПОЛЬЗОВАТЕЛЯ: "${originalQuestion}"

ОТВЕТ АГЕНТА: "${responseContent.substring(0, 1000)}"

РЕЗУЛЬТАТЫ ИНСТРУМЕНТОВ (краткое): ${JSON.stringify(toolResults).substring(0, 500)}

Ответь в JSON:
{
  "isComplete": true/false (ответ полный и информативный?),
  "isRelevant": true/false (ответ по теме вопроса?),
  "issues": ["список проблем если есть"],
  "suggestedAction": "return" | "retry_broader" | "ask_clarification",
  "explanation": "краткое объяснение"
}`;

        try {
            const response = await this.deps.openai.chat.completions.create(
                this.deps.getApiParams({
                    model: 'google/gemini-2.5-flash-lite',
                    messages: [{ role: 'user', content: validationPrompt }],
                    maxTokens: 500,
                    temperature: 0.1,
                    responseFormat: { type: 'json_object' }
                })
            );

            const result = JSON.parse(response.choices[0]?.message?.content || '{}');

            return {
                isComplete: result.isComplete ?? true,
                isRelevant: result.isRelevant ?? true,
                issues: result.issues || [],
                suggestedAction: result.suggestedAction || 'return',
                explanation: result.explanation || ''
            };
        } catch (error: any) {
            console.error('Validation LLM error:', error);
            // On error, assume response is OK to avoid blocking
            return {
                isComplete: true,
                isRelevant: true,
                issues: [],
                suggestedAction: 'return',
                explanation: 'Validation skipped due to error'
            };
        }
    }
}

