/**
 * Типы для Skills Auto-Triggering системы
 */

export interface SkillMetadata {
  /** Имя skill (из frontmatter) */
  name: string;
  
  /** Описание skill (из frontmatter) */
  description: string;
  
  /** Лицензия (опционально) */
  license?: string;
  
  /** Путь к файлу SKILL.md на хосте */
  hostPath: string;
  
  /** Путь к файлу SKILL.md в контейнере (для view инструмента) */
  containerPath: string;
  
  /** Категория skill (public/examples/kb-tools) */
  category: string;
  
  /** Подкатегория (например, category-management, web-tools) */
  subcategory?: string;
}

export interface SkillsMatchResult {
  /** Релевантные skills */
  skills: SkillMetadata[];
  
  /** Количество найденных skills */
  count: number;
}

