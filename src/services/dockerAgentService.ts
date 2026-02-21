/**
 * Сервис для работы с Docker контейнером агента
 * Предоставляет интерфейс для выполнения команд в изолированном контейнере с gVisor
 */

import { backendApiService } from './backendApiService';

export interface DockerCommandRequest {
  command: string;
  description: string;
  working_dir?: string;
  timeout?: number;
}

export interface DockerCommandResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  returncode: number;
  execution_time: number;
  command: string;
  container_id?: string;
  error?: string;
  signature?: string;
  signature_id?: string;
  certificate?: any;
}

export interface ViewFileRequest {
  path: string;
  view_range?: [number, number];
  description: string;
}

export interface ViewFileResponse {
  type: 'file' | 'directory';
  path: string;
  content: string;
  lines?: number;
  view_range?: [number, number];
  signature?: string;
  signature_id?: string;
  certificate?: any;
}

export interface CreateFileRequest {
  description: string;
  path: string;
  file_text: string;
}

export interface StrReplaceRequest {
  path: string;
  old_str: string;
  new_str: string;
  description: string;
}

export interface SessionSpawnRequest {
  name: string;
  instruction: string;
  tools?: string[];
  priority?: string;
  sync?: boolean;
}

export interface SessionStatusRequest {
  run_id?: string;
}

export interface SessionResultRequest {
  run_id: string;
}

export interface ToolRunRequest {
  tool: string;
  params: Record<string, any>;
  agent_name?: string;
}

export interface ContainerStatus {
  available: boolean;
  container_id?: string;
  status?: string;
  image?: string;
  error?: string;
  message?: string;
}

class DockerAgentService {
  private unwrapTrustChain<T>(response: any): {
    data: T | null;
    signature?: string;
    signature_id?: string;
    certificate?: any;
  } {
    if (response && typeof response === 'object' && 'data' in response) {
      return {
        data: (response as any).data as T,
        signature: (response as any).signature,
        signature_id: (response as any).signature_id,
        certificate: (response as any).certificate
      };
    }
    return { data: response as T };
  }

  /**
   * Выполнить bash команду в контейнере (bash_tool)
   */
  async bashTool(request: DockerCommandRequest): Promise<DockerCommandResponse> {
    try {
      const response = await backendApiService.callEndpoint(
        'docker_agent/bash_tool',
        undefined,
        request
      );
      const unwrapped = this.unwrapTrustChain<DockerCommandResponse>(response);
      const payload = unwrapped.data;
      if (!payload || typeof payload !== 'object') {
        return {
          success: false,
          stdout: '',
          stderr: '',
          returncode: -1,
          execution_time: 0,
          command: request.command,
          error: 'Пустой ответ от docker_agent/bash_tool'
        };
      }
      const normalized = payload as Partial<DockerCommandResponse>;
      const detail = (normalized as any).detail || (normalized as any).message;
      if (detail && typeof detail === 'string') {
        return {
          success: false,
          stdout: '',
          stderr: '',
          returncode: -1,
          execution_time: 0,
          command: request.command,
          error: detail,
          signature: unwrapped.signature,
          signature_id: unwrapped.signature_id,
          certificate: unwrapped.certificate
        };
      }
      const hasAnyField = (
        typeof normalized.success === 'boolean' ||
        typeof normalized.stdout === 'string' ||
        typeof normalized.stderr === 'string' ||
        typeof normalized.returncode === 'number'
      );
      if (!hasAnyField) {
        return {
          success: false,
          stdout: '',
          stderr: '',
          returncode: -1,
          execution_time: 0,
          command: request.command,
          error: 'Некорректный ответ от docker_agent/bash_tool',
          signature: unwrapped.signature,
          signature_id: unwrapped.signature_id,
          certificate: unwrapped.certificate
        };
      }
      return {
        success: Boolean(normalized.success),
        stdout: normalized.stdout ?? '',
        stderr: normalized.stderr ?? '',
        returncode: typeof normalized.returncode === 'number' ? normalized.returncode : -1,
        execution_time: typeof normalized.execution_time === 'number' ? normalized.execution_time : 0,
        command: normalized.command ?? request.command,
        container_id: normalized.container_id,
        error: normalized.error,
        signature: unwrapped.signature,
        signature_id: unwrapped.signature_id,
        certificate: unwrapped.certificate
      };
    } catch (error: any) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        returncode: -1,
        execution_time: 0,
        command: request.command,
        error: error.message || 'Ошибка выполнения команды в контейнере'
      };
    }
  }

  /**
   * Просмотреть файл или директорию (view)
   */
  async view(request: ViewFileRequest): Promise<ViewFileResponse> {
    try {
      const response = await backendApiService.callEndpoint(
        'docker_agent/view',
        undefined,
        request
      );
      const unwrapped = this.unwrapTrustChain<ViewFileResponse>(response);
      const payload = unwrapped.data;
      if (!payload || typeof payload !== 'object') {
        throw new Error('Пустой ответ от docker_agent/view');
      }
      const normalized = payload as Partial<ViewFileResponse>;
      const detail = (normalized as any).detail || (normalized as any).message;
      if (detail && typeof detail === 'string') {
        throw new Error(detail);
      }
      if (!normalized.type || !normalized.path || typeof normalized.content !== 'string') {
        throw new Error('Некорректный ответ от docker_agent/view');
      }
      return {
        ...(normalized as ViewFileResponse),
        signature: unwrapped.signature,
        signature_id: unwrapped.signature_id,
        certificate: unwrapped.certificate
      };
    } catch (error: any) {
      throw new Error(`Ошибка просмотра файла: ${error.message}`);
    }
  }

  /**
   * Создать новый файл (create_file)
   */
  async createFile(request: CreateFileRequest): Promise<{ success: boolean; path: string; size: number; message: string }> {
    try {
      const response = await backendApiService.callEndpoint(
        'docker_agent/create_file',
        undefined,
        request
      );
      const unwrapped = this.unwrapTrustChain<{ success: boolean; path: string; size: number; message: string }>(response);
      return (unwrapped.data || response) as { success: boolean; path: string; size: number; message: string };
    } catch (error: any) {
      throw new Error(`Ошибка создания файла: ${error.message}`);
    }
  }

  /**
   * Заменить строку в файле (str_replace)
   */
  async strReplace(request: StrReplaceRequest): Promise<{ success: boolean; path: string; message: string }> {
    try {
      const response = await backendApiService.callEndpoint(
        'docker_agent/str_replace',
        undefined,
        request
      );
      const unwrapped = this.unwrapTrustChain<{ success: boolean; path: string; message: string }>(response);
      return (unwrapped.data || response) as { success: boolean; path: string; message: string };
    } catch (error: any) {
      throw new Error(`Ошибка замены строки: ${error.message}`);
    }
  }

  // ─── Subagent Tools ───

  async sessionSpawn(request: SessionSpawnRequest): Promise<any> {
    try {
      const response = await backendApiService.callEndpoint('docker_agent/session_spawn', undefined, request);
      return this.unwrapTrustChain(response).data || response;
    } catch (error: any) {
      throw new Error(`Ошибка session_spawn: ${error.message}`);
    }
  }

  async sessionStatus(request: SessionStatusRequest): Promise<any> {
    try {
      const response = await backendApiService.callEndpoint('docker_agent/session_status', undefined, request || {});
      return this.unwrapTrustChain(response).data || response;
    } catch (error: any) {
      throw new Error(`Ошибка session_status: ${error.message}`);
    }
  }

  async sessionResult(request: SessionResultRequest): Promise<any> {
    try {
      const response = await backendApiService.callEndpoint('docker_agent/session_result', undefined, request);
      return this.unwrapTrustChain(response).data || response;
    } catch (error: any) {
      throw new Error(`Ошибка session_result: ${error.message}`);
    }
  }

  /**
   * Получить статус контейнера
   */
  async getContainerStatus(): Promise<ContainerStatus> {
    try {
      const response = await backendApiService.callEndpoint('docker_agent/container/status');
      const unwrapped = this.unwrapTrustChain<ContainerStatus>(response);
      return (unwrapped.data || response) as ContainerStatus;
    } catch (error: any) {
      return {
        available: false,
        error: error.message || 'Ошибка получения статуса контейнера'
      };
    }
  }

  /**
   * Создать контейнер агента
   */
  async createContainer(): Promise<{ success: boolean; container_id?: string; status?: string; message?: string }> {
    try {
      const response = await backendApiService.callEndpoint('docker_agent/container/create', 'POST');
      const unwrapped = this.unwrapTrustChain<{ success: boolean; container_id?: string; status?: string; message?: string }>(response);
      return (unwrapped.data || response) as { success: boolean; container_id?: string; status?: string; message?: string };
    } catch (error: any) {
      throw new Error(`Ошибка создания контейнера: ${error.message}`);
    }
  }

  /**
   * Запустить контейнер агента
   */
  async startContainer(): Promise<{ success: boolean; status?: string; message?: string }> {
    try {
      const response = await backendApiService.callEndpoint('docker_agent/container/start', 'POST');
      const unwrapped = this.unwrapTrustChain<{ success: boolean; status?: string; message?: string }>(response);
      return (unwrapped.data || response) as { success: boolean; status?: string; message?: string };
    } catch (error: any) {
      throw new Error(`Ошибка запуска контейнера: ${error.message}`);
    }
  }

  /**
   * Остановить контейнер агента
   */
  async stopContainer(): Promise<{ success: boolean; status?: string; message?: string }> {
    try {
      const response = await backendApiService.callEndpoint('docker_agent/container/stop', 'POST');
      const unwrapped = this.unwrapTrustChain<{ success: boolean; status?: string; message?: string }>(response);
      return (unwrapped.data || response) as { success: boolean; status?: string; message?: string };
    } catch (error: any) {
      throw new Error(`Ошибка остановки контейнера: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════
  //  Agent Runtime — LLM tool-calling loop
  // ═══════════════════════════════════════════

  /**
   * Запустить LLM агента с инструкцией.
   * Агент выполняет tool-calling loop (Gemini → Docker) и возвращает результат.
   */
  async runAgent(request: AgentRunRequest): Promise<{ status: string; message: string; model: string }> {
    try {
      const response = await backendApiService.callEndpoint(
        'docker_agent/agent/run',
        undefined,
        request
      );
      return response as { status: string; message: string; model: string };
    } catch (error: any) {
      throw new Error(`Ошибка запуска агента: ${error.message}`);
    }
  }

  /**
   * Вызов любого инструмента напрямую из ToolRegistry бэкенда
   */
  async executeTool(request: ToolRunRequest): Promise<any> {
    try {
      const response = await backendApiService.callEndpoint(
        'docker_agent/tool/run',
        undefined,
        request
      );
      return response;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || `Ошибка вызова инструмента ${request.tool}`
      };
    }
  }

  /**
   * Получить текущий статус задачи агента (polling).
   */
  async pollAgentStatus(): Promise<AgentTaskStatus> {
    try {
      const response = await backendApiService.callEndpoint('docker_agent/agent/status');
      return response as AgentTaskStatus;
    } catch (error: any) {
      return {
        task_id: '',
        status: 'failed',
        instruction: '',
        error: error.message || 'Ошибка получения статуса'
      };
    }
  }

  /**
   * Получить историю задач агента.
   */
  async getAgentHistory(limit: number = 10): Promise<AgentTaskStatus[]> {
    try {
      const response = await backendApiService.callEndpoint(
        'docker_agent/agent/history',
        { limit: String(limit) }
      );
      return (response || []) as AgentTaskStatus[];
    } catch (error: any) {
      console.warn('[DockerAgentService] getAgentHistory error:', error.message);
      return [];
    }
  }

  /**
   * Получить список доступных скиллов.
   */
  async listSkills(): Promise<AgentSkill[]> {
    try {
      const response = await backendApiService.callEndpoint('docker_agent/skills');
      return (response || []) as AgentSkill[];
    } catch (error: any) {
      console.warn('[DockerAgentService] listSkills error:', error.message);
      return [];
    }
  }

  /**
   * Подключиться к SSE стриму reasoning-эвентов для live-отображения
   * в LiveThinkingAccordion / ProgressSteps.
   * Возвращает EventSource, который нужно закрыть при unmount.
   */
  streamAgent(onEvent: (event: AgentStreamEvent) => void): EventSource | null {
    const baseUrl = backendApiService.getBaseUrl();
    if (!baseUrl) return null;

    const apiKey = import.meta.env.VITE_LOCAL_API_KEY || (window as any)._env?.VITE_LOCAL_API_KEY;
    const streamUrl = new URL(`${baseUrl}/api/docker_agent/agent/stream`);
    if (apiKey) {
      streamUrl.searchParams.append('x-agent-key', apiKey);
    }
    const es = new EventSource(streamUrl.toString());

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as AgentStreamEvent;
        onEvent(data);
      } catch {
        // skip malformed
      }
    };

    es.onerror = () => {
      // Auto-reconnect is built into EventSource; close on final error
      if (es.readyState === EventSource.CLOSED) {
        onEvent({ type: 'error', message: 'Stream closed' });
      }
    };

    return es;
  }
}

// ─── Agent Runtime Types ───

export interface AgentRunRequest {
  instruction: string;
  model?: string;
  max_iterations?: number;
  agent_name?: string;
}

export interface AgentToolCallRecord {
  iteration: number;
  tool: string;
  args: Record<string, any>;
  timestamp: string;
  result: string;
  success: boolean;
  trustchain?: {
    id: string;
    signature: string;
    parent_signature: string | null;
    verified: boolean;
    key_id?: string;
    algorithm?: string;
  };
}

export interface AgentTaskStatus {
  task_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  instruction: string;
  started_at?: string;
  completed_at?: string;
  result?: string;
  tool_calls?: AgentToolCallRecord[];
  error?: string | null;
  model?: string;
  iterations?: number;
}

export interface AgentSkill {
  name: string;
  path: string;
  description: string;
}

export interface AgentStreamEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'complete' | 'error';
  iteration?: number;
  tool?: string;
  args?: Record<string, any>;
  result?: string;
  signature?: string;
  message?: string;
  timestamp?: string;
}

export const dockerAgentService = new DockerAgentService();

