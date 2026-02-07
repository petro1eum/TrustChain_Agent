/**
 * Парсер метаданных из YAML frontmatter в SKILL.md файлах
 */

import type { SkillMetadata } from './types';

/**
 * Парсит YAML frontmatter из начала файла SKILL.md
 * 
 * @param content - Содержимое файла (первые 20 строк)
 * @returns Распарсенные метаданные или null если frontmatter не найден
 */
export function parseFrontmatter(content: string): Partial<SkillMetadata> | null {
  // Ищем YAML frontmatter между --- и ---
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  
  if (!frontmatterMatch) {
    return null;
  }
  
  const yamlContent = frontmatterMatch[1];
  const metadata: Partial<SkillMetadata> = {};
  
  // Простой парсер YAML (только для name, description, license)
  // Для более сложных случаев можно использовать библиотеку js-yaml
  const nameMatch = yamlContent.match(/^name:\s*(.+)$/m);
  const descMatch = yamlContent.match(/^description:\s*(.+)$/m);
  const licenseMatch = yamlContent.match(/^license:\s*(.+)$/m);
  
  if (nameMatch) {
    // Убираем кавычки если есть
    metadata.name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
  }
  
  if (descMatch) {
    // Убираем кавычки если есть
    metadata.description = descMatch[1].trim().replace(/^["']|["']$/g, '');
  }
  
  if (licenseMatch) {
    metadata.license = licenseMatch[1].trim().replace(/^["']|["']$/g, '');
  }
  
  // Если нет name или description - это невалидный skill
  if (!metadata.name || !metadata.description) {
    return null;
  }
  
  return metadata;
}

/**
 * Извлекает путь контейнера из пути хоста
 * 
 * @param hostPath - Путь на хосте
 * @returns Путь в контейнере
 */
export function getContainerPath(hostPath: string): string {
  // Путь на хосте: admin_app_backend/ai_studio/app/src/agent-tools/skills/...
  // Путь в контейнере: /mnt/skills/...
  
  const skillsIndex = hostPath.indexOf('agent-tools/skills/');
  if (skillsIndex === -1) {
    return hostPath;
  }
  
  const relativePath = hostPath.substring(skillsIndex + 'agent-tools/skills/'.length);
  return `/mnt/skills/${relativePath}`;
}

/**
 * Извлекает категорию и подкатегорию из пути
 * 
 * @param path - Путь (может быть хостовым или контейнерным)
 * @returns Объект с category и subcategory
 */
export function extractCategoryInfo(path: string): { category: string; subcategory?: string } {
  // Примеры путей:
  // .../skills/public/docx/SKILL.md -> category: 'public', subcategory: undefined
  // .../skills/kb-tools/category-management/test-category-search/SKILL.md -> category: 'kb-tools', subcategory: 'category-management'
  // /mnt/skills/public/docx/SKILL.md -> category: 'public', subcategory: undefined
  // /mnt/skills/kb-tools/category-management/test-category-search/SKILL.md -> category: 'kb-tools', subcategory: 'category-management'
  
  // Ищем паттерн skills/... или /mnt/skills/...
  const skillsMatch = path.match(/(?:mnt\/)?skills\/([^\/]+)\/([^\/]+)/);
  if (!skillsMatch) {
    return { category: 'unknown' };
  }
  
  const category = skillsMatch[1];
  const secondPart = skillsMatch[2];
  
  // Если второй элемент это SKILL.md - значит нет подкатегории
  // Иначе это подкатегория (например, category-management)
  const subcategory = secondPart !== 'SKILL.md' && !secondPart.endsWith('.md') ? secondPart : undefined;
  
  return { category, subcategory };
}

