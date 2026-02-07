/**
 * Сервис для безопасного выполнения bash команд через backend API
 */

import { backendApiService } from './backendApiService';

export interface BashExecuteRequest {
  command: string;
  working_dir?: string;
  timeout?: number;
  allow_dangerous?: boolean;
}

export interface BashExecuteResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  returncode: number;
  execution_time: number;
  working_dir: string;
  command: string;
  error?: string;
}

export interface WorkingDirInfo {
  working_dir: string;
  exists: boolean;
  absolute_path: string;
}

export interface AllowedCommandsInfo {
  allowed_commands: string[];
  max_timeout: number;
  max_output_size: number;
}

class BashExecutionService {
  private currentWorkingDir: string = '';

  /**
   * Выполнить bash команду
   */
  async executeCommand(request: BashExecuteRequest): Promise<BashExecuteResponse> {
    try {
      const response = await backendApiService.callEndpoint('bash_execute', undefined, request);
      return response as BashExecuteResponse;
    } catch (error: any) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        returncode: -1,
        execution_time: 0,
        working_dir: this.currentWorkingDir,
        command: request.command,
        error: error.message || 'Ошибка выполнения команды'
      };
    }
  }

  /**
   * Получить информацию о рабочей директории
   */
  async getWorkingDirInfo(): Promise<WorkingDirInfo> {
    try {
      const response = await backendApiService.callEndpoint('bash_working_dir');
      this.currentWorkingDir = response.working_dir || '';
      return response as WorkingDirInfo;
    } catch (error: any) {
      throw new Error(`Ошибка получения информации о рабочей директории: ${error.message}`);
    }
  }

  /**
   * Получить список разрешенных команд
   */
  async getAllowedCommands(): Promise<AllowedCommandsInfo> {
    try {
      const response = await backendApiService.callEndpoint('bash_allowed_commands');
      return response as AllowedCommandsInfo;
    } catch (error: any) {
      throw new Error(`Ошибка получения списка команд: ${error.message}`);
    }
  }

  /**
   * Получить текущую рабочую директорию
   */
  getCurrentWorkingDir(): string {
    return this.currentWorkingDir;
  }

  /**
   * Установить рабочую директорию
   */
  setWorkingDir(dir: string): void {
    this.currentWorkingDir = dir;
  }

  /**
   * Выполнить команду с автоматическим сохранением рабочей директории
   */
  async executeWithState(request: BashExecuteRequest): Promise<BashExecuteResponse> {
    // Если указана рабочая директория, используем её
    if (request.working_dir) {
      this.currentWorkingDir = request.working_dir;
    } else if (!this.currentWorkingDir) {
      // Если рабочая директория не установлена, получаем её из backend
      const info = await this.getWorkingDirInfo();
      this.currentWorkingDir = info.working_dir;
    }

    // Выполняем команду
    const result = await this.executeCommand({
      ...request,
      working_dir: this.currentWorkingDir
    });

    // Если команда была 'cd', обновляем рабочую директорию
    if (request.command.trim().startsWith('cd ')) {
      const cdMatch = request.command.match(/cd\s+(.+)/);
      if (cdMatch && result.success) {
        const targetDir = cdMatch[1].trim();
        if (targetDir === '..') {
          // Переход на уровень выше
          const parts = this.currentWorkingDir.split('/');
          parts.pop();
          this.currentWorkingDir = parts.join('/') || '/';
        } else if (targetDir.startsWith('/')) {
          // Абсолютный путь
          this.currentWorkingDir = targetDir;
        } else {
          // Относительный путь
          this.currentWorkingDir = `${this.currentWorkingDir}/${targetDir}`;
        }
      }
    }

    return result;
  }
}

export const bashExecutionService = new BashExecutionService();

