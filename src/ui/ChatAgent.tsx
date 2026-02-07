import React, { useEffect, useState, useMemo, useRef } from 'react';

// Импорты новой архитектуры
import type { ChatAgentProps } from './agents/types';
import type { ChatAttachment } from '../agents/types';
import {
  useChatState,
  useAgentConfiguration,
  useDragAndResize,
  ChatHeader,
  ChatSidebar,
  ChatArea,
  InputPanel,
  createMessageHandlers,
  useTools
} from './agents';
import { getAgentModes } from './agents/config/agentModes';
import { createAgentCallbacksService } from './agents';

// Старые импорты (временно)
import { toolsService } from '../services/toolsService';
import AgentDebugViewer from './AgentDebugViewer';
import ChatHistoryViewer from './ChatHistoryViewer';
import ArtifactsViewer from './ArtifactsViewer';
import AgentSettings from './AgentSettings';
import { ArtifactView } from './artifacts';
import { TrustChainDashboard } from './dashboard';
import { ArtifactsService } from '../services/artifacts';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerSrc from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import * as XLSX from 'xlsx';
import * as mammoth from 'mammoth/mammoth.browser';

if (GlobalWorkerOptions.workerSrc !== pdfWorkerSrc) {
  GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
}

const ChatAgent: React.FC<ChatAgentProps> = ({
  isOpen,
  onClose,
  isMinimized,
  onToggleMinimize,
  appContext,
  isEmbedded = false
}) => {
  // Дополнительные состояния UI
  const [showDebugViewer, setShowDebugViewer] = useState(false);
  const [showChatHistoryViewer, setShowChatHistoryViewer] = useState(false);
  const [showArtifactsViewer, setShowArtifactsViewer] = useState(false);
  const [showAgentSettings, setShowAgentSettings] = useState(false);
  const [showTrustChainDashboard, setShowTrustChainDashboard] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [, setActiveTools] = useState<string[]>([]);
  const [forceUpdate, setForceUpdate] = useState(0);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const lastSpokenRef = useRef<string>('');

  // Состояние переключения на артефакт
  const [viewingArtifact, setViewingArtifact] = useState<string | null>(null);

  // Кастомные хуки состояния
  const chatState = useChatState();
  const agentConfig = useAgentConfiguration(appContext);
  const dragResize = useDragAndResize(isMinimized);

  // Хук для управления инструментами
  const { tools } = useTools(forceUpdate);

  // Получаем режимы с переводами
  const agentModes = getAgentModes();

  // Сервис коллбеков агента
  const callbacksService = useMemo(() =>
    createAgentCallbacksService(appContext), [appContext]
  );

  // Сервис обработчиков сообщений
  const messageHandlers = useMemo(() =>
    createMessageHandlers({
      chatState,
      agentConfig,
      appContext,
      setActiveTools,
      setForceUpdate
    }), [chatState, agentConfig, appContext]
  );

  const toSpeechText = (content: string): string => {
    return content
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  useEffect(() => {
    if (!voiceEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const lastAssistant = [...chatState.messages]
      .reverse()
      .find(msg => msg.role === 'assistant' && typeof msg.content === 'string' && msg.content.trim());

    if (!lastAssistant || !lastAssistant.content) return;

    const speechText = toSpeechText(lastAssistant.content);
    if (!speechText) return;

    const key = `${lastAssistant.id ?? ''}|${speechText}`;
    if (lastSpokenRef.current === key) return;
    lastSpokenRef.current = key;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText);
    utterance.lang = 'ru-RU';
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }, [chatState.messages, voiceEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (!voiceEnabled) {
      window.speechSynthesis.cancel();
    }
  }, [voiceEnabled]);

  const addStatusMessage = (content: string) => {
    chatState.setMessages((prev: any) => [
      ...prev,
      { role: 'assistant', content, timestamp: new Date() }
    ]);
  };

  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Ошибка чтения файла'));
      reader.readAsDataURL(file);
    });
  };

  const getBase64Payload = (dataUrl: string): string => {
    return dataUrl.includes(',') ? dataUrl.split(',', 2)[1] : dataUrl;
  };

  const base64ToUint8Array = (base64: string): Uint8Array => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i += 1) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  };

  const normalizePreviewText = (text: string): string => {
    return text.replace(/\s+/g, ' ').trim();
  };

  const truncatePreview = (text?: string, maxLength = 2000): string | undefined => {
    if (!text) return undefined;
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength)}...`;
  };

  const buildPdfPreview = async (dataUrl: string): Promise<{ previewText?: string; previewImageUrl?: string }> => {
    try {
      const base64 = getBase64Payload(dataUrl);
      const bytes = base64ToUint8Array(base64);
      const pdf = await getDocument({ data: bytes }).promise;
      const page = await pdf.getPage(1);
      const textContent = await page.getTextContent();
      const text = textContent.items.map((item: any) => item.str || '').join(' ');
      const viewport = page.getViewport({ scale: 1 });
      const maxWidth = 520;
      const scale = viewport.width > maxWidth ? maxWidth / viewport.width : 1;
      const scaledViewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) {
        return { previewText: normalizePreviewText(text) };
      }
      canvas.width = scaledViewport.width;
      canvas.height = scaledViewport.height;
      await page.render({ canvasContext: context, viewport: scaledViewport, canvas }).promise;
      return {
        previewText: truncatePreview(normalizePreviewText(text)),
        previewImageUrl: canvas.toDataURL('image/png')
      };
    } catch {
      return {};
    }
  };

  const buildWordPreview = async (dataUrl: string): Promise<string | undefined> => {
    try {
      const base64 = getBase64Payload(dataUrl);
      const bytes = base64ToUint8Array(base64);
      const arrayBuffer = bytes.buffer;
      const result = await mammoth.extractRawText({ arrayBuffer });
      const normalized = normalizePreviewText(result.value || '');
      return truncatePreview(normalized);
    } catch {
      return undefined;
    }
  };

  const buildExcelPreview = (dataUrl: string): { previewText?: string; previewTable?: string[][] } => {
    try {
      const base64 = getBase64Payload(dataUrl).replace(/\s/g, '');
      const bytes = base64ToUint8Array(base64);
      const workbook = XLSX.read(bytes, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return {};
      }
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
      const previewTable = jsonData.slice(0, 6).map(row => row.slice(0, 6).map(cell => String(cell ?? '')));
      const previewText = previewTable.map(row => row.join(' | ')).join('\n');
      return {
        previewText: truncatePreview(previewText, 1200),
        previewTable
      };
    } catch {
      return {};
    }
  };

  const buildTextPreview = (dataUrl: string): string | undefined => {
    try {
      const base64 = getBase64Payload(dataUrl);
      const bytes = base64ToUint8Array(base64);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      const lines = text.split(/\r?\n/).slice(0, 20).join('\n');
      return truncatePreview(lines.trim(), 1200);
    } catch {
      return undefined;
    }
  };

  const getImageExtension = (file: File): string => {
    const mime = file.type || '';
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/png') return 'png';
    if (mime === 'image/gif') return 'gif';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/bmp') return 'bmp';
    const nameExt = file.name.split('.').pop()?.toLowerCase();
    return nameExt || 'png';
  };

  const getFileExtension = (file: File): string => {
    const nameExt = file.name.split('.').pop()?.toLowerCase();
    if (nameExt) return nameExt;
    const mimeExt = file.type?.split('/')[1];
    return mimeExt || 'bin';
  };

  const sanitizeFilename = (name: string): string => {
    const safe = name.replace(/[^A-Za-z0-9._-]+/g, '_');
    return safe || 'file';
  };

  const generateAttachmentFilename = (file: File, isImage: boolean): string => {
    const ext = isImage ? getImageExtension(file) : getFileExtension(file);
    const baseName = sanitizeFilename(file.name.replace(/\.[^/.]+$/, ''));
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
    const rand = Math.random().toString(36).slice(2, 6);
    return `${baseName}-${stamp}-${rand}.${ext}`;
  };

  const handleAttachFiles = async (files: File[]) => {
    const allowedExtensions = new Set([
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'rtf'
    ]);

    const isImage = (file: File) => file.type.startsWith('image/');
    const isAllowedFile = (file: File) => {
      if (isImage(file)) return true;
      const ext = file.name.split('.').pop()?.toLowerCase();
      return !!ext && allowedExtensions.has(ext);
    };

    const allowedFiles = files.filter(isAllowedFile);
    const rejectedFiles = files.filter(file => !isAllowedFile(file));

    if (rejectedFiles.length > 0) {
      addStatusMessage('⚠️ Можно прикреплять изображения, PDF и офисные файлы (docx, xlsx, pptx, txt, csv, rtf).');
    }

    if (allowedFiles.length === 0) {
      return;
    }

    const maxSizeBytes = 25 * 1024 * 1024;
    chatState.setAttachmentsUploading((prev: any) => prev + allowedFiles.length);

    for (const file of allowedFiles) {
      try {
        if (file.size > maxSizeBytes) {
          addStatusMessage(`⚠️ Файл "${file.name}" слишком большой (лимит 25 MB).`);
          continue;
        }

        const dataUrl = await fileToDataUrl(file);
        const base64 = dataUrl.includes(',') ? dataUrl.split(',', 2)[1] : dataUrl;
        const imageFile = isImage(file);
        const filename = generateAttachmentFilename(file, imageFile);
        const ext = file.name.split('.').pop()?.toLowerCase() || '';

        const uploadResult = await ArtifactsService.uploadArtifact({
          filename,
          contentBase64: base64
        });

        if (!uploadResult.success) {
          addStatusMessage(`⚠️ Не удалось загрузить файл: ${uploadResult.error || 'ошибка загрузки'}.`);
          continue;
        }

        let previewText: string | undefined;
        let previewImageUrl: string | undefined;
        let previewTable: string[][] | undefined;

        if (!imageFile) {
          if (ext === 'pdf') {
            const preview = await buildPdfPreview(dataUrl);
            previewText = preview.previewText;
            previewImageUrl = preview.previewImageUrl;
          } else if (ext === 'docx') {
            previewText = await buildWordPreview(dataUrl);
          } else if (ext === 'xls' || ext === 'xlsx') {
            const preview = buildExcelPreview(dataUrl);
            previewText = preview.previewText;
            previewTable = preview.previewTable;
          } else if (ext === 'txt' || ext === 'csv' || ext === 'rtf') {
            previewText = buildTextPreview(dataUrl);
          }
        }

        const attachment: ChatAttachment = {
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: imageFile ? 'image' : 'file',
          filename,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl: imageFile ? dataUrl : undefined,
          previewText,
          previewImageUrl,
          previewTable
        };

        chatState.setPendingAttachments((prev: any) => [...prev, attachment]);
      } catch (error: any) {
        addStatusMessage(`⚠️ Ошибка обработки файла: ${error.message || 'неизвестная ошибка'}.`);
      } finally {
        chatState.setAttachmentsUploading((prev: any) => Math.max(0, prev - 1));
      }
    }
  };

  const handleRemoveAttachment = (id: string) => {
    chatState.setPendingAttachments((prev: any) => prev.filter((att: any) => att.id !== id));
  };

  // Настройка коллбеков агента при изменении контекста
  useEffect(() => {
    if (appContext) {
      callbacksService.setAppContext(appContext);
      toolsService.setAppContext({
        currentView: appContext.currentView,
        selectedClient: appContext.selectedClient,
        selectedFile: appContext.selectedFile,
        dataFiles: appContext.dataFiles,
        setCurrentView: (view: string) => appContext.setCurrentView(view as any),
        setSelectedClient: appContext.setSelectedClient as any,
        setSelectedFile: appContext.setSelectedFile as any,
        setDataFiles: appContext.setDataFiles as any,
      });

      // Настройка агента с коллбеками (TODO)
    }
  }, [appContext, callbacksService]);

  // Фокус на поле ввода при открытии
  useEffect(() => {
    if (isOpen && !isMinimized) {
      chatState.inputRef.current?.focus();
    }
  }, [isOpen, isMinimized]);

  if (!isOpen) return null;

  // Стили для встроенного режима (в iframe)
  const embeddedStyle = isEmbedded ? {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'row' as const,
    margin: 0,
    borderRadius: 0,
    border: 'none'
  } : {
    ...dragResize.getContainerStyle(),
    position: 'fixed' as const,
    bottom: '16px',
    right: '16px',
    display: 'flex',
    flexDirection: isMinimized ? 'column' as const : 'row' as const,
    flexShrink: 0,
    flexGrow: 0,
    contain: 'layout style size'
  };

  return (
    <>
      <div
        ref={!isEmbedded ? dragResize.containerRef : undefined}
        style={embeddedStyle}
        className={`bg-gray-900 border border-gray-700 rounded-xl shadow-2xl chat-container-fixed ${!isEmbedded && dragResize.isDragging ? 'select-none cursor-grabbing transition-none' :
          !isEmbedded && dragResize.isResizing ? 'select-none transition-none' :
            chatState.processing.isProcessing ? 'transition-none chat-processing' :
              'transition-all duration-300'
          }`}
      >
        {/* Свернутое состояние - показываем только заголовок */}
        {isMinimized && !isEmbedded && (
          <ChatHeader
            isMinimized={isMinimized}
            processing={chatState.processing}
            onClose={onClose}
            onToggleMinimize={onToggleMinimize}
            onMouseDown={dragResize.handleMouseDown}
            viewMode={agentConfig.viewMode}
            setViewMode={agentConfig.setViewMode}
            currentAgentName={agentConfig.currentAgentName}
            setCurrentAgentName={agentConfig.setCurrentAgentName}
            currentModel={agentConfig.currentModel}
            setCurrentModel={agentConfig.setCurrentModel}
            availableAgents={agentConfig.availableAgents}
            messages={chatState.messages}
            setMessages={chatState.setMessages}
            onClearChat={chatState.clearChat}
            onExportChat={chatState.exportChat}
            onShowDebugViewer={() => setShowDebugViewer(true)}
            onShowChatHistoryViewer={() => setShowChatHistoryViewer(true)}
            onShowArtifactsViewer={() => setShowArtifactsViewer(true)}
            isExpanded={dragResize.isExpanded}
            onToggleExpanded={() => dragResize.setIsExpanded(!dragResize.isExpanded)}
          />
        )}

        {/* Развернутое состояние - правильная структура */}
        {(!isMinimized || isEmbedded) && (
          <>
            {/* Левая панель на всю высоту (скрыта при просмотре артефакта) */}
            {!viewingArtifact && (
              <ChatSidebar
                sidebarCollapsed={sidebarCollapsed}
                setSidebarCollapsed={setSidebarCollapsed}
                agentModes={agentModes}
                agentMode={agentConfig.agentMode}
                tools={tools}
                messages={chatState.messages}
                processing={chatState.processing}
                appContext={appContext}
                onAgentModeChange={messageHandlers.handleAgentModeChange}
                onToolToggle={messageHandlers.handleToolToggle}
                onReloadAgent={agentConfig.reloadAgent}
                onTestSystemStatus={messageHandlers.handleTestSystemStatus}
                onDiagnostics={messageHandlers.handleDiagnostics}
                onShowAgentSettings={() => setShowAgentSettings(true)}
              />
            )}

            {/* Правая часть: Header, Chat/Artifact, Input */}
            <div className="flex flex-col flex-1 min-w-0">
              {/* Header (скрыт при просмотре артефакта) */}
              {!viewingArtifact && (
                <ChatHeader
                  isMinimized={isMinimized}
                  processing={chatState.processing}
                  onClose={isEmbedded ? () => { } : onClose}
                  onToggleMinimize={onToggleMinimize}
                  onMouseDown={!isEmbedded ? dragResize.handleMouseDown : undefined}
                  viewMode={agentConfig.viewMode}
                  setViewMode={agentConfig.setViewMode}
                  currentAgentName={agentConfig.currentAgentName}
                  setCurrentAgentName={agentConfig.setCurrentAgentName}
                  currentModel={agentConfig.currentModel}
                  setCurrentModel={agentConfig.setCurrentModel}
                  availableAgents={agentConfig.availableAgents}
                  messages={chatState.messages}
                  setMessages={chatState.setMessages}
                  onClearChat={chatState.clearChat}
                  onExportChat={chatState.exportChat}
                  onShowDebugViewer={() => setShowDebugViewer(true)}
                  onShowChatHistoryViewer={() => setShowChatHistoryViewer(true)}
                  onShowArtifactsViewer={() => setShowArtifactsViewer(true)}
                  isExpanded={dragResize.isExpanded}
                  onToggleExpanded={() => dragResize.setIsExpanded(!dragResize.isExpanded)}
                />
              )}

              {/* Переключение между чатом и артефактом */}
              {viewingArtifact ? (
                <ArtifactView
                  filename={viewingArtifact}
                  onBack={() => setViewingArtifact(null)}
                />
              ) : (
                <ChatArea
                  messages={chatState.messages}
                  processing={chatState.processing}
                  messagesEndRef={chatState.messagesEndRef as React.RefObject<HTMLDivElement>}
                  formatTime={chatState.formatTime}
                  onSwitchToArtifact={(filename: any) => setViewingArtifact(filename)}
                />
              )}

              {/* InputPanel (скрыт при просмотре артефакта) */}
              {!viewingArtifact && (
                <InputPanel
                  inputValue={chatState.inputValue}
                  setInputValue={chatState.setInputValue}
                  inputRef={chatState.inputRef as React.RefObject<HTMLInputElement>}
                  processing={chatState.processing}
                  attachments={chatState.pendingAttachments}
                  isUploading={chatState.attachmentsUploading > 0}
                  voiceEnabled={voiceEnabled}
                  setVoiceEnabled={setVoiceEnabled}
                  onSendMessage={messageHandlers.handleSendMessage}
                  onKeyPress={messageHandlers.handleKeyPress}
                  onClearChat={chatState.clearChat}
                  onExportChat={chatState.exportChat}
                  onShowDebugViewer={() => setShowDebugViewer(true)}
                  onAttachFiles={handleAttachFiles}
                  onRemoveAttachment={handleRemoveAttachment}
                />
              )}
            </div>
          </>
        )}

        {/* Ручки для изменения размера (только если не в iframe) */}
        {!isEmbedded && !isMinimized && (
          <>
            {/* Угловые ручки */}
            <div
              className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize"
              onMouseDown={(e) => dragResize.handleResizeStart(e, 'nw')}
            />
            <div
              className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize"
              onMouseDown={(e) => dragResize.handleResizeStart(e, 'ne')}
            />
            <div
              className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize"
              onMouseDown={(e) => dragResize.handleResizeStart(e, 'sw')}
            />
            <div
              className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize"
              onMouseDown={(e) => dragResize.handleResizeStart(e, 'se')}
            />

            {/* Боковые ручки */}
            <div
              className="absolute top-0 left-1/2 transform -translate-x-1/2 w-6 h-2 cursor-n-resize"
              onMouseDown={(e) => dragResize.handleResizeStart(e, 'n')}
            />
            <div
              className="absolute bottom-0 left-1/2 transform -translate-x-1/2 w-6 h-2 cursor-s-resize"
              onMouseDown={(e) => dragResize.handleResizeStart(e, 's')}
            />
            <div
              className="absolute left-0 top-1/2 transform -translate-y-1/2 w-2 h-6 cursor-w-resize"
              onMouseDown={(e) => dragResize.handleResizeStart(e, 'w')}
            />
            <div
              className="absolute right-0 top-1/2 transform -translate-y-1/2 w-2 h-6 cursor-e-resize"
              onMouseDown={(e) => dragResize.handleResizeStart(e, 'e')}
            />
          </>
        )}
      </div>

      {/* Модальные окна */}
      {showDebugViewer && (
        <AgentDebugViewer
          isOpen={showDebugViewer}
          onClose={() => setShowDebugViewer(false)}
        />
      )}

      {showChatHistoryViewer && (
        <ChatHistoryViewer
          isOpen={showChatHistoryViewer}
          onClose={() => setShowChatHistoryViewer(false)}
        />
      )}

      {showArtifactsViewer && (
        <ArtifactsViewer
          isOpen={showArtifactsViewer}
          onClose={() => setShowArtifactsViewer(false)}
        />
      )}

      {showAgentSettings && (
        <AgentSettings
          isOpen={showAgentSettings}
          onClose={() => setShowAgentSettings(false)}
          currentAgentId={agentConfig.currentAgentName}
          onAgentChange={agentConfig.setCurrentAgentName}
        />
      )}

      {showTrustChainDashboard && (
        <TrustChainDashboard
          isOpen={showTrustChainDashboard}
          onClose={() => setShowTrustChainDashboard(false)}
        />
      )}
    </>
  );
};

export default ChatAgent; 