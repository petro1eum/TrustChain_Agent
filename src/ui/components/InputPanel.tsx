import React, { useRef, useState, useEffect } from 'react';
import { Paperclip, ArrowUp, X, Loader2, Mic } from 'lucide-react';

/**
 * InputPanel — Chat input area with textarea, attachments, voice input, and send button.
 * Ported from AI Studio's InputPanel, adapted for TrustChain Agent.
 * Voice input uses Web Speech API (SpeechRecognition / webkitSpeechRecognition).
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

const SPEECH_SUPPORTED = typeof window !== 'undefined' && (
    'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
);

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
    const recognitionRef = useRef<any>(null);
    const voiceEnabledRef = useRef(false);
    const manualStopRef = useRef(false);
    const [voiceEnabled, setVoiceEnabled] = useState(false);
    const [isRecording, setIsRecording] = useState(false);
    const [interimText, setInterimText] = useState('');

    // ── Voice input via Web Speech API ──
    useEffect(() => {
        voiceEnabledRef.current = voiceEnabled;
    }, [voiceEnabled]);

    useEffect(() => {
        if (!voiceEnabled) {
            manualStopRef.current = true;
            recognitionRef.current?.stop?.();
            setIsRecording(false);
            setInterimText('');
            return;
        }

        if (!SPEECH_SUPPORTED) {
            setVoiceEnabled(false);
            return;
        }

        if (!recognitionRef.current) {
            const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (!Ctor) { setVoiceEnabled(false); return; }
            const recognition = new Ctor();
            recognition.lang = 'ru-RU';
            recognition.continuous = true;
            recognition.interimResults = true;

            recognition.onresult = (event: any) => {
                let finalText = '';
                let interim = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const result = event.results[i];
                    const transcript = result[0]?.transcript || '';
                    if (result.isFinal) {
                        finalText += transcript;
                    } else {
                        interim += transcript;
                    }
                }
                if (finalText.trim()) {
                    setInputValue(prev => (prev ? `${prev} ${finalText.trim()}` : finalText.trim()));
                }
                setInterimText(interim.trim());
            };

            recognition.onerror = () => {
                setVoiceEnabled(false);
                setIsRecording(false);
                setInterimText('');
            };

            recognition.onend = () => {
                setIsRecording(false);
                setInterimText('');
                if (voiceEnabledRef.current && !manualStopRef.current) {
                    try { recognition.start(); setIsRecording(true); } catch { setVoiceEnabled(false); }
                }
                manualStopRef.current = false;
            };

            recognitionRef.current = recognition;
        }

        try {
            manualStopRef.current = false;
            recognitionRef.current.start();
            setIsRecording(true);
        } catch { setVoiceEnabled(false); }

        return () => { manualStopRef.current = true; recognitionRef.current?.stop?.(); };
    }, [voiceEnabled, setInputValue]);

    // ── File handling ──
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

                {/* Voice interim text */}
                {voiceEnabled && interimText && (
                    <div className="px-1 mb-1.5 text-xs text-blue-400/80 italic truncate">
                        🎙 {interimText}
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
                        placeholder={voiceEnabled && isRecording ? '🎙 Listening…' : 'Message TrustChain Agent…'}
                        rows={1}
                        className="w-full bg-transparent tc-text placeholder:tc-text-muted text-sm
                            pl-4 pr-32 py-3 resize-none focus:outline-none max-h-[200px] tc-scrollbar"
                    />
                    <div className="absolute right-2 bottom-2 flex items-center gap-1">
                        <input ref={fileInputRef} type="file" multiple className="hidden"
                            onChange={handleFileChange} accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json,.md" />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            className="tc-text-muted hover:tc-text p-2 rounded-lg tc-btn-hover transition-colors"
                            title="Attach file">
                            <Paperclip size={16} />
                        </button>
                        {SPEECH_SUPPORTED && (
                            <button
                                onClick={() => setVoiceEnabled(!voiceEnabled)}
                                className={`p-2 rounded-lg transition-all ${voiceEnabled
                                    ? 'text-red-400 bg-red-500/10 animate-pulse'
                                    : 'tc-text-muted hover:tc-text tc-btn-hover'
                                    }`}
                                title={voiceEnabled ? 'Stop voice input' : 'Start voice input'}
                                aria-pressed={voiceEnabled}>
                                <Mic size={16} />
                            </button>
                        )}
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
        </div>
    );
};
