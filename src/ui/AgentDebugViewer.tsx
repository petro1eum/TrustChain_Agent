import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Bug, Download, Trash2, Search, Filter, Eye, Clock, Target, Settings, AlertCircle, CheckCircle, Play, Pause } from 'lucide-react';
import { agentDebugService } from '../services/agentDebugService';
import type { AgentDebugSession, AgentDebugEntry } from '../services/agentDebugService';

interface AgentDebugViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

const AgentDebugViewer: React.FC<AgentDebugViewerProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<AgentDebugSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<AgentDebugSession | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<AgentDebugEntry | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [statistics, setStatistics] = useState<any>(null);
  const [isLiveMode, setIsLiveMode] = useState(false);

  // Загрузка данных
  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen]);

  // Live режим - обновление каждые 2 секунды
  useEffect(() => {
    if (!isLiveMode) return;

    const interval = setInterval(() => {
      loadData();
    }, 2000);

    return () => clearInterval(interval);
  }, [isLiveMode]);

  const loadData = () => {
    const allSessions = agentDebugService.getRecentSessions(20);
    setSessions(allSessions);
    setStatistics(agentDebugService.getStatistics());

    // Обновляем выбранную сессию если она изменилась
    if (selectedSession) {
      const updatedSession = agentDebugService.getSession(selectedSession.sessionId);
      if (updatedSession) {
        setSelectedSession(updatedSession);
      }
    }
  };

  const handleExportSession = (sessionId: string) => {
    const sessionData = agentDebugService.exportSession(sessionId);
    if (sessionData) {
      const blob = new Blob([sessionData], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `agent_session_${sessionId}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleExportAll = () => {
    agentDebugService.downloadData(`agent_debug_${new Date().toISOString().split('T')[0]}.json`);
  };

  const handleClearAll = () => {
    if (confirm('Удалить ВСЕ данные отладки? Это действие необратимо.')) {
      agentDebugService.clearAllData();
      loadData();
      setSelectedSession(null);
      setSelectedEntry(null);
    }
  };

  const filteredEntries = selectedSession?.entries?.filter(entry => {
    const matchesSearch = searchQuery === '' ||
      entry.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.thoughts?.reasoning?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      entry.tool?.name?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesFilter = filterType === 'all' || entry.type === filterType;

    return matchesSearch && matchesFilter;
  }) || [];

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('ru-RU');
  };

  const formatDuration = (start: string, end?: string) => {
    const startTime = new Date(start).getTime();
    const endTime = end ? new Date(end).getTime() : Date.now();
    const duration = (endTime - startTime) / 1000;

    if (duration < 60) return `${duration.toFixed(1)}с`;
    if (duration < 3600) return `${(duration / 60).toFixed(1)}м`;
    return `${(duration / 3600).toFixed(1)}ч`;
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'thinking': return <Target className="w-4 h-4 text-blue-500" />;
      case 'planning': return <Settings className="w-4 h-4 text-purple-500" />;
      case 'tool_call': return <Play className="w-4 h-4 text-orange-500" />;
      case 'tool_response': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-red-500" />;
      default: return <Eye className="w-4 h-4 text-gray-500" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'thinking': return 'bg-blue-50 border-blue-200';
      case 'planning': return 'bg-purple-50 border-purple-200';
      case 'tool_call': return 'bg-orange-50 border-orange-200';
      case 'tool_response': return 'bg-green-50 border-green-200';
      case 'error': return 'bg-red-50 border-red-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-2xl w-[95%] h-[95%] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center space-x-3">
            <Bug className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold">{t('debugViewer.title')}</h2>
            <button
              onClick={() => setIsLiveMode(!isLiveMode)}
              className={`px-3 py-1 rounded text-sm font-medium ${isLiveMode
                ? 'bg-green-100 text-green-800'
                : 'bg-gray-100 text-gray-800'
                }`}
            >
              {isLiveMode ? <Pause className="w-4 h-4 inline mr-1" /> : <Play className="w-4 h-4 inline mr-1" />}
              {isLiveMode ? 'Live' : 'Static'}
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleExportAll}
              className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              <Download className="w-4 h-4 inline mr-1" />
              {t('header.exportChat')}
            </button>
            <button
              onClick={handleClearAll}
              className="px-3 py-2 bg-red-600 text-white rounded hover:bg-red-700"
            >
              <Trash2 className="w-4 h-4 inline mr-1" />
              {t('common.clear')}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              {t('common.close')}
            </button>
          </div>
        </div>

        {/* Statistics */}
        {statistics && (
          <div className="p-4 bg-gray-50 border-b">
            <div className="grid grid-cols-6 gap-4 text-sm">
              <div className="text-center">
                <div className="text-lg font-bold text-blue-600">{statistics.totalSessions}</div>
                <div className="text-gray-600">{t('debugViewer.sessions')}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-green-600">{statistics.totalThoughts}</div>
                <div className="text-gray-600">{t('debugViewer.thoughts')}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-orange-600">{statistics.totalToolCalls}</div>
                <div className="text-gray-600">{t('debugViewer.calls')}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-purple-600">{(statistics.averageConfidence * 100).toFixed(1)}%</div>
                <div className="text-gray-600">{t('debugViewer.confidence')}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-indigo-600">{statistics.totalEntries}</div>
                <div className="text-gray-600">{t('debugViewer.records')}</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-gray-600">{statistics.storageSize}</div>
                <div className="text-gray-600">{t('debugViewer.size')}</div>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-1 overflow-hidden">
          {/* Sessions List */}
          <div className="w-1/3 border-r flex flex-col">
            <div className="p-3 border-b">
              <h3 className="font-semibold mb-2">{t('debugViewer.sessions')} ({sessions.length})</h3>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  placeholder={t('debugViewer.searchSessions')}
                  className="w-full pl-10 pr-3 py-2 border rounded"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {sessions.map((session) => (
                <div
                  key={session.sessionId}
                  onClick={() => setSelectedSession(session)}
                  className={`p-3 border-b cursor-pointer hover:bg-gray-50 ${selectedSession?.sessionId === session.sessionId ? 'bg-blue-50 border-blue-200' : ''
                    }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-sm font-medium truncate flex-1">
                      {session.userQuery}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportSession(session.sessionId);
                      }}
                      className="ml-2 p-1 hover:bg-gray-200 rounded"
                    >
                      <Download className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="text-xs text-gray-500 mb-1">
                    <Clock className="w-3 h-3 inline mr-1" />
                    {formatTime(session.startTime)}
                    {session.endTime && (
                      <span className="ml-2">
                        ({formatDuration(session.startTime, session.endTime)})
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-600">
                      {session.entries.length} записей
                    </span>
                    {session.summary && (
                      <span className={`px-2 py-1 rounded ${session.summary.successRate > 80 ? 'bg-green-100 text-green-800' :
                        session.summary.successRate > 60 ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }`}>
                        {session.summary.successRate.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Entries List */}
          {selectedSession && (
            <div className="w-1/3 border-r flex flex-col">
              <div className="p-3 border-b">
                <h3 className="font-semibold mb-2">
                  {t('debugViewer.records')} ({filteredEntries.length})
                </h3>

                <div className="flex items-center space-x-2">
                  <Filter className="w-4 h-4 text-gray-400" />
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                    className="flex-1 p-1 border rounded text-sm"
                  >
                    <option value="all">{t('debugViewer.allTypes')}</option>
                    <option value="thinking">{t('debugViewer.thinking')}</option>
                    <option value="planning">{t('debugViewer.planning')}</option>
                    <option value="tool_call">{t('debugViewer.toolCalls')}</option>
                    <option value="tool_response">{t('debugViewer.results')}</option>
                    <option value="error">{t('debugViewer.errors')}</option>
                  </select>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {filteredEntries.map((entry, index) => (
                  <div
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                    className={`p-3 border-b cursor-pointer hover:bg-gray-50 ${selectedEntry?.id === entry.id ? 'bg-blue-50 border-blue-200' : ''
                      } ${getTypeColor(entry.type)}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center space-x-2">
                        {getTypeIcon(entry.type)}
                        <span className="text-sm font-medium">
                          {entry.type.replace('_', ' ').toUpperCase()}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500">
                        #{index + 1}
                      </span>
                    </div>

                    <div className="text-sm text-gray-700 truncate mb-1">
                      {entry.content}
                    </div>

                    <div className="text-xs text-gray-500">
                      {formatTime(entry.timestamp)}
                      {entry.thoughts && (
                        <span className="ml-2 text-blue-600">
                          {Math.round(entry.thoughts.confidence * 100)}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Entry Details */}
          {selectedEntry && (
            <div className="w-1/3 flex flex-col">
              <div className="p-3 border-b">
                <div className="flex items-center space-x-2 mb-2">
                  {getTypeIcon(selectedEntry.type)}
                  <h3 className="font-semibold">
                    {selectedEntry.type.replace('_', ' ').toUpperCase()}
                  </h3>
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(selectedEntry.timestamp).toLocaleString('ru-RU')}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {/* Content */}
                <div>
                  <h4 className="font-medium mb-2">Содержимое:</h4>
                  <div className="p-3 bg-gray-100 rounded text-sm">
                    {selectedEntry.content}
                  </div>
                </div>

                {/* Thoughts */}
                {selectedEntry.thoughts && (
                  <div>
                    <h4 className="font-medium mb-2">Мысли:</h4>
                    <div className="space-y-2">
                      <div className="p-2 bg-blue-50 rounded">
                        <div className="font-medium text-blue-800">Наблюдение:</div>
                        <div className="text-sm">{selectedEntry.thoughts.observation}</div>
                      </div>
                      <div className="p-2 bg-purple-50 rounded">
                        <div className="font-medium text-purple-800">Рассуждение:</div>
                        <div className="text-sm">{selectedEntry.thoughts.reasoning}</div>
                      </div>
                      <div className="p-2 bg-green-50 rounded">
                        <div className="font-medium text-green-800">Действие:</div>
                        <div className="text-sm">{selectedEntry.thoughts.action}</div>
                      </div>
                      <div className="p-2 bg-orange-50 rounded">
                        <div className="font-medium text-orange-800">Уверенность:</div>
                        <div className="text-sm">{Math.round(selectedEntry.thoughts.confidence * 100)}%</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Plan */}
                {selectedEntry.plan && (
                  <div>
                    <h4 className="font-medium mb-2">План:</h4>
                    <div className="p-3 bg-purple-50 rounded">
                      <div className="font-medium mb-2">{selectedEntry.plan.goal}</div>
                      <div className="text-sm text-gray-600">
                        Шагов: {selectedEntry.plan.totalSteps}
                      </div>
                    </div>
                  </div>
                )}

                {/* Tool */}
                {selectedEntry.tool && (
                  <div>
                    <h4 className="font-medium mb-2">Инструмент:</h4>
                    <div className="space-y-2">
                      <div className="p-2 bg-orange-50 rounded">
                        <div className="font-medium text-orange-800">Название:</div>
                        <div className="text-sm">{selectedEntry.tool.name}</div>
                      </div>

                      {selectedEntry.tool.args && (
                        <div className="p-2 bg-gray-50 rounded">
                          <div className="font-medium text-gray-800">Аргументы:</div>
                          <pre className="text-xs mt-1 overflow-x-auto">
                            {JSON.stringify(selectedEntry.tool.args, null, 2)}
                          </pre>
                        </div>
                      )}

                      {selectedEntry.tool.result && (
                        <div className="p-2 bg-green-50 rounded">
                          <div className="font-medium text-green-800">Результат:</div>
                          <pre className="text-xs mt-1 overflow-x-auto max-h-32">
                            {JSON.stringify(selectedEntry.tool.result, null, 2)}
                          </pre>
                        </div>
                      )}

                      {selectedEntry.tool.executionTime && (
                        <div className="p-2 bg-blue-50 rounded">
                          <div className="font-medium text-blue-800">Время выполнения:</div>
                          <div className="text-sm">{selectedEntry.tool.executionTime}мс</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Metrics */}
                {selectedEntry.metrics && (
                  <div>
                    <h4 className="font-medium mb-2">Метрики:</h4>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="p-2 bg-blue-50 rounded">
                        <div className="font-medium">Вызовов:</div>
                        <div>{selectedEntry.metrics.toolCalls}</div>
                      </div>
                      <div className="p-2 bg-green-50 rounded">
                        <div className="font-medium">Успешных:</div>
                        <div>{selectedEntry.metrics.successfulSteps}</div>
                      </div>
                      <div className="p-2 bg-red-50 rounded">
                        <div className="font-medium">Ошибок:</div>
                        <div>{selectedEntry.metrics.failedSteps}</div>
                      </div>
                      <div className="p-2 bg-purple-50 rounded">
                        <div className="font-medium">Итераций:</div>
                        <div>{selectedEntry.metrics.thinkingIterations}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Error */}
                {selectedEntry.error && (
                  <div>
                    <h4 className="font-medium mb-2 text-red-800">Ошибка:</h4>
                    <div className="p-3 bg-red-50 rounded text-sm text-red-800">
                      {selectedEntry.error}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AgentDebugViewer; 