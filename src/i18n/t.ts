/**
 * Хелпер для использования i18n в non-React коде (agents, services)
 * 
 * Пример использования:
 *   import { t } from '../i18n/t';
 *   const msg = t('agent.noResponse');
 */

import i18n from './index';

/**
 * Функция перевода для использования вне React компонентов
 */
export function t(key: string, options?: Record<string, unknown>): string {
    return i18n.t(key, options);
}

/**
 * Получить текущий язык
 */
export function getCurrentLanguage(): string {
    return i18n.language;
}

/**
 * Изменить язык программно
 */
export function changeLanguage(lang: string): Promise<void> {
    return i18n.changeLanguage(lang) as unknown as Promise<void>;
}

export default t;
