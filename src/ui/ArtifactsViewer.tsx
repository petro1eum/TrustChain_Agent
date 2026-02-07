/**
 * Компонент для просмотра artifacts
 * Показывает список artifacts и позволяет просматривать их содержимое
 */

import React, { useState, useEffect } from 'react';
import { X, FileText, Code, FileCode, Image, File, Trash2, RefreshCw, Loader2 } from 'lucide-react';
import { ArtifactsService, artifactsPollingService } from '../services/artifacts';
import { ArtifactRenderer } from './artifacts';
import type { ArtifactInfo, ArtifactContent } from '../services/artifacts/types';

interface ArtifactsViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

const ArtifactsViewer: React.FC<ArtifactsViewerProps> = ({ isOpen, onClose }) => {
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Загрузка списка artifacts
  const loadArtifacts = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await ArtifactsService.listArtifacts();
      setArtifacts(list);
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки artifacts');
    } finally {
      setLoading(false);
    }
  };

  // Загрузка содержимого artifact
  const loadArtifactContent = async (filename: string) => {
    setLoadingContent(true);
    setError(null);
    try {
      const content = await ArtifactsService.getArtifact(filename);
      if (content) {
        setSelectedArtifact(content);
      } else {
        setError(`Не удалось загрузить artifact: ${filename}`);
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки содержимого');
    } finally {
      setLoadingContent(false);
    }
  };

  // Удаление artifact
  const handleDelete = async (filename: string) => {
    if (!confirm(`Удалить artifact "${filename}"?`)) {
      return;
    }

    try {
      const success = await ArtifactsService.deleteArtifact(filename);
      if (success) {
        // Обновляем список
        await loadArtifacts();
        // Если удаленный artifact был выбран - очищаем
        if (selectedArtifact?.filename === filename) {
          setSelectedArtifact(null);
        }
      } else {
        setError('Не удалось удалить artifact');
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка удаления');
    }
  };

  // Иконка для типа artifact
  const getArtifactIcon = (type: string) => {
    switch (type) {
      case 'markdown':
        return <FileText className="w-4 h-4" />;
      case 'code':
        return <Code className="w-4 h-4" />;
      case 'react':
        return <FileCode className="w-4 h-4" />;
      case 'html':
        return <FileCode className="w-4 h-4" />;
      case 'svg':
        return <Image className="w-4 h-4" />;
      case 'image':
        return <Image className="w-4 h-4" />;
      case 'excel':
        return <File className="w-4 h-4 text-green-600" />;
      case 'pdf':
        return <File className="w-4 h-4 text-red-600" />;
      case 'word':
        return <File className="w-4 h-4 text-blue-600" />;
      default:
        return <File className="w-4 h-4" />;
    }
  };

  // Форматирование размера
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Загрузка при открытии
  useEffect(() => {
    if (isOpen) {
      loadArtifacts();

      // Запускаем polling
      artifactsPollingService.start((updatedArtifacts) => {
        // Проверяем что это массив
        if (Array.isArray(updatedArtifacts)) {
          setArtifacts(updatedArtifacts);
        }
      });
    } else {
      // Останавливаем polling при закрытии
      artifactsPollingService.stop();
    }

    return () => {
      artifactsPollingService.stop();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl w-full h-full max-w-7xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-gray-900">Artifacts</h2>
            <button
              onClick={loadArtifacts}
              disabled={loading}
              className="p-1 hover:bg-gray-100 rounded text-gray-600 disabled:opacity-50"
              title="Обновить список"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <span className="text-sm text-gray-500">
              {artifacts.length} artifacts
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-100 rounded text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Список artifacts */}
          <div className="w-80 border-r border-gray-200 flex flex-col">
            <div className="flex-1 overflow-y-auto p-2">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                </div>
              ) : error ? (
                <div className="p-4 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
                  {error}
                </div>
              ) : !Array.isArray(artifacts) || artifacts.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Нет artifacts</p>
                  <p className="text-xs mt-2">Artifacts создаются агентом в /mnt/user-data/outputs</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {artifacts.map((artifact) => (
                    <div
                      key={artifact.filename}
                      onClick={() => loadArtifactContent(artifact.filename)}
                      className={`p-3 rounded-lg border cursor-pointer transition-colors group ${selectedArtifact?.filename === artifact.filename
                        ? 'bg-blue-50 border-blue-300'
                        : 'bg-white border-gray-200 hover:bg-gray-50'
                        }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="text-gray-600 mt-0.5">
                          {getArtifactIcon(artifact.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {artifact.filename}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                            <span className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
                              {artifact.type}
                            </span>
                            <span>{formatSize(artifact.size)}</span>
                          </div>
                          {artifact.created_at && (
                            <div className="text-xs text-gray-400 mt-1">
                              {new Date(artifact.created_at).toLocaleString('ru-RU')}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(artifact.filename);
                          }}
                          className="p-1 hover:bg-red-100 rounded text-red-600 transition-opacity"
                          title="Удалить"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Просмотр artifact */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {loadingContent ? (
              <div className="flex items-center justify-center flex-1">
                <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
              </div>
            ) : selectedArtifact ? (
              <div className="flex-1 overflow-y-auto p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">
                      {selectedArtifact.filename}
                    </h3>
                    <div className="text-sm text-gray-500 mt-1">
                      {formatSize(selectedArtifact.size)} • {selectedArtifact.type}
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedArtifact(null)}
                    className="p-2 hover:bg-gray-100 rounded text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <ArtifactRenderer artifact={selectedArtifact} />
              </div>
            ) : (
              <div className="flex items-center justify-center flex-1 text-gray-500">
                <div className="text-center">
                  <FileText className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p>Выберите artifact для просмотра</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ArtifactsViewer;

