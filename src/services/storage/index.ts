/**
 * Storage module — barrel export
 */
export type {
    StorageBackend,
    FileEntry,
    FileStat,
    StorageUsage,
    StorageBackendType,
    ConfigKey,
} from './types';
export { USER_DIRS } from './types';
export { MemoryBackend } from './backends/memoryBackend';
export { LocalFolderBackend } from './backends/localFolderBackend';
export { DockerVolumeBackend } from './backends/dockerVolumeBackend';
export { GoogleDriveBackend } from './backends/googleDriveBackend';
export { userStorageService } from './userStorageService';
export { virtualStorageService, MOUNT_SKILLS, MOUNT_TOOLS } from './virtualStorageService';
