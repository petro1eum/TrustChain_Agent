/**
 * ArtifactsViewer — Right-side slide-out panel for browsing artifacts.
 * Split view: artifact list (top) + preview (bottom).
 * Matches the agentTheme.css dark theme.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  X, FileText, Code, FileCode, Image, File,
  Trash2, RefreshCw, Loader2, ChevronDown, ChevronRight,
  Download, Eye, PanelRightClose
} from 'lucide-react';
import { ArtifactsService, artifactsPollingService } from '../services/artifacts';
import { ArtifactRenderer } from './artifacts';
import type { ArtifactInfo, ArtifactContent } from '../services/artifacts/types';

interface ArtifactsViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

const PANEL_WIDTH = 420;

const ArtifactsViewer: React.FC<ArtifactsViewerProps> = ({ isOpen, onClose }) => {
  const [artifacts, setArtifacts] = useState<ArtifactInfo[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── Data Loading ──

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

  const loadArtifactContent = async (filename: string) => {
    setLoadingContent(true);
    setError(null);
    try {
      const content = await ArtifactsService.getArtifact(filename);
      if (content) {
        setSelectedArtifact(content);
        setPreviewExpanded(true);
      } else {
        setError(`Не удалось загрузить: ${filename}`);
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки');
    } finally {
      setLoadingContent(false);
    }
  };

  const handleDelete = async (filename: string) => {
    if (!confirm(`Удалить artifact "${filename}"?`)) return;
    try {
      const success = await ArtifactsService.deleteArtifact(filename);
      if (success) {
        await loadArtifacts();
        if (selectedArtifact?.filename === filename) {
          setSelectedArtifact(null);
        }
      } else {
        setError('Не удалось удалить');
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка удаления');
    }
  };

  // ── Slide animation ──

  useEffect(() => {
    if (isOpen) {
      // Mount first, then animate in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true));
      });
      loadArtifacts();
      artifactsPollingService.start((updated) => {
        if (Array.isArray(updated)) setArtifacts(updated);
      });
    } else {
      setIsVisible(false);
      artifactsPollingService.stop();
    }
    return () => { artifactsPollingService.stop(); };
  }, [isOpen]);

  // ── Helpers ──

  const getIcon = (type: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      markdown: <FileText className="w-3.5 h-3.5" />,
      code: <Code className="w-3.5 h-3.5" />,
      react: <FileCode className="w-3.5 h-3.5 text-cyan-400" />,
      html: <FileCode className="w-3.5 h-3.5 text-orange-400" />,
      svg: <Image className="w-3.5 h-3.5 text-purple-400" />,
      image: <Image className="w-3.5 h-3.5 text-blue-400" />,
      excel: <File className="w-3.5 h-3.5 text-emerald-400" />,
      pdf: <File className="w-3.5 h-3.5 text-red-400" />,
      word: <File className="w-3.5 h-3.5 text-blue-400" />,
    };
    return iconMap[type] || <File className="w-3.5 h-3.5 text-gray-400" />;
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop — subtle, allows click-to-close */}
      <div
        className="fixed inset-0 z-40"
        style={{
          backgroundColor: isVisible ? 'rgba(0,0,0,0.15)' : 'transparent',
          transition: 'background-color 0.3s ease',
          pointerEvents: isVisible ? 'auto' : 'none',
        }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed top-0 right-0 bottom-0 z-50 flex flex-col"
        style={{
          width: `${PANEL_WIDTH}px`,
          transform: isVisible ? 'translateX(0)' : `translateX(${PANEL_WIDTH}px)`,
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          background: 'var(--tc-bg, #0c0c14)',
          borderLeft: '1px solid var(--tc-border, rgba(55,55,80,0.6))',
          boxShadow: isVisible ? '-8px 0 30px rgba(0,0,0,0.3)' : 'none',
        }}
      >
        {/* ═══ Header ═══ */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{
            borderBottom: '1px solid var(--tc-border, rgba(55,55,80,0.6))',
            background: 'var(--tc-sidebar-bg, #0e0e18)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 shrink-0" style={{ color: 'var(--tc-accent-text, #c4b5fd)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--tc-text-heading, #fff)' }}>
              Artifacts
            </h2>
            <span className="text-xs px-1.5 py-0.5 rounded" style={{
              color: 'var(--tc-text-muted, #4b5563)',
              background: 'var(--tc-surface, rgba(31,31,50,0.5))',
            }}>
              {artifacts.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={loadArtifacts}
              disabled={loading}
              className="p-1.5 rounded transition-colors"
              style={{ color: 'var(--tc-text-secondary, #9ca3af)' }}
              title="Обновить"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded transition-colors hover:opacity-80"
              style={{ color: 'var(--tc-text-secondary, #9ca3af)' }}
              title="Закрыть"
            >
              <PanelRightClose className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ═══ Error Banner ═══ */}
        {error && (
          <div className="px-3 py-2 text-xs shrink-0" style={{
            background: 'var(--tc-unverified-bg, rgba(239,68,68,0.08))',
            borderBottom: '1px solid var(--tc-unverified-border, rgba(239,68,68,0.2))',
            color: 'var(--tc-unverified-text, #f87171)',
          }}>
            {error}
            <button onClick={() => setError(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {/* ═══ Artifact List (top section) ═══ */}
        <div
          className="overflow-y-auto shrink-0"
          style={{
            maxHeight: selectedArtifact && previewExpanded ? '40%' : '100%',
            minHeight: '120px',
            transition: 'max-height 0.3s ease',
          }}
        >
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--tc-text-muted, #4b5563)' }} />
            </div>
          ) : !Array.isArray(artifacts) || artifacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <FileText className="w-10 h-10 mb-3 opacity-20" style={{ color: 'var(--tc-text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--tc-text-muted, #4b5563)' }}>
                Нет artifacts
              </p>
              <p className="text-xs mt-1 text-center" style={{ color: 'var(--tc-text-muted)' }}>
                Artifacts создаются агентом автоматически
              </p>
            </div>
          ) : (
            <div className="p-2 space-y-0.5">
              {artifacts.map((artifact) => {
                const isSelected = selectedArtifact?.filename === artifact.filename;
                return (
                  <div
                    key={artifact.filename}
                    onClick={() => loadArtifactContent(artifact.filename)}
                    className="group px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150"
                    style={{
                      background: isSelected
                        ? 'var(--tc-artifact-active-bg, rgba(124,58,237,0.1))'
                        : 'transparent',
                      border: `1px solid ${isSelected
                        ? 'var(--tc-artifact-active-border, rgba(124,58,237,0.3))'
                        : 'transparent'}`,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = 'var(--tc-surface-hover, rgba(40,40,65,0.6))';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 shrink-0">{getIcon(artifact.type)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{
                          color: isSelected
                            ? 'var(--tc-accent-text, #c4b5fd)'
                            : 'var(--tc-text-primary, #e5e7eb)',
                        }}>
                          {artifact.filename}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{
                            background: 'var(--tc-surface, rgba(31,31,50,0.5))',
                            color: 'var(--tc-text-muted, #4b5563)',
                          }}>
                            {artifact.type}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--tc-text-muted)' }}>
                            {formatSize(artifact.size)}
                          </span>
                        </div>
                        {artifact.created_at && (
                          <div className="text-[10px] mt-0.5" style={{ color: 'var(--tc-text-muted)' }}>
                            {new Date(artifact.created_at).toLocaleString('ru-RU', {
                              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                            })}
                          </div>
                        )}
                      </div>
                      {/* Action buttons — visible on hover */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(artifact.filename); }}
                          className="p-1 rounded hover:bg-red-500/10 transition-colors"
                          style={{ color: 'var(--tc-unverified-text, #f87171)' }}
                          title="Удалить"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ═══ Preview Section (bottom) ═══ */}
        {selectedArtifact && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{
            borderTop: '1px solid var(--tc-border, rgba(55,55,80,0.6))',
          }}>
            {/* Preview Header */}
            <div
              className="flex items-center justify-between px-3 py-2 shrink-0 cursor-pointer select-none"
              style={{ background: 'var(--tc-surface-alt, rgba(20,20,35,0.8))' }}
              onClick={() => setPreviewExpanded(!previewExpanded)}
            >
              <div className="flex items-center gap-2 min-w-0">
                {previewExpanded
                  ? <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--tc-text-muted)' }} />
                  : <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--tc-text-muted)' }} />
                }
                <Eye className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--tc-accent-text, #c4b5fd)' }} />
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate" style={{ color: 'var(--tc-text-primary, #e5e7eb)' }}>
                    {selectedArtifact.filename}
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--tc-text-muted)' }}>
                    {formatSize(selectedArtifact.size)} • {selectedArtifact.type}
                  </div>
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setSelectedArtifact(null); }}
                className="p-1 rounded transition-colors hover:opacity-80"
                style={{ color: 'var(--tc-text-secondary, #9ca3af)' }}
                title="Закрыть превью"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Preview Content */}
            {previewExpanded && (
              <div className="flex-1 overflow-y-auto">
                {loadingContent ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--tc-text-muted)' }} />
                  </div>
                ) : (
                  <div className="p-3">
                    <ArtifactRenderer artifact={selectedArtifact} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default ArtifactsViewer;
