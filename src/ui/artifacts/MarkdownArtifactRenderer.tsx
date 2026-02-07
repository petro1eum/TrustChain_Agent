/**
 * Рендерер для Markdown artifacts
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { ArtifactContent } from '../../services/artifacts/types';

interface MarkdownArtifactRendererProps {
  artifact: ArtifactContent;
}

export const MarkdownArtifactRenderer: React.FC<MarkdownArtifactRendererProps> = ({ artifact }) => {
  return (
    <div className="artifact-renderer artifact-markdown border border-gray-200 rounded-lg p-4 bg-white">
      <div className="mb-2 text-xs text-gray-500 font-mono">
        {artifact.filename} ({artifact.size} bytes)
      </div>
      <div className="prose prose-sm max-w-none">
        <ReactMarkdown>{artifact.content}</ReactMarkdown>
      </div>
    </div>
  );
};

