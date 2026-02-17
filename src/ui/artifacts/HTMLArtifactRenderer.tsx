/**
 * Рендерер для HTML artifacts
 */

import React, { useRef, useEffect, useState } from 'react';
import type { ArtifactContent } from '../../services/artifacts/types';

interface HTMLArtifactRendererProps {
  artifact: ArtifactContent;
}

/**
 * Injects highlight.js CDN + auto-highlight into artifact HTML.
 * Ensures code blocks inside iframe render with syntax coloring.
 */
function injectHighlightJs(html: string): string {
  const hljsSnippet = `
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"><\/script>
<script>hljs.highlightAll();<\/script>`;

  // If <head> exists, inject before </head>
  if (html.includes('</head>')) {
    return html.replace('</head>', hljsSnippet + '\n</head>');
  }
  // If <body> exists, inject before </body>
  if (html.includes('</body>')) {
    return html.replace('</body>', hljsSnippet + '\n</body>');
  }
  // Fallback: append at the end
  return html + hljsSnippet;
}

export const HTMLArtifactRenderer: React.FC<HTMLArtifactRendererProps> = ({ artifact }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState<number>(600);

  useEffect(() => {
    if (iframeRef.current && artifact.content) {
      const iframe = iframeRef.current;

      // Используем srcdoc для полной перезагрузки содержимого iframe
      // Это гарантирует, что все переменные будут очищены
      const handleLoad = () => {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) return;

        // Функция для обновления высоты iframe на основе содержимого
        const updateHeight = () => {
          try {
            const body = doc.body;
            const html = doc.documentElement;

            if (body && html) {
              // Получаем максимальную высоту из body и html
              const height = Math.max(
                body.scrollHeight,
                body.offsetHeight,
                html.clientHeight,
                html.scrollHeight,
                html.offsetHeight
              );

              // Устанавливаем минимальную высоту 400px и добавляем небольшой отступ
              setIframeHeight(Math.max(400, height + 20));
            }
          } catch (e) {
            // Если не удалось получить высоту, используем значение по умолчанию
            console.warn('Failed to calculate iframe height:', e);
          }
        };

        // Обновляем высоту после загрузки содержимого
        if (doc.readyState === 'complete') {
          updateHeight();
        } else {
          // Ждем загрузки всех ресурсов (изображений, скриптов и т.д.)
          const checkLoad = setInterval(() => {
            if (doc.readyState === 'complete') {
              updateHeight();
              clearInterval(checkLoad);
            }
          }, 100);

          // Таймаут на случай, если загрузка затянется
          setTimeout(() => {
            clearInterval(checkLoad);
            updateHeight();
          }, 3000);
        }

        // Также обновляем высоту при изменении размера окна
        const handleResize = () => {
          updateHeight();
        };

        if (iframe.contentWindow) {
          iframe.contentWindow.addEventListener('resize', handleResize);
        }

        // Используем MutationObserver для отслеживания изменений в DOM
        const observer = new MutationObserver(() => {
          updateHeight();
        });

        if (doc.body) {
          observer.observe(doc.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class']
          });
        }

        return () => {
          observer.disconnect();
          if (iframe.contentWindow) {
            iframe.contentWindow.removeEventListener('resize', handleResize);
          }
        };
      };

      // Устанавливаем обработчик загрузки
      iframe.addEventListener('load', handleLoad);

      return () => {
        iframe.removeEventListener('load', handleLoad);
      };
    }
  }, [artifact.content]);

  return (
    <div className="artifact-renderer artifact-html border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="mb-2 text-xs text-gray-500 font-mono px-4 pt-2">
        {artifact.filename} ({artifact.size} bytes)
      </div>
      <iframe
        ref={iframeRef}
        className="w-full border-0"
        style={{
          minHeight: '400px',
          height: `${iframeHeight}px`,
          display: 'block'
        }}
        title={artifact.filename}
        sandbox="allow-scripts allow-same-origin"
        srcDoc={injectHighlightJs(artifact.content)}
      />
    </div>
  );
};

