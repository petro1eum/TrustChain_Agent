/**
 * ChatHistoryViewer — modal for browsing past chat sessions.
 */

import React, { useState } from 'react';
import { X, Search, MessageSquare, Clock, Trash2 } from 'lucide-react';

interface ChatHistoryViewerProps {
    isOpen: boolean;
    onClose: () => void;
}

interface ChatSession {
    id: string;
    title: string;
    lastMessage: string;
    messageCount: number;
    timestamp: Date;
}

const ChatHistoryViewer: React.FC<ChatHistoryViewerProps> = ({ isOpen, onClose }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [sessions] = useState<ChatSession[]>(() => {
        // Load from localStorage
        try {
            const stored = localStorage.getItem('trustchain_chat_sessions');
            if (stored) {
                const parsed = JSON.parse(stored);
                return parsed.map((s: any) => ({
                    ...s,
                    timestamp: new Date(s.timestamp),
                }));
            }
        } catch { /* ignore */ }
        return [];
    });

    if (!isOpen) return null;

    const filtered = sessions.filter(s =>
        s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                    <div className="flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-indigo-400" />
                        <h2 className="text-sm font-semibold text-gray-200">История чатов</h2>
                    </div>
                    <button
                        className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                        onClick={onClose}
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>

                {/* Search */}
                <div className="px-4 py-2 border-b border-gray-700/50">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Поиск по истории..."
                            className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-9 pr-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                    </div>
                </div>

                {/* Sessions List */}
                <div className="flex-1 overflow-y-auto">
                    {filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                            <MessageSquare className="w-10 h-10 mb-3 opacity-30" />
                            <p className="text-sm">{sessions.length === 0 ? 'Нет сохранённых сессий' : 'Ничего не найдено'}</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-800">
                            {filtered.map(session => (
                                <div
                                    key={session.id}
                                    className="px-4 py-3 hover:bg-gray-800/50 cursor-pointer transition-colors group"
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="min-w-0 flex-1">
                                            <div className="text-sm font-medium text-gray-200 truncate">{session.title}</div>
                                            <div className="text-xs text-gray-500 truncate mt-0.5">{session.lastMessage}</div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0 ml-3">
                                            <div className="text-[10px] text-gray-600 flex items-center gap-1">
                                                <Clock className="w-3 h-3" />
                                                {session.timestamp.toLocaleDateString('ru-RU')}
                                            </div>
                                            <button className="p-1 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                                                <Trash2 className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="text-[10px] text-gray-600 mt-1">
                                        {session.messageCount} сообщений
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ChatHistoryViewer;
