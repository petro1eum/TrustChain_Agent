/**
 * Обертка для ArtifactRenderer, которая загружает артефакт по filename
 * Используется в ChatArea для отображения артефактов inline
 */

import React, { useState, useEffect } from 'react';
import { Loader2, ExternalLink } from 'lucide-react';
import { ArtifactsService } from '../../services/artifacts';
import { ArtifactRenderer } from './ArtifactRenderer';
import type { ArtifactContent } from '../../services/artifacts/types';

interface ArtifactRendererWithFilenameProps {
  filename: string;
  onSwitchToArtifact?: (filename: string) => void;
}

export const ArtifactRendererWithFilename: React.FC<ArtifactRendererWithFilenameProps> = ({ 
  filename,
  onSwitchToArtifact 
}) => {
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
      <span className="flex items-center justify-center py-8 border border-gray-200 rounded-lg bg-gray-50">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400 mr-2" />
        <span className="text-sm text-gray-600">Загрузка артефакта...</span>
      </span>
    );
  }

  if (error) {
    return (
      <span className="block p-4 border border-red-200 rounded-lg bg-red-50">
        <span className="block text-sm text-red-800">{error}</span>
      </span>
    );
  }

  if (!artifact) {
    return null;
  }

  return (
    <span className="block relative group">
      {/* Кнопка переключения на артефакт — всегда видна, заметнее при hover */}
      {onSwitchToArtifact && (
        <button
          onClick={() => onSwitchToArtifact(filename)}
          className="absolute top-2 right-2 z-10 flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-md opacity-70 hover:opacity-100 transition-opacity"
          title="Переключиться на артефакт (полноэкранный просмотр)"
        >
          <ExternalLink className="w-3 h-3" />
          Переключиться на артефакт
        </button>
      )}
      
      {/* Рендеринг артефакта */}
      <ArtifactRenderer artifact={artifact} />
    </span>
  );
};

