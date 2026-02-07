/**
 * Сервис для загрузки метаданных skills
 * 
 * ВАЖНО: В браузере нет доступа к Node.js fs модулю!
 * Поэтому загружаем skills через view инструмент (Docker API) при первом использовании.
 * 
 * Для оптимизации можно предзагрузить список skills при инициализации приложения
 * или использовать backend API endpoint для загрузки метаданных.
 */

import type { SkillMetadata } from './types';
import { parseFrontmatter, extractCategoryInfo } from './skillsMetadataParser';
import { dockerAgentService } from '../dockerAgentService';

/**
 * Сервис для загрузки метаданных skills
 */
export class SkillsLoaderService {
  private static skillsCache: SkillMetadata[] | null = null;
  private static loadingPromise: Promise<SkillMetadata[]> | null = null;
  private static initialized = false;

  /**
   * Предопределенный список путей к SKILL.md файлам
   * Можно расширить или загрузить динамически через view
   */
  private static readonly SKILL_PATHS = [
    // === Public skills (5) ===
    '/mnt/skills/public/docx/SKILL.md',
    '/mnt/skills/public/pdf/SKILL.md',
    '/mnt/skills/public/pptx/SKILL.md',
    '/mnt/skills/public/xlsx/SKILL.md',
    '/mnt/skills/public/product-self-knowledge/SKILL.md',

    // === Category Management (14) ===
    '/mnt/skills/kb-tools/category-management/test-category-search/SKILL.md',
    '/mnt/skills/kb-tools/category-management/run-category-diagnostic/SKILL.md',
    '/mnt/skills/kb-tools/category-management/get-category-config/SKILL.md',
    '/mnt/skills/kb-tools/category-management/troubleshoot-search-problems/SKILL.md',
    '/mnt/skills/kb-tools/category-management/follow-diagnostic-protocol/SKILL.md',
    '/mnt/skills/kb-tools/category-management/manage-category-lifecycle/SKILL.md',
    '/mnt/skills/kb-tools/category-management/add-new-category/SKILL.md',
    '/mnt/skills/kb-tools/category-management/get-category-info/SKILL.md',
    '/mnt/skills/kb-tools/category-management/get-category-backups/SKILL.md',
    '/mnt/skills/kb-tools/category-management/validate-category-config/SKILL.md',
    '/mnt/skills/kb-tools/category-management/get-category-param-coverage/SKILL.md',
    '/mnt/skills/kb-tools/category-management/restore-category-backup/SKILL.md',
    '/mnt/skills/kb-tools/category-management/save-category-config/SKILL.md',
    '/mnt/skills/kb-tools/category-management/get-diagnostic-history/SKILL.md',

    // === Computer Use (4) ===
    '/mnt/skills/kb-tools/computer-use/view/SKILL.md',
    '/mnt/skills/kb-tools/computer-use/bash-tool/SKILL.md',
    '/mnt/skills/kb-tools/computer-use/create-file/SKILL.md',
    '/mnt/skills/kb-tools/computer-use/str-replace/SKILL.md',

    // === Code Execution (6) ===
    '/mnt/skills/kb-tools/code-execution/execute-code/SKILL.md',
    '/mnt/skills/kb-tools/code-execution/execute-bash/SKILL.md',
    '/mnt/skills/kb-tools/code-execution/load-tool/SKILL.md',
    '/mnt/skills/kb-tools/code-execution/list-tools/SKILL.md',
    '/mnt/skills/kb-tools/code-execution/import-tool/SKILL.md',
    '/mnt/skills/kb-tools/code-execution/save-tool/SKILL.md',

    // === Web Tools (5) ===
    '/mnt/skills/kb-tools/web-tools/web-search/SKILL.md',
    '/mnt/skills/kb-tools/web-tools/web-fetch/SKILL.md',
    '/mnt/skills/kb-tools/web-tools/read-project-file/SKILL.md',
    '/mnt/skills/kb-tools/web-tools/get-synonyms-preview/SKILL.md',
    '/mnt/skills/kb-tools/web-tools/search-files-by-name/SKILL.md',

    // === File Tools (1) ===
    '/mnt/skills/kb-tools/file-tools/extract-table-to-excel/SKILL.md',

    // === Data Processing (10) ===
    '/mnt/skills/kb-tools/data-processing/missing-data/SKILL.md',
    '/mnt/skills/kb-tools/data-processing/normalize-data/SKILL.md',
    '/mnt/skills/kb-tools/data-processing/data-quality/SKILL.md',
    '/mnt/skills/kb-tools/data-processing/access-source-file/SKILL.md',
    '/mnt/skills/kb-tools/data-processing/add-to-workspace/SKILL.md',
    '/mnt/skills/kb-tools/data-processing/smart-lookup/SKILL.md',
    '/mnt/skills/kb-tools/data-processing/pandas-operation/SKILL.md',
    '/mnt/skills/kb-tools/data-processing/outliers/SKILL.md',
    '/mnt/skills/kb-tools/data-processing/semantic-analysis/SKILL.md',
    '/mnt/skills/kb-tools/data-processing/text-processing/SKILL.md',

    // === Frontend Navigation (11) ===
    '/mnt/skills/kb-tools/frontend-navigation/navigate-to-tab/SKILL.md',
    '/mnt/skills/kb-tools/frontend-navigation/navigate-to-subtab/SKILL.md',
    '/mnt/skills/kb-tools/frontend-navigation/get-current-screen/SKILL.md',
    '/mnt/skills/kb-tools/frontend-navigation/get-app-structure/SKILL.md',
    '/mnt/skills/kb-tools/frontend-navigation/select-category/SKILL.md',
    '/mnt/skills/kb-tools/frontend-navigation/select-product/SKILL.md',
    '/mnt/skills/kb-tools/frontend-navigation/search-ui/SKILL.md',
    '/mnt/skills/kb-tools/frontend-navigation/apply-filters/SKILL.md',
    '/mnt/skills/kb-tools/frontend-navigation/get-screen-data/SKILL.md',
    '/mnt/skills/kb-tools/frontend-navigation/get-selected-items/SKILL.md',
    '/mnt/skills/kb-tools/frontend-navigation/click-element/SKILL.md',

    // === Backend API (5) ===
    '/mnt/skills/kb-tools/backend-api/backend-api-call/SKILL.md',
    '/mnt/skills/kb-tools/backend-api/get-yaml-file/SKILL.md',
    '/mnt/skills/kb-tools/backend-api/save-yaml-file/SKILL.md',
    '/mnt/skills/kb-tools/backend-api/list-api-endpoints/SKILL.md',
    '/mnt/skills/kb-tools/backend-api/list-data-files/SKILL.md',

    // === Examples (9) ===
    '/mnt/skills/examples/skill-creator/SKILL.md',
    '/mnt/skills/examples/web-artifacts-builder/SKILL.md',
    '/mnt/skills/examples/algorithmic-art/SKILL.md',
    '/mnt/skills/examples/brand-guidelines/SKILL.md',
    '/mnt/skills/examples/canvas-design/SKILL.md',
    '/mnt/skills/examples/internal-comms/SKILL.md',
    '/mnt/skills/examples/mcp-builder/SKILL.md',
    '/mnt/skills/examples/slack-gif-creator/SKILL.md',
    '/mnt/skills/examples/theme-factory/SKILL.md',
  ];

  /**
   * Проверяет, инициализирован ли сервис
   */
  static isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Загружает метаданные всех skills
   * 
   * Использует view инструмент для чтения frontmatter из каждого SKILL.md файла.
   * Кеширует результат для последующих вызовов.
   * 
   * @returns Массив метаданных skills
   */
  static async loadAllSkillsMetadata(): Promise<SkillMetadata[]> {
    // Если уже загружены - возвращаем из кеша
    if (this.initialized && this.skillsCache !== null) {
      return this.skillsCache;
    }

    // Если идет загрузка - ждем ее завершения
    if (this.loadingPromise) {
      return this.loadingPromise;
    }

    // Начинаем загрузку
    this.loadingPromise = this._loadSkillsMetadata();

    try {
      this.skillsCache = await this.loadingPromise;
      this.initialized = true;
      return this.skillsCache;
    } finally {
      this.loadingPromise = null;
    }
  }

  /**
   * Внутренний метод загрузки метаданных
   */
  private static async _loadSkillsMetadata(): Promise<SkillMetadata[]> {
    const skills: SkillMetadata[] = [];

    // Загружаем метаданные каждого skill через view
    for (const containerPath of this.SKILL_PATHS) {
      try {
        const metadata = await this.loadSkillMetadataFromView(containerPath);
        if (metadata) {
          skills.push(metadata);
        }
      } catch (error) {
        // Игнорируем ошибки для отдельных skills
        console.warn(`Не удалось загрузить skill ${containerPath}:`, error);
      }
    }

    return skills;
  }

  /**
   * Загружает метаданные одного skill через view инструмент
   * 
   * ВАЖНО: Этот метод читает только первые 20 строк (frontmatter) для быстрой загрузки метаданных.
   * Для получения ПОЛНОГО содержимого SKILL.md используйте loadFullSkillContent().
   * 
   * @param containerPath - Путь к SKILL.md в контейнере
   * @returns Метаданные skill или null
   */
  static async loadSkillMetadataFromView(
    containerPath: string
  ): Promise<SkillMetadata | null> {
    try {
      // Читаем первые 20 строк через view (только frontmatter для метаданных)
      // ПРИМЕЧАНИЕ: Для полного содержимого используйте loadFullSkillContent()
      const response = await dockerAgentService.view({
        path: containerPath,
        view_range: [1, 20],
        description: 'Загружаю метаданные skill для auto-triggering'
      });

      if (response.type !== 'file' || !response.content) {
        return null;
      }

      const metadata = parseFrontmatter(response.content);
      if (!metadata || !metadata.name || !metadata.description) {
        return null;
      }

      // Извлекаем категорию из пути
      const categoryInfo = extractCategoryInfo(containerPath);

      return {
        name: metadata.name,
        description: metadata.description,
        license: metadata.license,
        hostPath: containerPath, // В контейнере путь уже правильный
        containerPath: containerPath,
        category: categoryInfo.category,
        subcategory: categoryInfo.subcategory
      };
    } catch (error) {
      console.error(`Ошибка загрузки метаданных skill ${containerPath}:`, error);
      return null;
    }
  }

  /**
   * Загружает ПОЛНОЕ содержимое SKILL.md без ограничения view_range
   * 
   * КРИТИЧНО: Согласно документации KB_AGENT_SKILLS.md, при активации skill
   * необходимо читать ВЕСЬ файл SKILL.md, чтобы получить полные инструкции.
   * 
   * @param containerPath - Путь к SKILL.md в контейнере
   * @returns Полное содержимое файла или null при ошибке
   */
  static async loadFullSkillContent(
    containerPath: string
  ): Promise<string | null> {
    try {
      // КРИТИЧНО: Читаем БЕЗ view_range - получаем полный файл!
      const response = await dockerAgentService.view({
        path: containerPath,
        // НЕ указываем view_range - читаем весь файл
        description: 'Загружаю полное содержимое SKILL.md для выполнения'
      });

      if (response.type !== 'file' || !response.content) {
        console.warn(`[SkillsLoader] Не удалось загрузить полный skill: ${containerPath}`);
        return null;
      }

      console.log(`[SkillsLoader] Загружен полный skill (${response.content.length} символов): ${containerPath}`);
      return response.content;
    } catch (error) {
      console.error(`Ошибка загрузки полного skill ${containerPath}:`, error);
      return null;
    }
  }

  /**
   * Очищает кеш skills
   */
  static clearCache(): void {
    this.skillsCache = null;
    this.loadingPromise = null;
    this.initialized = false;
  }

  /**
   * Получает закешированные skills
   */
  static getCachedSkills(): SkillMetadata[] | null {
    return this.skillsCache;
  }

  /**
   * Форматирует skills metadata для system prompt
   */
  static formatSkillsForPrompt(): string {
    if (!this.initialized || !this.skillsCache || this.skillsCache.length === 0) {
      return '';
    }

    const skills = this.skillsCache;

    let xml = '<available_skills>\n';

    for (const skill of skills) {
      xml += '<skill>\n';
      xml += `<name>${skill.name}</name>\n`;
      xml += `<description>${skill.description}</description>\n`;
      xml += `<location>${skill.containerPath}</location>\n`;
      if (skill.category) {
        xml += `<category>${skill.category}</category>\n`;
      }
      xml += '</skill>\n\n';
    }

    xml += '</available_skills>';
    return xml;
  }
}

