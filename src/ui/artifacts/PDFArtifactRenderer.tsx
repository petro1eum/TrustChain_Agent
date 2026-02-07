/**
 * Компонент для рендеринга PDF файлов
 * Использует iframe с blob URL для отображения PDF
 */

import React, { useState, useMemo } from 'react';
import { Download, FileText, Loader2, AlertCircle } from 'lucide-react';
import type { ArtifactContent } from '../../services/artifacts/types';

interface PDFArtifactRendererProps {
  artifact: ArtifactContent;
}

export const PDFArtifactRenderer: React.FC<PDFArtifactRendererProps> = ({ artifact }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Создаем blob URL для PDF
  const pdfUrl = useMemo(() => {
    try {
      // Декодируем base64 в бинарные данные
      const binaryString = atob(artifact.content);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Создаем blob и URL
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      return url;
    } catch (err: any) {
      console.error('Ошибка создания PDF URL:', err);
      setError(err.message || 'Не удалось загрузить PDF файл');
      return null;
    }
  }, [artifact.content]);

  // Очистка URL при размонтировании
  React.useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  // Скачивание файла
  const handleDownload = () => {
    if (!pdfUrl) return;

    try {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = artifact.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      console.error('Ошибка скачивания файла:', err);
      alert('Не удалось скачать файл');
    }
  };

  if (error) {
    return (
      <div className="artifact-renderer artifact-pdf border border-red-200 rounded-lg p-8 bg-red-50">
        <div className="flex items-center gap-3 text-red-800">
          <AlertCircle className="w-5 h-5" />
          <div>
            <div className="font-semibold">Ошибка загрузки PDF файла</div>
            <div className="text-sm mt-1">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!pdfUrl) {
    return (
      <div className="artifact-renderer artifact-pdf border border-gray-200 rounded-lg p-8 bg-white">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-600">Загрузка PDF файла...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="artifact-renderer artifact-pdf border border-gray-200 rounded-lg bg-white flex flex-col h-full">
      {/* Заголовок с кнопками */}
      <div className="border-b border-gray-200 p-4 bg-gray-50 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-red-600" />
            <div>
              <div className="font-semibold text-gray-900">{artifact.filename}</div>
              <div className="text-sm text-gray-500">
                PDF документ • {Math.round(artifact.size / 1024)} KB
              </div>
            </div>
          </div>
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            <Download className="w-4 h-4" />
            <span>Скачать</span>
          </button>
        </div>
      </div>

      {/* PDF Viewer */}
      <div className="flex-1 overflow-hidden relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        )}
        <iframe
          src={pdfUrl}
          className="w-full h-full border-0"
          title={artifact.filename}
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError('Не удалось загрузить PDF файл');
          }}
        />
      </div>
    </div>
  );
};

