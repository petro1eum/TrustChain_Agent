/**
 * Рендерер для SVG artifacts
 */

import React from 'react';
import type { ArtifactContent } from '../../services/artifacts/types';

interface SVGArtifactRendererProps {
  artifact: ArtifactContent;
}

export const SVGArtifactRenderer: React.FC<SVGArtifactRendererProps> = ({ artifact }) => {
  // Проверяем что это валидный SVG
  const isSVG = artifact.content.trim().startsWith('<svg') || artifact.content.includes('<svg');

  if (!isSVG) {
    return (
      <div className="artifact-renderer artifact-svg border border-yellow-200 rounded-lg p-4 bg-yellow-50">
        <div className="text-sm text-yellow-800">
          Файл не содержит валидный SVG контент
        </div>
        <div className="text-xs text-yellow-600 mt-1 font-mono">
          {artifact.filename}
        </div>
      </div>
    );
  }

  return (
    <div className="artifact-renderer artifact-svg border border-gray-200 rounded-lg p-4 bg-white">
      <div className="mb-2 text-xs text-gray-500 font-mono">
        {artifact.filename} ({artifact.size} bytes)
      </div>
      <div 
        className="w-full flex items-center justify-center bg-gray-50 rounded border border-gray-200 p-4"
        dangerouslySetInnerHTML={{ __html: artifact.content }}
      />
    </div>
  );
};

