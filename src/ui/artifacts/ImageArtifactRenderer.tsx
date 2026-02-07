/**
 * Рендерер для изображений (base64)
 */
import React from 'react';
import type { ArtifactContent } from '../../services/artifacts/types';

interface ImageArtifactRendererProps {
  artifact: ArtifactContent;
}

const getImageMimeType = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'png':
    default:
      return 'image/png';
  }
};

export const ImageArtifactRenderer: React.FC<ImageArtifactRendererProps> = ({ artifact }) => {
  const mimeType = getImageMimeType(artifact.filename);
  const src = artifact.content.startsWith('data:')
    ? artifact.content
    : `data:${mimeType};base64,${artifact.content}`;

  return (
    <div className="artifact-renderer artifact-image border border-gray-200 rounded-lg p-4 bg-white">
      <div className="mb-2 text-xs text-gray-500 font-mono">
        {artifact.filename} ({artifact.size} bytes)
      </div>
      <div className="flex justify-center">
        <img
          src={src}
          alt={artifact.filename}
          className="max-h-[70vh] max-w-full rounded border border-gray-200 bg-gray-50"
        />
      </div>
    </div>
  );
};
