import React, { useRef } from 'react';
import { Paperclip, ArrowUp, X, Loader2 } from 'lucide-react';

/**
 * InputPanel — Chat input area with textarea, attachments, and send button.
 * Ported from AI Studio's InputPanel, adapted for TrustChain Agent.
 */

export interface ChatAttachmentPreview {
    id: string;
    name: string;
    type: string;
    size: number;
}

interface InputPanelProps {
    inputValue: string;
    setInputValue: React.Dispatch<React.SetStateAction<string>>;
    inputRef: React.RefObject<HTMLTextAreaElement | null>;
    isTyping: boolean;
    pendingAttachments?: ChatAttachmentPreview[];
    isUploading?: boolean;
    onSend: () => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
    onInput: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onAttachFiles?: (files: File[]) => void;
    onRemoveAttachment?: (id: string) => void;
}

export const InputPanel: React.FC<InputPanelProps> = ({
    inputValue,
    setInputValue,
    inputRef,
    isTyping,
    pendingAttachments = [],
    isUploading = false,
    onSend,
    onKeyDown,
    onInput,
    onAttachFiles,
    onRemoveAttachment,
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0 && onAttachFiles) {
            onAttachFiles(files);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = Array.from(e.clipboardData.items);
        const imageFiles = items
            .filter(item => item.type.startsWith('image/'))
            .map(item => item.getAsFile())
            .filter((f): f is File => f !== null);

        if (imageFiles.length > 0 && onAttachFiles) {
            e.preventDefault();
            onAttachFiles(imageFiles);
        }
    };

    return (
        <div className="shrink-0 p-3 pt-0">
            <div className="max-w-2xl mx-auto">
                {/* Attachment previews */}
                {pendingAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2 px-1">
                        {pendingAttachments.map(att => (
                            <div key={att.id} className="flex items-center gap-1.5 text-xs tc-surface border tc-border-light rounded-lg px-2.5 py-1.5">
                                <Paperclip size={10} className="tc-text-muted" />
                                <span className="tc-text truncate max-w-[120px]">{att.name}</span>
                                <span className="tc-text-muted">({(att.size / 1024).toFixed(0)}KB)</span>
                                {onRemoveAttachment && (
                                    <button onClick={() => onRemoveAttachment(att.id)}
                                        className="tc-text-muted hover:text-red-400 transition-colors">
                                        <X size={10} />
                                    </button>
                                )}
                            </div>
                        ))}
                        {isUploading && (
                            <div className="flex items-center gap-1 text-xs tc-text-muted">
                                <Loader2 size={10} className="animate-spin" />
                                Uploading…
                            </div>
                        )}
                    </div>
                )}

                {/* Input box */}
                <div className="relative tc-input border rounded-2xl transition-colors shadow-lg">
                    <textarea
                        ref={inputRef}
                        value={inputValue}
                        onChange={onInput}
                        onKeyDown={onKeyDown}
                        onPaste={handlePaste}
                        placeholder="Message TrustChain Agent…"
                        rows={1}
                        className="w-full bg-transparent tc-text placeholder:tc-text-muted text-sm
                            pl-4 pr-24 py-3 resize-none focus:outline-none max-h-[200px] tc-scrollbar"
                    />
                    <div className="absolute right-2 bottom-2 flex items-center gap-1">
                        <input ref={fileInputRef} type="file" multiple className="hidden"
                            onChange={handleFileChange} accept="image/*,.pdf,.txt,.csv,.json,.md" />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="tc-text-muted hover:tc-text p-2 rounded-lg tc-btn-hover transition-colors">
                            <Paperclip size={16} />
                        </button>
                        <button onClick={onSend} disabled={!inputValue.trim() || isTyping}
                            className={`p-2 rounded-xl transition-all
                                ${inputValue.trim() && !isTyping
                                    ? 'tc-send-active text-white shadow-lg'
                                    : 'tc-surface tc-text-muted cursor-not-allowed'}`}>
                            <ArrowUp size={16} />
                        </button>
                    </div>
                </div>

                {/* Footer hint */}
                <div className="text-center mt-2">
                    <span className="text-[10px] tc-text-muted">
                        All responses cryptographically signed · Ed25519 · Shift+Enter for new line
                    </span>
                </div>
            </div>

            {/* Hidden file input for drag & drop */}
        </div>
    );
};
