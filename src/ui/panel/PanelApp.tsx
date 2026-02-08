import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Bot, X, Loader2, ArrowUp, Check, ChevronRight,
    Search, FileText, BarChart3, Sparkles, Wrench, Zap, Shield,
    Terminal, Activity, AlertTriangle, CheckCircle, Database,
    TrendingUp, Lock, Eye, MessageSquare, Clock
} from 'lucide-react';
import { useAgent, type AgentTool } from '../../hooks/useAgent';
import { useChatState } from '../../hooks/useChatState';
import { chatHistoryService } from '../../services/chatHistoryService';
import { agentCallbacksService } from '../../services/agents/agentCallbacksService';
import type { Message, Artifact, ExecutionStep } from '../components/types';
import { renderFullMarkdown } from '../components/MarkdownRenderer';
import '../theme.ts';

// ─── URL Parameter Parsing ───

function getPanelParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        instance: params.get('instance') || 'default',
        mcpUrl: params.get('mcp') || null,
        systemPrompt: params.get('system') ? atob(params.get('system')!) : null,
        theme: (params.get('theme') as 'dark' | 'light') || 'dark',
        lang: params.get('lang') || 'ru',
        context: params.get('context') || null,   // page context: "risk_tree", "contracts", "documents", etc.
        title: params.get('title') || null,        // custom panel title
        hostUrl: params.get('hostUrl') || null,    // URL of the host app page (for Playwright navigation)
    };
}

// ─── localStorage Namespace ───

const panelParams = getPanelParams();
const NS = `tc_panel_${panelParams.instance}`;

function nsGet(key: string): string | null {
    return localStorage.getItem(`${NS}_${key}`);
}

// ─── Context-Aware Skill Suggestions ───
// These are driven by ?context= URL param from the host page.
// Each page embeds the panel with its own context, and the panel
// shows only the skills relevant to that page.

interface ContextSkill {
    icon: React.ReactNode;
    label: string;
    prompt: string;
    color: string;
}

function getContextSkills(context: string | null, mcpTools: Array<{ name: string; description: string }>): ContextSkill[] {
    // 1. If MCP tools are available, use them as primary skills
    if (mcpTools.length > 0) {
        const iconMap: Record<string, React.ReactNode> = {
            list: <Search size={13} />, get: <FileText size={13} />,
            analyz: <Sparkles size={13} />, suggest: <Sparkles size={13} />,
            update: <Wrench size={13} />, harmon: <BarChart3 size={13} />,
            search: <Search size={13} />, export: <BarChart3 size={13} />,
        };
        const colorMap: Record<string, string> = {
            list: '#06b6d4', get: '#3b82f6', analyz: '#a78bfa',
            suggest: '#8b5cf6', update: '#f59e0b', harmon: '#34d399',
            search: '#06b6d4', export: '#22c55e',
        };
        return mcpTools.slice(0, 5).map(tool => {
            const lower = tool.name.toLowerCase();
            const matchKey = Object.keys(iconMap).find(k => lower.includes(k));
            return {
                icon: matchKey ? iconMap[matchKey] : <Zap size={13} />,
                label: tool.description || tool.name,
                prompt: tool.description || `Используй ${tool.name}`,
                color: matchKey ? colorMap[matchKey] : '#818cf8',
            };
        });
    }

    // 2. Context-based suggestions when no MCP
    switch (context) {
        case 'risk_tree':
        case 'risks':
            return [
                { icon: <Search size={13} />, label: 'Показать все риски', prompt: 'Покажи все риски из реестра', color: '#06b6d4' },
                { icon: <Sparkles size={13} />, label: 'Анализ выбранного риска', prompt: 'Проанализируй выбранный риск — дай оценку P/I и рекомендации', color: '#a78bfa' },
                { icon: <BarChart3 size={13} />, label: 'Гармонизация по ГОСТ', prompt: 'Сделай гармонизацию реестра рисков по ГОСТ', color: '#34d399' },
                { icon: <TrendingUp size={13} />, label: 'Тренд-анализ', prompt: 'Покажи тренды по рискам за последний период', color: '#fbbf24' },
            ];
        case 'contracts':
            return [
                { icon: <FileText size={13} />, label: 'Анализ договора', prompt: 'Проанализируй текущий договор на ключевые риски', color: '#3b82f6' },
                { icon: <Search size={13} />, label: 'Поиск по условиям', prompt: 'Найди все пункты про ответственность сторон', color: '#06b6d4' },
                { icon: <AlertTriangle size={13} />, label: 'Проверка соответствия', prompt: 'Проверь договор на соответствие шаблону', color: '#f59e0b' },
            ];
        case 'documents':
            return [
                { icon: <FileText size={13} />, label: 'Суммаризация', prompt: 'Сделай краткое резюме документа', color: '#3b82f6' },
                { icon: <Sparkles size={13} />, label: 'Извлечение данных', prompt: 'Извлеки ключевые данные из документа', color: '#a78bfa' },
                { icon: <Search size={13} />, label: 'Поиск по документу', prompt: 'Найди в документе информацию о...', color: '#06b6d4' },
            ];
        case 'catalog':
        case 'kb':
            return [
                { icon: <Search size={13} />, label: 'Поиск продукции', prompt: 'Найди аналоги для указанной позиции', color: '#06b6d4' },
                { icon: <BarChart3 size={13} />, label: 'Сравнение позиций', prompt: 'Сравни характеристики выбранных позиций', color: '#34d399' },
                { icon: <Sparkles size={13} />, label: 'Подбор по ТЗ', prompt: 'Подбери продукцию по техническому заданию', color: '#a78bfa' },
            ];
        case 'radar':
            return [
                { icon: <Activity size={13} />, label: 'Объясни фазы радара', prompt: 'Объясни текущее состояние фаз на радаре рисков', color: '#06b6d4' },
                { icon: <AlertTriangle size={13} />, label: 'Найди критические', prompt: 'Какие риски сейчас в критической зоне радара?', color: '#ef4444' },
                { icon: <TrendingUp size={13} />, label: 'Прогноз динамики', prompt: 'Спрогнозируй динамику рисков на следующий период', color: '#fbbf24' },
                { icon: <BarChart3 size={13} />, label: 'Сравни кластеры', prompt: 'Сравни кластеры рисков по π и θ параметрам', color: '#34d399' },
            ];
        case 'harmonization':
            return [
                { icon: <FileText size={13} />, label: 'Статус плана', prompt: 'Покажи текущий статус плана гармонизации', color: '#3b82f6' },
                { icon: <Sparkles size={13} />, label: 'Предложи меры', prompt: 'Предложи меры митигации для незакрытых рисков', color: '#a78bfa' },
                { icon: <BarChart3 size={13} />, label: 'Оценка бюджета', prompt: 'Оцени бюджет на реализацию плана гармонизации', color: '#fbbf24' },
                { icon: <Terminal size={13} />, label: 'Экспорт в отчёт', prompt: 'Сформируй отчёт по плану гармонизации для руководства', color: '#34d399' },
            ];
        case 'investigations':
            return [
                { icon: <Search size={13} />, label: 'Создай расследование', prompt: 'Создай новое расследование инцидента', color: '#06b6d4' },
                { icon: <Sparkles size={13} />, label: 'Анализ 5 Why', prompt: 'Проведи анализ корневых причин методом 5 Why', color: '#a78bfa' },
                { icon: <AlertTriangle size={13} />, label: 'Найди причину', prompt: 'Определи корневую причину инцидента на основе данных', color: '#f59e0b' },
                { icon: <Activity size={13} />, label: 'Timeline событий', prompt: 'Построй хронологию событий инцидента', color: '#3b82f6' },
            ];
        case 'green_sheet':
            return [
                { icon: <FileText size={13} />, label: 'Описание мер', prompt: 'Опиши текущие меры митигации для выбранного риска', color: '#22c55e' },
                { icon: <Sparkles size={13} />, label: 'Оценка эффективности', prompt: 'Оцени эффективность текущих мер митигации', color: '#a78bfa' },
                { icon: <Search size={13} />, label: 'Связь с рисками', prompt: 'Покажи какие риски покрывает каждая мера', color: '#06b6d4' },
            ];
        case 'blue_sheet':
            return [
                { icon: <FileText size={13} />, label: 'Карточка риска', prompt: 'Покажи полную карточку выбранного риска', color: '#60a5fa' },
                { icon: <Activity size={13} />, label: 'История изменений', prompt: 'Покажи историю изменений параметров этого риска', color: '#06b6d4' },
                { icon: <Search size={13} />, label: 'Связанные меры', prompt: 'Какие меры митигации связаны с этим риском?', color: '#34d399' },
            ];
        case 'gold_sheet':
            return [
                { icon: <BarChart3 size={13} />, label: 'Сводка проекта', prompt: 'Покажи сводную информацию по проекту рисков', color: '#D4AF37' },
                { icon: <TrendingUp size={13} />, label: 'KPI рисков', prompt: 'Рассчитай ключевые KPI по управлению рисками', color: '#fbbf24' },
                { icon: <Sparkles size={13} />, label: 'Матрица P/I', prompt: 'Построй матрицу вероятность/воздействие для всех рисков', color: '#a78bfa' },
            ];
        case 'ai_control':
            return [
                { icon: <Activity size={13} />, label: 'Статус агентов', prompt: 'Покажи статус подключённых AI агентов и MCP серверов', color: '#06b6d4' },
                { icon: <Terminal size={13} />, label: 'Лог запросов', prompt: 'Покажи последние запросы и ответы агента', color: '#64748b' },
                { icon: <Database size={13} />, label: 'Настройки MCP', prompt: 'Покажи текущие настройки MCP подключений', color: '#a78bfa' },
            ];
        default:
            // Generic — no page-specific suggestions, just show a clean prompt
            return [
                { icon: <MessageSquare size={13} />, label: 'Задайте вопрос', prompt: '', color: '#818cf8' },
            ];
    }
}

function getContextGreeting(context: string | null): { title: string; subtitle: string } {
    switch (context) {
        case 'risk_tree':
        case 'risks':
            return { title: 'Управление рисками', subtitle: 'Анализ, оценка и мониторинг рисков' };
        case 'radar':
            return { title: 'Радар рисков', subtitle: 'Мониторинг фаз и кластеров' };
        case 'harmonization':
            return { title: 'Гармонизация', subtitle: 'План мероприятий и меры митигации' };
        case 'investigations':
            return { title: 'Расследования', subtitle: 'Root Cause Analysis и 5 Why' };
        case 'green_sheet':
            return { title: 'Зелёный лист', subtitle: 'Меры митигации и их эффективность' };
        case 'blue_sheet':
            return { title: 'Синий лист', subtitle: 'Детальные карточки рисков' };
        case 'gold_sheet':
            return { title: 'Золотой лист', subtitle: 'Сводка и KPI проекта' };
        case 'ai_control':
            return { title: 'AI Control Center', subtitle: 'Управление агентами и MCP серверами' };
        case 'contracts':
            return { title: 'Работа с договорами', subtitle: 'Анализ и проверка контрактных документов' };
        case 'documents':
            return { title: 'Обработка документов', subtitle: 'Суммаризация, извлечение и анализ' };
        case 'catalog':
        case 'kb':
            return { title: 'Каталог продукции', subtitle: 'Поиск, подбор и сравнение позиций' };
        default:
            return { title: 'Чем могу помочь?', subtitle: 'Задайте вопрос или выберите действие' };
    }
}

// ═══════════════════════════════════════════
//  Context-Specific System Prompts
//  Each page gets a unique expert role
// ═══════════════════════════════════════════

function getContextSystemPrompt(context: string | null): string {
    const params = getPanelParams();
    const hostUrl = params.hostUrl;

    const browserInstructions = hostUrl
        ? `

## Взаимодействие со страницей (Playwright Browser)
У тебя есть инструменты Playwright для ПРЯМОГО взаимодействия с веб-страницей приложения.
Текущая страница приложения: ${hostUrl}

Порядок действий:
1. Сначала НАВИГИРУЙ: mcp_playwright_browser_navigate с url="${hostUrl}"
2. Затем СМОТРИ: mcp_playwright_browser_snapshot — получишь accessibility tree с ref-ами элементов
3. КЛИК: mcp_playwright_browser_click с ref (из snapshot) и element (описание)
4. ВВОД: mcp_playwright_browser_type с ref и text
5. СКРИНШОТ: mcp_playwright_browser_screenshot (при необходимости)

ВАЖНО:
- ВСЕГДА начинай с browser_navigate перед первым snapshot!
- snapshot возвращает дерево элементов с ref-ами — используй ref для кликов и ввода
- Предпочитай snapshot вместо screenshot (экономит токены)
- Если страница пуста (about:blank) — значит ты не навигировал!`
        : `

## Взаимодействие со страницей (Playwright Browser)
У тебя есть инструменты Playwright для взаимодействия с веб-страницами.
Чтобы начать — спроси у пользователя URL страницы, или используй mcp_playwright_browser_navigate с нужным URL.
После навигации используй mcp_playwright_browser_snapshot чтобы увидеть содержимое страницы.`;

    const base = `Ты — AI-ассистент платформы ЛОМ (Управление рисками нефтегазовых проектов). Отвечай на русском. Используй MCP tools для доступа к реальным данным. Формат ответов:
— Начинай с **жирного заголовка** секции
— Используй нумерованные списки для приоритетов
— Приводи конкретные ID рисков (R1, R2...), значения pi, theta, P, I
— Завершай секцией **Рекомендация:** с конкретным действием${browserInstructions}`;

    switch (context) {
        case 'risk_tree':
        case 'risks':
            return `${base}

Ты — эксперт по ДЕРЕВУ РИСКОВ. Твоя роль: анализ иерархии рисков, связей parent→child, каскадных эффектов.

Знания:
- Каждый риск имеет: ID, shortName, description, P (вероятность 0-1), I (влияние 0-1), pi (π = P×I - 1), theta (фаза 0-360°), статус
- pi < -0.3 = высокое негативное влияние, требует приоритетной проработки
- Каскадный эффект: если R_parent критический, все R_child наследуют повышенный уровень
- Уровни: НИЗКИЙ (pi > -0.1), СРЕДНИЙ (-0.3 < pi < -0.1), ВЫСОКИЙ (pi < -0.3), КРИТИЧЕСКИЙ (pi < -0.5)

При анализе риска всегда указывай:
1. **Оценка текущего состояния** — pi, P, I, уровень
2. **Ключевые наблюдения** — связи, каскады, триггеры
3. **Рекомендация:** — конкретное действие`;

        case 'radar':
            return `${base}

Ты — эксперт по РАДАРУ РИСКОВ. Твоя роль: мониторинг фаз (theta), кластеров, динамики рисков на полярном графике.

Знания:
- Радар показывает риски в полярных координатах: угол θ = фаза жизненного цикла, радиус = |π|
- Фазы: 0-90° (Идентификация), 90-180° (Оценка), 180-270° (Митигация), 270-360° (Мониторинг)
- Кластеры — группы рисков в одном секторе, могут усиливать друг друга
- "Горячие зоны": кластеры с pi < -0.3 в фазах 0-90° — необработанные критические риски
- Скорость ∂θ/∂t показывает, как быстро риск проходит жизненный цикл

При анализе радара всегда:
1. **Состояние фаз** — сколько рисков в каждой фазе
2. **Горячие кластеры** — ID, pi, theta, почему опасны
3. **Прогноз:** — куда движутся кластеры`;

        case 'harmonization':
            return `${base}

Ты — эксперт по ГАРМОНИЗАЦИИ. Твоя роль: формирование плана мероприятий, выбор рисков для проработки, оценка бюджета.

Знания:
- Гармонизация = процесс планирования мероприятий по митигации рисков
- Выбор рисков для проработки: начинать с pi < -0.3, уровень ВЫСОКИЙ/КРИТИЧЕСКИЙ
- Каскадный эффект: риски со связями гасят несколько проблем одновременно
- Синергии: мероприятия, покрывающие 2+ рисков, снижают бюджет
- Конфликты: мероприятия, противоречащие друг другу
- KPI гармонизации: ∑Δpi (суммарное снижение pi), покрытие (% рисков с мероприятиями)

При гармонизации:
1. **Выбор рисков для проработки** — топ по pi с обоснованием
2. **Генерация мероприятий** — конкретные шаги, ответственные, сроки
3. **Синергии и конфликты** — какие мероприятия можно объединить
4. **Рекомендация:** — оптимальный план`;

        case 'investigations':
            return `${base}

Ты — эксперт по РАССЛЕДОВАНИЯМ ИНЦИДЕНТОВ (RCA). Твоя роль: Root Cause Analysis, метод 5 Why, построение таймлайнов.

Знания:
- Root Cause Analysis (RCA) — поиск первопричины инцидента через систематический анализ
- Метод 5 Why: последовательные "Почему?" до корневой причины
- Таймлайн инцидента: хронология событий с привязкой к рискам
- Категории причин: Люди, Процессы, Технология, Среда
- Каждое расследование привязано к конкретным рискам из реестра

При расследовании:
1. **Описание инцидента** — что произошло, когда, последствия
2. **Анализ 5 Why** — цепочка причин до корневой
3. **Связь с рисками** — какие R_id были затронуты
4. **Корректирующие действия:** — что сделать, чтобы не повторилось`;

        case 'green_sheet':
            return `${base}

Ты — эксперт по ЗЕЛЁНОМУ ЛИСТУ. Твоя роль: анализ мер митигации и их эффективности.

Знания:
- Зелёный лист = реестр мероприятий по митигации рисков
- Каждое мероприятие: название, описание, статус, ответственный, дедлайн, связанные риски
- Эффективность = Δpi (насколько снизился pi после внедрения меры)
- Статусы: Планируется, В работе, Выполнено, Просрочено
- Покрытие: % рисков с хотя бы одной активной мерой

При анализе:
1. **Статус мероприятий** — сколько выполнено/в работе/просрочено
2. **Эффективность** — какие меры дали наибольший Δpi
3. **Рекомендация:** — приоритетные меры для запуска`;

        case 'blue_sheet':
            return `${base}

Ты — эксперт по СИНЕМУ ЛИСТУ. Твоя роль: детальные карточки рисков, их история и полная информация.

Знания:
- Синий лист = детальная карточка каждого риска
- Содержит: описание, категория, владелец, даты, история изменений P/I/pi
- Связанные документы, триггеры, индикаторы раннего предупреждения
- Тренд: рост или снижение pi за последние периоды
- Зрелость: насколько хорошо проработан риск (описание, меры, мониторинг)

При анализе карточки:
1. **Полная информация** — все параметры риска
2. **История изменений** — как менялись P, I, pi
3. **Связанные меры** — привязанные мероприятия из зелёного листа
4. **Рекомендация:** — что нужно доработать`;

        case 'gold_sheet':
            return `${base}

Ты — эксперт по ЗОЛОТОМУ ЛИСТУ. Твоя роль: сводная аналитика, KPI проекта, матрица P/I.

Знания:
- Золотой лист = executive summary по всей системе управления рисками
- KPI: общий π-score проекта (∑pi/N), покрытие мерами (%), % критических рисков
- Матрица P/I: распределение рисков по осям Вероятность × Влияние (5×5 матрица)
- Тренды: улучшается или ухудшается общая ситуация
- Benchmarks: сравнение с отраслевыми стандартами (ГОСТ Р ИСО 31000)

При анализе:
1. **Сводка KPI** — ключевые метрики одним взглядом
2. **Матрица P/I** — где сконцентрированы риски
3. **Тренд** — динамика за период
4. **Рекомендация:** — стратегические приоритеты`;

        case 'ai_control':
            return `${base}

Ты — эксперт по AI CONTROL CENTER. Твоя роль: управление AI-агентами, MCP-серверами, конфигурация моделей.

Знания:
- AI Control Center = панель управления AI-инфраструктурой платформы
- MCP (Model Context Protocol) — протокол для подключения AI к внешним инструментам
- Каждый MCP-сервер предоставляет набор tools (list_risks, analyze_risk, etc.)
- Модели: google/gemini-2.5-flash, openai/gpt-4o, etc.
- Мониторинг: latency, token usage, error rate, cache hit ratio

При анализе:
1. **Статус серверов** — какие MCP подключены, их health
2. **Логи выполнения** — последние запросы и результаты
3. **Рекомендация:** — оптимизация конфигурации`;

        default:
            return `${base}

Ты — универсальный AI-ассистент платформы ЛОМ. Помогаешь с любыми вопросами по управлению рисками нефтегазовых проектов.`;
    }
}


// ═══════════════════════════════════════════
//  Subcomponents
// ═══════════════════════════════════════════

// ─── Helpers ───

const formatTime = (d: Date | undefined): string => {
    if (!d) return '';
    const date = d instanceof Date ? d : new Date(d);
    return date.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
};

// ─── Progress Steps (Harmonization pattern) ───

const ProgressSteps: React.FC<{ steps: ExecutionStep[] }> = ({ steps }) => {
    const [expanded, setExpanded] = useState(false);
    const toolSteps = steps?.filter(s => s.type === 'tool' && s.toolName) || [];
    const planningSteps = steps?.filter(s => s.type === 'planning') || [];
    const allSteps = [...planningSteps, ...toolSteps];
    if (allSteps.length === 0) return null;

    const visibleSteps = expanded ? allSteps : allSteps.slice(0, 4);

    return (
        <div style={{
            background: 'rgba(30,41,59,0.5)', borderRadius: 8, padding: '8px 10px', marginBottom: 8,
            border: '1px solid #1e293b',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: '#64748b', fontWeight: 600, letterSpacing: 0.5 }}>Progress Updates</span>
                {allSteps.length > 4 && (
                    <button
                        onClick={() => setExpanded(!expanded)}
                        style={{ fontSize: 10, color: '#818cf8', cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
                    >
                        {expanded ? 'Collapse' : 'Expand all'}
                    </button>
                )}
            </div>
            {visibleSteps.map((step, i) => (
                <div key={step.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11,
                    marginTop: i === 0 ? 0 : 3, color: '#cbd5e1', lineHeight: 1.5,
                }}>
                    <span style={{ color: '#475569', fontSize: 10, minWidth: 12, textAlign: 'right', flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
                    <span style={{ flex: 1 }}>{step.toolName || step.label || step.detail}</span>
                    <Check size={11} style={{ color: '#34d399', flexShrink: 0, marginTop: 3 }} />
                </div>
            ))}
        </div>
    );
};

// ─── Feedback Buttons (Good/Bad) ───

const FeedbackButtons: React.FC<{ messageId: string }> = ({ messageId }) => {
    const [feedback, setFeedback] = useState<'good' | 'bad' | null>(null);

    if (feedback) {
        return (
            <span style={{ fontSize: 10, color: '#475569' }}>
                {feedback === 'good' ? '👍' : '👎'}
            </span>
        );
    }

    return (
        <div style={{ display: 'flex', gap: 4 }}>
            <button
                onClick={() => setFeedback('good')}
                style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 10,
                    color: '#475569', padding: '2px 4px', borderRadius: 4,
                    transition: 'color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#34d399')}
                onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
                title="Good"
            >
                Good 👍
            </button>
            <button
                onClick={() => setFeedback('bad')}
                style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 10,
                    color: '#475569', padding: '2px 4px', borderRadius: 4,
                    transition: 'color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
                title="Bad"
            >
                Bad 👎
            </button>
        </div>
    );
};

// ─── Panel Message (Harmonization Agent pattern) ───

const PanelMessage: React.FC<{
    message: Message;
    allArtifacts: Record<string, Artifact>;
    onOpenArtifact: (id: string) => void;
}> = ({ message, allArtifacts, onOpenArtifact }) => {
    const isUser = message.role === 'user';
    const timeStr = formatTime(message.timestamp);

    if (isUser) {
        return (
            <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 3 }}>
                    <div style={{
                        background: 'linear-gradient(135deg, rgba(6,182,212,0.18), rgba(59,130,246,0.14))',
                        border: '1px solid rgba(6,182,212,0.25)',
                        borderRadius: '12px 12px 4px 12px',
                        padding: '10px 14px', fontSize: 12, color: '#67e8f9',
                        whiteSpace: 'pre-wrap', maxWidth: '88%',
                    }}>
                        {message.content}
                    </div>
                </div>
                {timeStr && (
                    <div style={{ textAlign: 'right', fontSize: 9, color: '#475569', marginTop: 2, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        <Clock size={8} /> {timeStr}
                    </div>
                )}
            </div>
        );
    }

    // Assistant message — structured card
    return (
        <div style={{ marginBottom: 14 }}>
            {/* Agent label */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                <div style={{
                    width: 20, height: 20, borderRadius: 6,
                    background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <Bot size={10} color="#fff" />
                </div>
                <span style={{ fontSize: 10, color: '#64748b', flex: 1 }}>Agent</span>
                {message.executionSteps && message.executionSteps.length > 0 && (
                    <span style={{ fontSize: 9, color: '#475569' }}>
                        {message.executionSteps.filter(s => s.type === 'tool').length} steps · {message.executionSteps.filter(s => s.signed !== undefined).length > 0 ? `${message.executionSteps.filter(s => s.signed !== undefined).length}/${message.executionSteps.length} signed` : ''}
                    </span>
                )}
                {message.signature && (
                    <span style={{ fontSize: 9, color: '#34d399', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Shield size={8} /> verified
                    </span>
                )}
            </div>

            {/* Progress steps (if present) */}
            {message.executionSteps && message.executionSteps.length > 0 && (
                <ProgressSteps steps={message.executionSteps} />
            )}

            {/* Main response card */}
            <div style={{
                background: '#1e293b', border: '1px solid #293548',
                borderRadius: 10, padding: '12px 14px', fontSize: 12, color: '#cbd5e1',
            }}>
                <div className="tc-markdown" style={{ lineHeight: 1.65 }}>{renderFullMarkdown(message.content)}</div>
            </div>

            {/* Artifacts */}
            {message.artifactIds && message.artifactIds.length > 0 && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {message.artifactIds.map(aid => {
                        const art = allArtifacts[aid];
                        if (!art) return null;
                        return (
                            <button key={aid} onClick={() => onOpenArtifact(aid)} style={{
                                width: '100%', textAlign: 'left', padding: '8px 10px',
                                background: 'rgba(99,102,241,0.12)', borderLeft: '2px solid #818cf8',
                                borderRadius: 6, color: '#a5b4fc', fontSize: 11, cursor: 'pointer', border: 'none',
                            }}>
                                📄 {art.title}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Footer: timestamp + feedback */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                {timeStr && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#475569' }}>
                        <Clock size={8} /> {timeStr}
                    </div>
                )}
                <FeedbackButtons messageId={message.id} />
            </div>
        </div>
    );
};

// ─── Welcome Screen (Context-Aware) ───

const WelcomeContent: React.FC<{
    context: string | null;
    agentReady: boolean;
    mcpStatus: string;
    skills: ContextSkill[];
    toolCount: number;
    onSkillClick: (prompt: string) => void;
}> = ({ context, agentReady, mcpStatus, skills, toolCount, onSkillClick }) => {
    const greeting = getContextGreeting(context);

    return (
        <div style={{ padding: '0 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100%' }}>
            {/* ── Logo + Greeting ── */}
            <div style={{ textAlign: 'center', marginBottom: 20, paddingTop: 24 }}>
                <div style={{
                    width: 48, height: 48, borderRadius: 14,
                    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 8px 24px rgba(139,92,246,0.25)',
                    marginBottom: 12,
                }}>
                    <Shield size={22} color="#fff" />
                </div>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0', marginBottom: 4 }}>{greeting.title}</div>
                <div style={{ fontSize: 12, color: '#64748b', maxWidth: 240, margin: '0 auto' }}>{greeting.subtitle}</div>
            </div>

            {/* ── Status pills ── */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 24, justifyContent: 'center' }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    background: agentReady ? 'rgba(52,211,153,0.10)' : 'rgba(239,68,68,0.10)',
                    border: `1px solid ${agentReady ? 'rgba(52,211,153,0.25)' : 'rgba(239,68,68,0.25)'}`,
                    borderRadius: 12, padding: '4px 10px', fontSize: 10,
                    color: agentReady ? '#6ee7b7' : '#fca5a5',
                }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: agentReady ? '#34d399' : '#ef4444' }} />
                    {agentReady ? 'Агент готов' : 'Нет API key'}
                </div>
                {mcpStatus === 'connected' && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.25)',
                        borderRadius: 12, padding: '4px 10px', fontSize: 10, color: '#6ee7b7',
                    }}>
                        <Activity size={10} /> MCP
                    </div>
                )}
                {toolCount > 0 && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: 'rgba(99,102,241,0.10)', border: '1px solid rgba(99,102,241,0.25)',
                        borderRadius: 12, padding: '4px 10px', fontSize: 10, color: '#a5b4fc',
                    }}>
                        <Wrench size={10} /> {toolCount}
                    </div>
                )}
            </div>

            {/* ── Contextual Skills ── */}
            {skills.length > 0 && skills[0].prompt !== '' && (
                <div style={{ width: '100%', maxWidth: 320 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {skills.map((skill) => (
                            <button
                                key={skill.label}
                                onClick={() => onSkillClick(skill.prompt)}
                                style={{
                                    width: '100%', textAlign: 'left',
                                    background: '#1e293b', border: '1px solid #334155',
                                    borderRadius: 10, padding: '10px 12px',
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    cursor: 'pointer', transition: 'all 0.2s',
                                    color: '#cbd5e1', fontSize: 12,
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.borderColor = skill.color;
                                    e.currentTarget.style.background = 'rgba(30,41,59,0.8)';
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.borderColor = '#334155';
                                    e.currentTarget.style.background = '#1e293b';
                                }}
                            >
                                <span style={{ color: skill.color, display: 'flex', alignItems: 'center', flexShrink: 0 }}>{skill.icon}</span>
                                <span style={{ flex: 1 }}>{skill.label}</span>
                                <ChevronRight size={12} style={{ color: '#475569', flexShrink: 0 }} />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Security note ── */}
            <div style={{ marginTop: 24, textAlign: 'center' }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#475569' }}>
                    <Lock size={9} /> Ed25519 подписи · данные в контуре
                </div>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════
//  Main Panel App
// ═══════════════════════════════════════════

const PanelApp: React.FC = () => {
    const params = useMemo(() => getPanelParams(), []);

    const {
        messages, setMessages,
        inputValue, setInputValue,
        isTyping, setIsTyping,
        activeArtifactId, setActiveArtifactId,
        dynamicArtifacts, setDynamicArtifacts,
        messagesEndRef, inputRef,
    } = useChatState([]);

    const agent = useAgent();
    const [mcpStatus, setMcpStatus] = useState<'connecting' | 'connected' | 'offline'>('offline');
    const [mcpTools, setMcpTools] = useState<Array<{ name: string; description: string }>>([]);
    const [viewingArtifact, setViewingArtifact] = useState<Artifact | null>(null);
    const [hostSkills, setHostSkills] = useState<ContextSkill[]>([]);

    // ── Listen for postMessage from host page ──
    useEffect(() => {
        const handleMessage = (e: MessageEvent) => {
            if (!e.data || typeof e.data !== 'object') return;

            // Host can send context-specific skills
            if (e.data.type === 'trustchain:skills') {
                const skills: ContextSkill[] = (e.data.skills || []).map((s: any) => ({
                    icon: <Zap size={13} />,
                    label: s.label || s.name,
                    prompt: s.prompt || s.command || '',
                    color: s.color || '#818cf8',
                }));
                setHostSkills(skills);
            }

            // Host can send a pre-filled query
            if (e.data.type === 'trustchain:query') {
                setInputValue(e.data.text || '');
                inputRef.current?.focus();
            }

            // Host can directly auto-send a query
            if (e.data.type === 'trustchain:auto_query' && e.data.text) {
                setInputValue(e.data.text);
                // Auto-send will be triggered by effect
                setTimeout(() => {
                    const btn = document.querySelector('[data-send-btn]') as HTMLButtonElement;
                    btn?.click();
                }, 100);
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Derive current skills (host > MCP > context fallback) ──
    const currentSkills = useMemo(() => {
        if (hostSkills.length > 0) return hostSkills;
        return getContextSkills(params.context, mcpTools);
    }, [hostSkills, params.context, mcpTools]);

    // ── Auto-initialize agent ──
    useEffect(() => {
        const savedKey = nsGet('api_key') || localStorage.getItem('tc_api_key');
        const envKey = (import.meta as any).env?.VITE_OPENAI_API_KEY;
        const apiKey = savedKey || envKey;
        const savedModel = nsGet('model') || localStorage.getItem('tc_model') || 'google/gemini-2.5-flash';
        if (apiKey && !agent.isInitialized) {
            agent.initialize({ apiKey, model: savedModel });
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Auto-connect MCP ──
    useEffect(() => {
        if (!params.mcpUrl) return;
        const connectMCP = async () => {
            setMcpStatus('connecting');
            try {
                const mcpConfig = {
                    id: `panel_${params.instance}`,
                    name: `Panel MCP (${params.instance})`,
                    url: params.mcpUrl!,
                    transport: 'sse' as const,
                    enabled: true,
                };
                const existingConfigs = JSON.parse(localStorage.getItem('mcp_servers') || '[]');
                const filtered = existingConfigs.filter((c: any) => c.id !== mcpConfig.id);
                filtered.push(mcpConfig);
                localStorage.setItem('mcp_servers', JSON.stringify(filtered));

                const response = await fetch(`${params.mcpUrl}/tools`, { signal: AbortSignal.timeout(5000) });
                if (response.ok) {
                    const data = await response.json();
                    const tools = data.tools || data || [];
                    setMcpTools(tools.map((t: any) => ({ name: t.name, description: t.description || t.name })));
                    setMcpStatus('connected');
                } else {
                    setMcpStatus('offline');
                }
            } catch {
                try {
                    const health = await fetch(`${params.mcpUrl!.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(3000) });
                    setMcpStatus(health.ok ? 'connected' : 'offline');
                } catch { setMcpStatus('offline'); }
            }
        };
        connectMCP();
    }, [params.mcpUrl, params.instance]);

    // ── Callbacks ──
    useEffect(() => {
        agentCallbacksService.configure({
            onArtifactCreated: (artifact) => {
                setDynamicArtifacts(prev => ({ ...prev, [artifact.id]: { ...artifact, createdAt: new Date(), version: 1 } }));
                setActiveArtifactId(artifact.id);
            },
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Extract artifacts ──
    const extractArtifactsFromEvents = useCallback((events: any[]) => {
        const artifactIds: string[] = [];
        const newArtifacts: Record<string, Artifact> = {};
        const toolCallNames: Record<string, string> = {};
        for (const ev of events) {
            if (ev.type === 'tool_call') toolCallNames[ev.id] = ev.name;
            if (ev.type === 'tool_result') {
                const callName = toolCallNames[ev.toolCallId || ''] || '';
                if (callName !== 'create_artifact' && callName !== 'create_file') continue;
                let result: any;
                try { result = typeof ev.result === 'string' ? JSON.parse(ev.result) : ev.result; } catch { continue; }
                if (result?.id || result?.artifact_id) {
                    const artId = result.id || result.artifact_id;
                    artifactIds.push(artId);
                    newArtifacts[artId] = {
                        id: artId, type: (result.type || 'document') as any,
                        title: result.title || result.name || 'Artifact',
                        content: result.content || JSON.stringify(result, null, 2),
                        createdAt: new Date(), version: 1,
                    };
                }
            }
        }
        return { artifactIds, newArtifacts };
    }, []);

    // ── Send page action to host (for agent→page bridge) ──
    const sendPageAction = useCallback((action: string, payload: Record<string, any> = {}) => {
        try {
            window.parent.postMessage({
                type: 'trustchain:action',
                action,
                payload,
            }, '*');
            console.log('[TC Panel] Sent page action:', action, payload);
        } catch { /* iframe security */ }
    }, []);

    // ── Send message ──
    const handleSend = useCallback(async () => {
        if (!inputValue.trim()) return;
        const text = inputValue.trim();
        const userMsg: Message = { id: `m_${Date.now()}`, role: 'user', content: text, timestamp: new Date() };
        setMessages(prev => [...prev, userMsg]);
        setInputValue('');
        setIsTyping(true);
        if (inputRef.current) inputRef.current.style.height = 'auto';

        if (agent.isInitialized) {
            if (messages.length === 0) chatHistoryService.startSession(`Panel (${params.instance})`, 'openai');
            chatHistoryService.addMessage({ role: 'user', content: text, timestamp: new Date() });
            const systemPrompt = getContextSystemPrompt(params.context);
            const chatHistory = [
                { role: 'system' as const, content: systemPrompt },
                ...messages.filter(m => (m.role as string) !== 'assistant_temp').map(m => ({ role: m.role, content: m.content })),
            ];

            const result = await agent.sendMessage(text, undefined, chatHistory);
            const events = result?.events || [];
            const { artifactIds: createdArtifactIds, newArtifacts } = extractArtifactsFromEvents(events);
            if (Object.keys(newArtifacts).length > 0) setDynamicArtifacts(prev => ({ ...prev, ...newArtifacts }));

            const assistantMsg: Message = {
                id: `m_${Date.now() + 1}`, role: 'assistant',
                content: result?.text || 'Агент обработал запрос.',
                timestamp: new Date(),
                ...(createdArtifactIds.length > 0 && { artifactIds: createdArtifactIds }),
                executionSteps: events.map((ev: any) => {
                    if (ev.type === 'thinking') return { id: ev.id, type: 'planning' as const, label: ev.title || 'Reasoning', detail: ev.content, latencyMs: 0 };
                    if (ev.type === 'tool_call') return { id: ev.id, type: 'tool' as const, label: ev.name, toolName: ev.name, args: ev.arguments, detail: `Executing ${ev.name}`, latencyMs: 0, signed: false };
                    return { id: ev.id, type: 'tool' as const, label: 'Result', detail: typeof ev.result === 'string' ? ev.result?.substring(0, 150) : JSON.stringify(ev.result)?.substring(0, 150), latencyMs: 0 };
                }),
            };
            setMessages(prev => [...prev, assistantMsg]);
            setIsTyping(false);
            chatHistoryService.addMessage({ role: 'assistant', content: assistantMsg.content, timestamp: assistantMsg.timestamp });

            // Notify host of result
            try {
                window.parent.postMessage({
                    type: 'trustchain:response',
                    text: assistantMsg.content,
                    hasArtifacts: createdArtifactIds.length > 0,
                }, '*');
            } catch { /* iframe security */ }

            // ── Agent→Page Bridge: intercept page actions from tool results ──
            for (const ev of events) {
                // Check for __page_action__ markers in MCP tool results
                if (ev.type === 'tool_result') {
                    if (ev.result && typeof ev.result === 'string') {
                        try {
                            const parsed = JSON.parse(ev.result);
                            if (parsed?.__page_action__) {
                                sendPageAction(parsed.__page_action__.action, parsed.__page_action__.payload || {});
                            }
                        } catch { /* not JSON */ }
                    }
                    if (ev.result && typeof ev.result === 'object' && ev.result?.__page_action__) {
                        sendPageAction(ev.result.__page_action__.action, ev.result.__page_action__.payload || {});
                    }
                }
                // Auto-refresh after data mutations
                if (ev.type === 'tool_call' && ev.name && ['update_risk'].includes(ev.name)) {
                    sendPageAction('refresh_data');
                }
            }
        } else {
            setMessages(prev => [...prev, { id: `m_${Date.now() + 1}`, role: 'assistant', content: '⚠️ Настройте API ключ в TrustChain Agent для работы.', timestamp: new Date() }]);
            setIsTyping(false);
        }
    }, [inputValue, messages, agent, params.instance, extractArtifactsFromEvents]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    }, [handleSend]);

    const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInputValue(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
    }, []);

    const handleSkillClick = useCallback((prompt: string) => {
        if (!prompt) return;
        setInputValue(prompt);
        inputRef.current?.focus();
    }, []);

    const handleOpenArtifact = useCallback((id: string) => {
        const art = dynamicArtifacts[id];
        if (art) setViewingArtifact(art);
    }, [dynamicArtifacts]);

    const panelTitle = params.title || 'TrustChain Agent';

    // ═══════════════════════════════════════════
    //  RENDER
    // ═══════════════════════════════════════════

    return (
        <div style={{
            width: '100%', height: '100vh', display: 'flex', flexDirection: 'column',
            background: 'linear-gradient(180deg, #0f172a 0%, #0c1222 100%)',
            color: '#e2e8f0', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            position: 'relative',
        }}>
            {/* ── Header ── */}
            <div style={{
                padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderBottom: '1px solid #1e293b', flexShrink: 0,
                background: 'linear-gradient(180deg, #151d2e 0%, #0f172a 100%)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                        width: 26, height: 26, borderRadius: 8,
                        background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 2px 8px rgba(139,92,246,0.3)',
                    }}>
                        <Bot size={14} color="#fff" />
                    </div>
                    <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', lineHeight: 1.2 }}>{panelTitle}</div>
                        <div style={{ fontSize: 9, color: '#64748b' }}>Ed25519 · Verified</div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: agent.isInitialized ? 'rgba(52,211,153,0.12)' : 'rgba(239,68,68,0.12)',
                        border: `1px solid ${agent.isInitialized ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)'}`,
                        borderRadius: 12, padding: '3px 8px', fontSize: 10,
                        color: agent.isInitialized ? '#6ee7b7' : '#fca5a5',
                    }}>
                        <div style={{
                            width: 5, height: 5, borderRadius: '50%',
                            background: agent.isInitialized ? '#34d399' : '#ef4444',
                            boxShadow: agent.isInitialized ? '0 0 6px rgba(52,211,153,0.5)' : 'none',
                        }} />
                        {agent.isInitialized ? 'Online' : 'Offline'}
                    </div>
                </div>
            </div>

            {/* ── Chat Area / Welcome ── */}
            <div style={{
                flex: 1, overflowY: 'auto', padding: '10px 12px', minHeight: 0,
                scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent',
            }}>
                {messages.length === 0 ? (
                    <WelcomeContent
                        context={params.context}
                        agentReady={agent.isInitialized}
                        mcpStatus={mcpStatus}
                        skills={currentSkills}
                        toolCount={agent.tools.length}
                        onSkillClick={handleSkillClick}
                    />
                ) : (
                    <div>
                        {messages.map(msg => (
                            <PanelMessage key={msg.id} message={msg} allArtifacts={dynamicArtifacts} onOpenArtifact={handleOpenArtifact} />
                        ))}
                        {isTyping && (
                            <div style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                    <div style={{ width: 20, height: 20, borderRadius: 6, background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <Bot size={10} color="#fff" />
                                    </div>
                                    <span style={{ fontSize: 10, color: '#64748b' }}>TrustChain Agent</span>
                                </div>
                                <div style={{ background: '#1e293b', borderRadius: 10, padding: '10px 12px', fontFamily: 'monospace', fontSize: 11, border: '1px solid #334155' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#06b6d4' }}>
                                        <Loader2 size={12} className="animate-spin" />
                                        <span>Обработка запроса...</span>
                                    </div>
                                    {agent.streamingText && <div style={{ marginTop: 6, color: '#cbd5e1' }}>{agent.streamingText}</div>}
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* ── Artifact Viewer Overlay ── */}
            {viewingArtifact && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, color: '#e2e8f0' }}>📄 {viewingArtifact.title}</span>
                        <button onClick={() => setViewingArtifact(null)} style={{ color: '#94a3b8', cursor: 'pointer', background: 'none', border: 'none' }}><X size={16} /></button>
                    </div>
                    <div style={{ flex: 1, overflow: 'auto', padding: 12, fontSize: 12, color: '#cbd5e1' }} className="tc-markdown">
                        {renderFullMarkdown(viewingArtifact.content)}
                    </div>
                </div>
            )}

            {/* ── Footer ── */}
            <div style={{ flexShrink: 0, padding: '8px 12px 10px', borderTop: '1px solid #1e293b' }}>
                {isTyping && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 11 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#94a3b8' }}>
                            <Loader2 size={10} className="animate-spin" /><span>Generating...</span>
                        </div>
                        <button onClick={() => { agent.abort(); setIsTyping(false); }} style={{
                            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3,
                            color: '#ef4444', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
                            borderRadius: 6, padding: '2px 8px', fontSize: 10, cursor: 'pointer',
                        }}>
                            Stop
                        </button>
                    </div>
                )}
                <div style={{ position: 'relative' }}>
                    <textarea
                        ref={inputRef} value={inputValue} onChange={handleInput} onKeyDown={handleKeyDown}
                        placeholder="Введите запрос..." rows={1}
                        style={{
                            width: '100%', padding: '10px 40px 10px 12px',
                            background: '#1e293b', border: '1px solid #334155',
                            borderRadius: 12, color: '#e2e8f0', fontSize: 12,
                            resize: 'none', outline: 'none', maxHeight: 120,
                            fontFamily: 'inherit', lineHeight: 1.4,
                            transition: 'border-color 0.2s', boxSizing: 'border-box',
                        }}
                        onFocus={e => e.target.style.borderColor = '#6366f1'}
                        onBlur={e => e.target.style.borderColor = '#334155'}
                    />
                    <button
                        data-send-btn
                        onClick={handleSend}
                        disabled={!inputValue.trim() || isTyping}
                        style={{
                            position: 'absolute', right: 6, bottom: 6,
                            width: 28, height: 28, borderRadius: 8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: 'none',
                            cursor: inputValue.trim() && !isTyping ? 'pointer' : 'default',
                            background: inputValue.trim() && !isTyping ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : '#334155',
                            color: inputValue.trim() && !isTyping ? '#fff' : '#64748b',
                            boxShadow: inputValue.trim() && !isTyping ? '0 2px 8px rgba(99,102,241,0.4)' : 'none',
                            transition: 'all 0.2s',
                        }}
                    >
                        <ArrowUp size={14} />
                    </button>
                </div>
                <div style={{ textAlign: 'center', marginTop: 4 }}>
                    <span style={{ fontSize: 9, color: '#334155' }}>Ed25519 · Shift+Enter для переноса</span>
                </div>
            </div>
        </div>
    );
};

export default PanelApp;
