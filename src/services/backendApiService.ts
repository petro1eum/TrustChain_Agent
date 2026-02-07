/**
 * Backend API Service — stub for resolving imports
 * Provides API endpoint access and file operations
 */

const BACKEND_URL = 'http://localhost:8000';

export const API_ENDPOINTS: Record<string, string> = {
    autoreplace_get: '/api/autoreplace',
    synonyms_compile: '/api/synonyms/compile',
    files_read: '/api/files/read',
    categories_list: '/api/categories',
    search: '/api/search',
    health: '/api/health',
};

export const DATA_FILES: Record<string, string[]> = {
    categories: [],
    mixins: [],
    atomic: [],
    descriptors: {} as any,
};

class BackendApiServiceImpl {
    async callEndpoint(endpoint: string, params?: any, body?: any): Promise<any> {
        const url = API_ENDPOINTS[endpoint]
            ? `${BACKEND_URL}${API_ENDPOINTS[endpoint]}`
            : `${BACKEND_URL}/api/${endpoint}`;

        const queryStr = params ? '?' + new URLSearchParams(params).toString() : '';

        try {
            const resp = await fetch(`${url}${queryStr}`, {
                method: body ? 'POST' : 'GET',
                headers: { 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined,
            });
            return resp.json();
        } catch (err: any) {
            console.warn(`[BackendApiService] ${endpoint}:`, err.message);
            return { error: err.message };
        }
    }

    async getYamlFile(path: string): Promise<any> {
        return this.callEndpoint('files_read', undefined, { path, format: 'yaml' });
    }

    async saveYamlFile(path: string, content: any): Promise<void> {
        await this.callEndpoint('files_write', undefined, { path, content, format: 'yaml' });
    }

    getApiSpec(): Record<string, string> {
        return { ...API_ENDPOINTS };
    }

    getFilesSpec(): Record<string, string[]> {
        return { ...DATA_FILES };
    }

    getBaseUrl(): string {
        return BACKEND_URL;
    }
}

export const backendApiService = new BackendApiServiceImpl();
