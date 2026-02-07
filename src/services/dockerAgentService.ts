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
}

export const dockerAgentService = new DockerAgentService();

