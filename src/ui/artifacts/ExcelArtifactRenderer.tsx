/**
 * Компонент для рендеринга Excel файлов (.xlsx, .xls, .xlsm)
 * Использует библиотеку xlsx для парсинга и отображения данных
 */

import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet, Loader2, AlertCircle } from 'lucide-react';
import type { ArtifactContent } from '../../services/artifacts/types';

interface ExcelArtifactRendererProps {
  artifact: ArtifactContent;
}

export const ExcelArtifactRenderer: React.FC<ExcelArtifactRendererProps> = ({ artifact }) => {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Парсим Excel файл из base64
  useEffect(() => {
    try {
      setLoading(true);
      setError(null);

      // Очищаем base64 от возможных пробелов и переносов строк
      const cleanBase64 = artifact.content.replace(/\s/g, '');

      // Декодируем base64 в бинарные данные
      const binaryString = atob(cleanBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Проверяем сигнатуру Excel файла (PK - это ZIP архив)
      if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
        throw new Error('Файл не является валидным Excel файлом (отсутствует ZIP сигнатура)');
      }

      // Парсим Excel файл
      const wb = XLSX.read(bytes, { type: 'array' });
      setWorkbook(wb);

      // Выбираем первый лист по умолчанию
      if (wb.SheetNames.length > 0) {
        setSelectedSheet(wb.SheetNames[0]);
      }
    } catch (err: any) {
      console.error('Ошибка парсинга Excel файла:', err);
      setError(err.message || 'Не удалось прочитать Excel файл');
    } finally {
      setLoading(false);
    }
  }, [artifact.content]);

  // Получаем данные выбранного листа
  const sheetData = useMemo(() => {
    if (!workbook || !selectedSheet) return null;

    const worksheet = workbook.Sheets[selectedSheet];
    if (!worksheet) return null;

    // Конвертируем в JSON с заголовками
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    return jsonData as any[][];
  }, [workbook, selectedSheet]);

  // Скачивание файла
  const handleDownload = () => {
    try {
      // Очищаем base64 от возможных пробелов и переносов строк
      const cleanBase64 = artifact.content.replace(/\s/g, '');

      // Декодируем base64 в бинарные данные
      const binaryString = atob(cleanBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Проверяем сигнатуру Excel файла (PK - это ZIP архив, который используется в .xlsx)
      if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
        console.warn('Файл не похож на валидный Excel файл (отсутствует ZIP сигнатура)');
      }

      // Создаем blob с правильным MIME типом
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });

      // Создаем URL и скачиваем
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = artifact.filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();

      // Очистка
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (err: any) {
      console.error('Ошибка скачивания файла:', err);
      alert(`Не удалось скачать файл: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="artifact-renderer artifact-excel border border-gray-200 rounded-lg p-8 bg-white">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-600">Загрузка Excel файла...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="artifact-renderer artifact-excel border border-red-200 rounded-lg p-8 bg-red-50">
        <div className="flex items-center gap-3 text-red-800">
          <AlertCircle className="w-5 h-5" />
          <div>
            <div className="font-semibold">Ошибка загрузки Excel файла</div>
            <div className="text-sm mt-1">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!workbook || !selectedSheet || !sheetData) {
    return (
      <div className="artifact-renderer artifact-excel border border-gray-200 rounded-lg p-8 bg-white">
        <div className="text-gray-500 text-center py-8">
          Файл не содержит данных
        </div>
      </div>
    );
  }

  return (
    <div className="artifact-renderer artifact-excel border border-gray-200 rounded-lg bg-white">
      {/* Заголовок с кнопками */}
      <div className="border-b border-gray-200 p-4 bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="w-5 h-5 text-green-600" />
            <div>
              <div className="font-semibold text-gray-900">{artifact.filename}</div>
              <div className="text-sm text-gray-500">
                {workbook.SheetNames.length} лист{workbook.SheetNames.length !== 1 ? 'ов' : ''}
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

        {/* Выбор листа */}
        {workbook.SheetNames.length > 1 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {workbook.SheetNames.map((sheetName: string) => (
              <button
                key={sheetName}
                onClick={() => setSelectedSheet(sheetName)}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${selectedSheet === sheetName
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                  }`}
              >
                {sheetName}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Таблица с данными */}
      <div className="overflow-auto max-h-[600px]">
        <table className="min-w-full border-collapse">
          <thead className="bg-gray-100 sticky top-0">
            {sheetData.length > 0 && (
              <tr>
                {sheetData[0].map((cell: any, colIndex: number) => (
                  <th
                    key={colIndex}
                    className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-700 whitespace-nowrap"
                  >
                    {cell !== null && cell !== undefined ? String(cell) : ''}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {sheetData.slice(1).map((row: any[], rowIndex: number) => (
              <tr key={rowIndex} className="hover:bg-gray-50">
                {row.map((cell: any, colIndex: number) => (
                  <td
                    key={colIndex}
                    className="border border-gray-300 px-4 py-2 text-sm text-gray-900 whitespace-nowrap"
                  >
                    {cell !== null && cell !== undefined ? String(cell) : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Информация о данных */}
      <div className="border-t border-gray-200 p-3 bg-gray-50 text-xs text-gray-500">
        Лист: <span className="font-semibold">{selectedSheet}</span> •
        Строк: <span className="font-semibold">{sheetData.length - 1}</span> •
        Столбцов: <span className="font-semibold">{sheetData[0]?.length || 0}</span>
      </div>
    </div>
  );
};

