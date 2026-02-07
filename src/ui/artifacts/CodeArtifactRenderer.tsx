/**
 * Рендерер для Code artifacts (JS, TS, Python, etc.)
 */

import React from 'react';
import { Copy } from 'lucide-react';
import type { ArtifactContent } from '../../services/artifacts/types';

interface CodeArtifactRendererProps {
  artifact: ArtifactContent;
}

export const CodeArtifactRenderer: React.FC<CodeArtifactRendererProps> = ({ artifact }) => {
  const handleCopy = () => {
    navigator.clipboard.writeText(artifact.content);
  };

  // Определяем язык по расширению файла
  const getLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    const langMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'py': 'python',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'css': 'css',
      'html': 'html',
      'xml': 'xml',
      'sh': 'bash',
      'md': 'markdown'
    };
    return langMap[ext || ''] || 'text';
  };

  return (
    <div className="artifact-renderer artifact-code border border-gray-200 rounded-lg overflow-hidden bg-gray-900">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="text-xs text-gray-400 font-mono">
          {artifact.filename} ({artifact.size} bytes)
        </div>
        <button
          onClick={handleCopy}
          className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
          title="Копировать код"
        >
          <Copy className="w-4 h-4" />
        </button>
      </div>
      <pre className="p-4 overflow-x-auto">
        <code className={`language-${getLanguage(artifact.filename)}`}>
          {artifact.content}
        </code>
      </pre>
    </div>
  );
};

