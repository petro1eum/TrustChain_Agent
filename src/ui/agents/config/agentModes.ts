/**
 * Agent Modes Configuration
 * Defines available agent operating modes with i18n support
 */

import type { AgentModeConfig } from '../types';

export function getAgentModes(): AgentModeConfig[] {
    return [
        {
            id: 'general',
            name: 'Общий',
            description: 'Универсальный режим для любых задач',
            icon: '🤖',
            color: '#6366f1',
            defaultTools: ['search', 'analyze', 'generate'],
        },
        {
            id: 'data',
            name: 'Данные',
            description: 'Анализ и обработка данных, Excel, CSV',
            icon: '📊',
            color: '#10b981',
            defaultTools: ['data_quality_check', 'fuzzy_matching', 'export_data'],
        },
        {
            id: 'code',
            name: 'Код',
            description: 'Генерация, анализ и отладка кода',
            icon: '💻',
            color: '#3b82f6',
            defaultTools: ['analyze_code_structure', 'search_code_symbols', 'create_artifact'],
        },
        {
            id: 'search',
            name: 'Поиск',
            description: 'Поиск по каталогу и базе знаний',
            icon: '🔍',
            color: '#f59e0b',
            defaultTools: ['expert_search', 'match_specification_to_catalog'],
        },
        {
            id: 'trustchain',
            name: 'TrustChain',
            description: 'Верификация и подписание данных',
            icon: '🔒',
            color: '#ef4444',
            defaultTools: ['trustchain_sign', 'trustchain_verify'],
        },
    ];
}
