/**
 * InputPanel — chat input with attachments, voice toggle, and action buttons.
 */

import React, { useRef, useCallback } from 'react';
import {
    Send, Paperclip, X, Loader2, Mic, MicOff,
    FileText, Image as ImageIcon
} from 'lucide-react';
import type { ChatAttachment } from '../../../agents/types';
import type { ProcessingState } from '../types';

interface InputPanelProps {
    inputValue: string;
    setInputValue: React.Dispatch<React.SetStateAction<string>>;
    inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement>;
    processing: ProcessingState;
    attachments: ChatAttachment[];
    isUploading: boolean;
    voiceEnabled: boolean;
    setVoiceEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    onSendMessage: () => void;
    onKeyPress: (e: React.KeyboardEvent) => void;
    onClearChat: () => void;
    onExportChat: () => void;
    onShowDebugViewer: () => void;
    onAttachFiles: (files: File[]) => void;
    onRemoveAttachment: (id: string) => void;
}

export const InputPanel: React.FC<InputPanelProps> = ({
    inputValue,
    setInputValue,
    inputRef,
    processing,
    attachments,
    isUploading,
    voiceEnabled,
    setVoiceEnabled,
    onSendMessage,
    onKeyPress,
    onAttachFiles,
    onRemoveAttachment,
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            onAttachFiles(files);
        }
        // Reset so same file can be attached again
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, [onAttachFiles]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            onAttachFiles(files);
        }
    }, [onAttachFiles]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const canSend = (inputValue.trim() || attachments.length > 0) && !processing.isProcessing;

    return (
        <div
            className="border-t border-gray-700 bg-gray-800/50 p-3 shrink-0"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
        >
            {/* Attachment Previews */}
            {(attachments.length > 0 || isUploading) && (
                <div className="flex flex-wrap gap-2 mb-2">
                    {attachments.map(att => (
                        <div
                            key={att.id}
                            className="flex items-center gap-1.5 bg-gray-700/50 border border-gray-600 rounded-lg px-2 py-1 text-xs text-gray-300 max-w-[200px]"
                        >
                            {att.type === 'image' ? (
                                <>
                                    {att.dataUrl ? (
                                        <img src={att.dataUrl} alt="" className="w-6 h-6 rounded object-cover shrink-0" />
                                    ) : (
                                        <ImageIcon className="w-4 h-4 text-blue-400 shrink-0" />
                                    )}
                                </>
                            ) : (
                                <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                            )}
                            <span className="truncate">{att.filename}</span>
                            <button
                                className="ml-auto p-0.5 text-gray-500 hover:text-red-400 shrink-0 transition-colors"
                                onClick={() => onRemoveAttachment(att.id)}
                            >
                                <X className="w-3 h-3" />
                            </button>
                        </div>
                    ))}
                    {isUploading && (
                        <div className="flex items-center gap-1.5 text-xs text-gray-400">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Загрузка...
                        </div>
                    )}
                </div>
            )}

            {/* Input Row */}
            <div className="flex items-end gap-2">
                {/* Attach Button */}
                <button
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors shrink-0"
                    onClick={() => fileInputRef.current?.click()}
                    title="Прикрепить файл"
                    disabled={processing.isProcessing}
                >
                    <Paperclip className="w-4 h-4" />
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileSelect}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf"
                />

                {/* Text Input */}
                <div className="flex-1 min-w-0">
                    <input
                        ref={inputRef as React.RefObject<HTMLInputElement>}
                        type="text"
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyDown={onKeyPress}
                        placeholder={processing.isProcessing ? 'Обрабатываю...' : 'Введите сообщение...'}
                        disabled={processing.isProcessing}
                        className="w-full bg-gray-700 border border-gray-600 rounded-xl px-4 py-2.5 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all disabled:opacity-50"
                    />
                </div>

                {/* Voice Toggle */}
                <button
                    className={`p-2 rounded-lg transition-colors shrink-0 ${voiceEnabled
                            ? 'text-green-400 bg-green-600/10 hover:bg-green-600/20'
                            : 'text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                    onClick={() => setVoiceEnabled(v => !v)}
                    title={voiceEnabled ? 'Выключить голос' : 'Включить голос'}
                >
                    {voiceEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                </button>

                {/* Send Button */}
                <button
                    className={`p-2 rounded-xl transition-all shrink-0 ${canSend
                            ? 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/20'
                            : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                        }`}
                    onClick={onSendMessage}
                    disabled={!canSend}
                    title="Отправить (Enter)"
                >
                    {processing.isProcessing ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Send className="w-4 h-4" />
                    )}
                </button>
            </div>
        </div>
    );
};
