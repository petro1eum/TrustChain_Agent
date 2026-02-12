/**
 * Компонент для рендеринга Word файлов (.docx, .doc)
 * Показывает информацию о файле и позволяет скачать его
 * Для просмотра содержимого можно использовать конвертацию в HTML через pandoc (если доступен)
 */

import React, { useState, useMemo } from 'react';
import { Download, FileText, Loader2, AlertCircle, Eye } from 'lucide-react';
import type { ArtifactContent } from '../../services/artifacts/types';

interface WordArtifactRendererProps {
  artifact: ArtifactContent;
}

export const WordArtifactRenderer: React.FC<WordArtifactRendererProps> = ({ artifact }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Создаем blob URL для Word файла
  const wordUrl = useMemo(() => {
    try {
      // Декодируем base64 в бинарные данные
      const binaryString = atob(artifact.content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Создаем blob и URL
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
      const url = URL.createObjectURL(blob);
      return url;
    } catch (err: any) {
      console.error('Ошибка создания Word URL:', err);
      setError(err.message || 'Не удалось загрузить Word файл');
      return null;
    }
  }, [artifact.content]);

  // Очистка URL при размонтировании
  React.useEffect(() => {
    return () => {
      if (wordUrl) {
        URL.revokeObjectURL(wordUrl);
      }
    };
  }, [wordUrl]);

  // Попытка получить предпросмотр через API (если доступен)
  const handlePreview = async () => {
    if (!wordUrl) return;

    setLoading(true);
    setError(null);

    try {
      // Пробуем получить предпросмотр через backend API
      // Если есть endpoint для конвертации docx в HTML через pandoc
      const backendUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) ||
        process.env.VITE_BACKEND_URL ||
        '';

      // Пока просто показываем сообщение, что предпросмотр недоступен
      // В будущем можно добавить endpoint для конвертации через pandoc
      setError('Предпросмотр Word файлов пока недоступен. Используйте скачивание для просмотра.');
      setLoading(false);
    } catch (err: any) {
      console.error('Ошибка получения предпросмотра:', err);
      setError('Не удалось получить предпросмотр файла');
      setLoading(false);
    }
  };

  // Скачивание файла
  const handleDownload = () => {
    if (!wordUrl) return;

    try {
      const link = document.createElement('a');
      link.href = wordUrl;
      link.download = artifact.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      console.error('Ошибка скачивания файла:', err);
      alert('Не удалось скачать файл');
    }
  };

  if (error && !showPreview) {
    return (
      <div className="artifact-renderer artifact-word border border-red-200 rounded-lg p-8 bg-red-50">
        <div className="flex items-center gap-3 text-red-800">
          <AlertCircle className="w-5 h-5" />
          <div>
            <div className="font-semibold">Ошибка загрузки Word файла</div>
            <div className="text-sm mt-1">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!wordUrl) {
    return (
      <div className="artifact-renderer artifact-word border border-gray-200 rounded-lg p-8 bg-white">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-600">Загрузка Word файла...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="artifact-renderer artifact-word border border-gray-200 rounded-lg bg-white">
      {/* Заголовок с кнопками */}
      <div className="border-b border-gray-200 p-4 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-blue-600" />
            <div>
              <div className="font-semibold text-gray-900">{artifact.filename}</div>
              <div className="text-sm text-gray-500">
                Word документ • {Math.round(artifact.size / 1024)} KB
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePreview}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              <Eye className="w-4 h-4" />
              <span>Предпросмотр</span>
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Скачать</span>
            </button>
          </div>
        </div>
      </div>

      {/* Контент */}
      <div className="p-8">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            <span className="ml-3 text-gray-600">Загрузка предпросмотра...</span>
          </div>
        ) : previewHtml ? (
          <div
            className="prose max-w-none"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        ) : (
          <div className="text-center py-12">
            <FileText className="w-16 h-16 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Word документ готов к скачиванию
            </h3>
            <p className="text-gray-600 mb-6">
              Для просмотра содержимого скачайте файл и откройте его в Microsoft Word или другом совместимом редакторе.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left max-w-md mx-auto">
              <div className="text-sm text-blue-800">
                <div className="font-semibold mb-2">Информация о файле:</div>
                <ul className="space-y-1 text-blue-700">
                  <li>• Имя файла: {artifact.filename}</li>
                  <li>• Размер: {Math.round(artifact.size / 1024)} KB</li>
                  <li>• Формат: {artifact.filename.endsWith('.docx') ? 'DOCX (Office Open XML)' : 'DOC (Binary)'}</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

