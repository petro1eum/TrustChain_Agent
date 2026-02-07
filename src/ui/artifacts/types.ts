/**
 * Типы для компонентов artifacts
 */

export interface ArtifactRendererProps {
  artifact: {
    filename: string;
    path: string;
    content: string;
    type: string;
    size: number;
  };
}

