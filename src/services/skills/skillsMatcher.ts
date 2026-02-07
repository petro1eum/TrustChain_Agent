/**
 * Сервис для поиска релевантных skills по запросу пользователя
 * 
 * ВАЖНО: Этот сервис использует простой keyword matching только для ПРЕДВАРИТЕЛЬНОЙ фильтрации.
 * Основная семантическая relевантность определяется LLM при обработке system prompt.
 * LLM видит все skills с описаниями и сам решает какие использовать.
 */

import type { SkillMetadata, SkillsMatchResult } from './types';

/**
 * Сервис для поиска релевантных skills
 */
export class SkillsMatcher {
  /**
   * Находит релевантные skills по запросу пользователя
   * 
   * ВАЖНО: Это ПРЕДВАРИТЕЛЬНАЯ фильтрация для оптимизации context window.
   * LLM сам понимает семантику запроса и описаний skills.
   * Мы включаем ВСЕ skills в system prompt если их немного,
   * или делаем грубую фильтрацию если их много.
   * 
   * @param query - Запрос пользователя
   * @param allSkills - Все доступные skills
   * @param maxResults - Максимальное количество результатов (по умолчанию 10)
   * @returns Результат поиска с релевантными skills
   */
  static findRelevantSkills(
    query: string,
    allSkills: SkillMetadata[],
    maxResults: number = 10  // Увеличили лимит - LLM разберется
  ): SkillsMatchResult {
    if (!query || !allSkills || allSkills.length === 0) {
      return { skills: [], count: 0 };
    }

    // Если skills мало - возвращаем все, LLM сам разберется
    if (allSkills.length <= maxResults) {
      return {
        skills: allSkills,
        count: allSkills.length
      };
    }

    const lowerQuery = query.toLowerCase();
    const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 2);

    // Оцениваем релевантность каждого skill
    const scoredSkills = allSkills.map(skill => {
      const score = this.calculateRelevanceScore(skill, lowerQuery, queryWords);
      return { skill, score };
    });

    // Сортируем по релевантности (по убыванию)
    scoredSkills.sort((a, b) => b.score - a.score);

    // Берем топ-N skills
    // Важно: берем даже со score 0, потому что LLM понимает семантику
    // которую мы не можем уловить ключевыми словами
    const relevantSkills = scoredSkills
      .slice(0, maxResults)
      .map(item => item.skill);

    return {
      skills: relevantSkills,
      count: relevantSkills.length
    };
  }

  /**
   * Вычисляет релевантность skill для запроса
   * 
   * Это ГРУБАЯ оценка для сортировки, а не для отсечения.
   * LLM понимает семантику лучше чем keyword matching.
   * 
   * @param skill - Метаданные skill
   * @param lowerQuery - Запрос в нижнем регистре
   * @param queryWords - Слова из запроса
   * @returns Оценка релевантности (0-100)
   */
  private static calculateRelevanceScore(
    skill: SkillMetadata,
    lowerQuery: string,
    queryWords: string[]
  ): number {
    let score = 0;

    const lowerName = skill.name.toLowerCase();
    const lowerDescription = skill.description.toLowerCase();
    // Включаем категорию и подкатегорию в поиск
    const lowerCategory = (skill.category || '').toLowerCase();
    const lowerSubcategory = (skill.subcategory || '').toLowerCase();
    const fullText = `${lowerName} ${lowerDescription} ${lowerCategory} ${lowerSubcategory}`;

    // Точное совпадение имени (высокий приоритет)
    if (lowerName === lowerQuery) {
      score += 50;
    }

    // Имя содержит запрос
    if (lowerName.includes(lowerQuery)) {
      score += 30;
    }

    // Слова из запроса в полном тексте (name + description + category)
    for (const word of queryWords) {
      if (fullText.includes(word)) {
        score += 5;
      }
    }

    // Бонус за категорию kb-tools (приоритет для KB-specific skills)
    if (skill.category === 'kb-tools') {
      score += 3;
    }

    // Бонус за category-management подкатегорию
    if (skill.subcategory === 'category-management') {
      score += 5;
    }

    return Math.min(score, 100);
  }

  /**
   * Проверяет, релевантен ли skill для запроса
   * 
   * @param query - Запрос пользователя
   * @param description - Описание skill
   * @returns true если skill релевантен
   */
  static isRelevant(query: string, description: string): boolean {
    const lowerQuery = query.toLowerCase();
    const lowerDescription = description.toLowerCase();

    // Простая проверка: есть ли слова из запроса в описании
    const queryWords = lowerQuery.split(/\s+/).filter(w => w.length > 2);

    for (const word of queryWords) {
      if (lowerDescription.includes(word)) {
        return true;
      }
    }

    return false;
  }
}
