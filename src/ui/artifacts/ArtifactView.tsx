/**
 * Компонент для полноэкранного просмотра артефакта
 * Позволяет переключиться на артефакт и вернуться обратно к чату
 */

import React, { useState, useEffect } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { ArtifactsService } from '../../services/artifacts';
import { ArtifactRenderer } from './ArtifactRenderer';
import type { ArtifactContent } from '../../services/artifacts/types';

interface ArtifactViewProps {
  filename: string;
  onBack: () => void;
}

export const ArtifactView: React.FC<ArtifactViewProps> = ({ filename, onBack }) => {
  const [artifact, setArtifact] = useState<ArtifactContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadArtifact = async () => {
      setLoading(true);
      setError(null);
      try {
        const content = await ArtifactsService.getArtifact(filename);
        if (content) {
          setArtifact(content);
        } else {
          setError(`Не удалось загрузить artifact: ${filename}`);
        }
      } catch (err: any) {
        setError(err.message || 'Ошибка загрузки артефакта');
      } finally {
        setLoading(false);
      }
    };

    loadArtifact();
  }, [filename]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600">Загрузка артефакта...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={onBack}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-gray-700"
          >
            Вернуться к чату
          </button>
        </div>
      </div>
    );
  }

  if (!artifact) {
    return null;
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header с кнопкой возврата */}
      <div className="flex items-center justify-between p-4 bg-white border-b border-gray-200 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Вернуться к чату
          </button>
          <div className="h-6 w-px bg-gray-300" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{artifact.filename}</h2>
            <p className="text-xs text-gray-500">
              {artifact.type} • {formatSize(artifact.size)}
            </p>
          </div>
        </div>
      </div>

      {/* Контент артефакта */}
      <div className="flex-1 overflow-auto p-4">
        <ArtifactRenderer artifact={artifact} />
      </div>
    </div>
  );
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

