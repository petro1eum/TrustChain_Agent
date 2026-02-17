/**
 * Главный компонент для рендеринга artifacts
 * Определяет тип artifact и использует соответствующий рендерер
 */

import React from 'react';
import type { ArtifactContent } from '../../services/artifacts/types';
import { MarkdownArtifactRenderer } from './MarkdownArtifactRenderer';
import { HTMLArtifactRenderer } from './HTMLArtifactRenderer';
import { ReactArtifactRenderer } from './ReactArtifactRenderer';
import { SVGArtifactRenderer } from './SVGArtifactRenderer';
import { CodeArtifactRenderer } from './CodeArtifactRenderer';
import { ExcelArtifactRenderer } from './ExcelArtifactRenderer';
import { PDFArtifactRenderer } from './PDFArtifactRenderer';
import { WordArtifactRenderer } from './WordArtifactRenderer';
import { ImageArtifactRenderer } from './ImageArtifactRenderer';
import { PythonArtifactRenderer } from './PythonArtifactRenderer';

interface ArtifactRendererProps {
  artifact: ArtifactContent;
}

export const ArtifactRenderer: React.FC<ArtifactRendererProps> = ({ artifact }) => {
  switch (artifact.type) {
    case 'markdown':
      return <MarkdownArtifactRenderer artifact={artifact} />;

    case 'html':
      return <HTMLArtifactRenderer artifact={artifact} />;

    case 'react':
      return <ReactArtifactRenderer artifact={artifact} />;

    case 'svg':
      return <SVGArtifactRenderer artifact={artifact} />;

    case 'code': {
      // Route Python code to the executable Python terminal
      const isPython = artifact.language === 'python'
        || artifact.filename?.endsWith('.py')
        || /^(import |from |def |class |print\()/m.test(artifact.content);
      if (isPython) {
        return <PythonArtifactRenderer artifact={artifact} />;
      }
      return <CodeArtifactRenderer artifact={artifact} />;
    }

    case 'excel':
      return <ExcelArtifactRenderer artifact={artifact} />;

    case 'pdf':
      return <PDFArtifactRenderer artifact={artifact} />;

    case 'word':
      return <WordArtifactRenderer artifact={artifact} />;

    case 'image':
      return <ImageArtifactRenderer artifact={artifact} />;

    case 'mermaid':
      // Mermaid требует специальной библиотеки, пока показываем как код
      return <CodeArtifactRenderer artifact={artifact} />;

    case 'text':
    default:
      return (
        <div className="artifact-renderer artifact-text border border-gray-200 rounded-lg p-4 bg-white">
          <div className="mb-2 text-xs text-gray-500 font-mono">
            {artifact.filename} ({artifact.size} bytes)
          </div>
          <pre className="whitespace-pre-wrap text-sm font-mono bg-gray-50 p-3 rounded border">
            {artifact.content}
          </pre>
        </div>
      );
  }
};

