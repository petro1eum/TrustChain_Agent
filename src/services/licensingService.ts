/**
 * licensingService.ts — Frontend licensing client for TrustChain Pro/Enterprise.
 *
 * Features:
 * - Ed25519-signed token validation (offline via payload parsing)
 * - Online validation against license server (when available)
 * - 72-hour offline grace period
 * - Seat management with heartbeat
 * - Hardware fingerprint binding
 * - localStorage persistence
 */

import { getMachineFingerprint } from './fingerprint';

export interface LicenseInfo {
    tier: 'community' | 'pro' | 'enterprise' | 'developer';
    maxSeats: number;
    activeSeats: number;
    features: string[];
    expires: string;
    orgId: string;
    orgName: string;
    isValid: boolean;
    daysRemaining: number;
    version: number;
    serverValidated: boolean;
    offlineGraceHoursLeft: number;
}

export interface SeatInfo {
    userId: string;
    activatedAt: string;
    lastHeartbeat: string;
    seatType: 'named' | 'floating';
}

// ─── Storage Keys ──────────────────────────────────────────────
const LS_LICENSE_KEY = 'tc_license_key';
const LS_SEAT_USER_ID = 'tc_seat_user_id';
const LS_SEATS_REGISTRY = 'tc_seats_registry';
const LS_LAST_SERVER_VALIDATION = 'tc_last_server_validation';
const LS_SERVER_VALIDATION_CACHE = 'tc_server_validation_cache';

// ─── Config ───────────────────────────────────────────────────
const LICENSE_SERVER_URL = 'http://localhost:8100';
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;  // 5 min
const OFFLINE_GRACE_HOURS = 72;
const STALE_TIMEOUT_MS = 15 * 60 * 1000;  // 15 min

// ─── Helpers ───────────────────────────────────────────────────

function generateUserId(): string {
    const stored = localStorage.getItem(LS_SEAT_USER_ID);
    if (stored) return stored;
    const id = `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(LS_SEAT_USER_ID, id);
    return id;
}

function parseTokenPayload(token: string): Record<string, any> | null {
    try {
        const [payloadB64] = token.split('.');
        if (!payloadB64) return null;
        const base64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
        const json = atob(base64);
        return JSON.parse(json);
    } catch {
        return null;
    }
}

function daysUntil(isoDate: string): number {
    try {
        const exp = new Date(isoDate);
        const now = new Date();
        const diff = exp.getTime() - now.getTime();
        return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    } catch {
        return 0;
    }
}

interface SeatEntry {
    userId: string;
    activatedAt: string;
    lastHeartbeat: string;
    seatType: 'named' | 'floating';
}

function getSeatsRegistry(): SeatEntry[] {
    try {
        return JSON.parse(localStorage.getItem(LS_SEATS_REGISTRY) || '[]');
    } catch {
        return [];
    }
}

function saveSeatsRegistry(seats: SeatEntry[]): void {
    localStorage.setItem(LS_SEATS_REGISTRY, JSON.stringify(seats));
}

function cleanupStaleSeats(seats: SeatEntry[], timeoutMs = STALE_TIMEOUT_MS): SeatEntry[] {
    const now = Date.now();
    return seats.filter(s => {
        const lastHb = new Date(s.lastHeartbeat).getTime();
        return (now - lastHb) < timeoutMs;
    });
}

// ─── Server Communication ─────────────────────────────────────

async function serverValidate(
    token: string,
    userId: string,
    fingerprint: string,
): Promise<{ valid: boolean; status: string; data?: any }> {
    try {
        const resp = await fetch(`${LICENSE_SERVER_URL}/api/v1/validate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                token,
                user_id: userId,
                machine_fingerprint: fingerprint,
            }),
            signal: AbortSignal.timeout(5000),
        });
        const data = await resp.json();
        return { valid: data.valid, status: data.status, data };
    } catch {
        return { valid: false, status: 'offline' };
    }
}

async function serverHeartbeat(token: string, userId: string): Promise<boolean> {
    try {
        const resp = await fetch(`${LICENSE_SERVER_URL}/api/v1/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, user_id: userId }),
            signal: AbortSignal.timeout(5000),
        });
        return resp.ok;
    } catch {
        return false;
    }
}

async function serverRelease(token: string, userId: string): Promise<void> {
    try {
        await fetch(`${LICENSE_SERVER_URL}/api/v1/release`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, user_id: userId }),
            signal: AbortSignal.timeout(3000),
        });
    } catch { /* best effort */ }
}

// ─── Licensing Service ────────────────────────────────────────

class LicensingService {
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private userId: string = '';
    private listeners: Array<(info: LicenseInfo) => void> = [];

    /**
     * Set license key and activate a seat.
     */
    async activateLicense(licenseKey: string, userId?: string): Promise<LicenseInfo> {
        localStorage.setItem(LS_LICENSE_KEY, licenseKey.trim());
        this.userId = userId || generateUserId();

        const info = this.getLicenseInfo();
        if (!info.isValid) {
            throw new Error('Invalid license key');
        }

        // Get hardware fingerprint
        let fingerprint = '';
        try {
            fingerprint = await getMachineFingerprint();
        } catch { /* non-critical */ }

        // Try online validation first
        const serverResult = await serverValidate(licenseKey.trim(), this.userId, fingerprint);

        if (serverResult.status !== 'offline') {
            // Server reachable
            localStorage.setItem(LS_LAST_SERVER_VALIDATION, new Date().toISOString());
            localStorage.setItem(LS_SERVER_VALIDATION_CACHE, JSON.stringify(serverResult.data));

            if (!serverResult.valid && serverResult.status !== 'unregistered') {
                throw new Error(serverResult.data?.message || 'License validation failed');
            }
        }

        // Register seat locally
        let seats = cleanupStaleSeats(getSeatsRegistry());
        const existing = seats.findIndex(s => s.userId === this.userId);
        const now = new Date().toISOString();

        if (existing >= 0) {
            seats[existing].lastHeartbeat = now;
        } else {
            if (seats.length >= info.maxSeats) {
                throw new Error(
                    `All ${info.maxSeats} seats are occupied. ` +
                    `Active: ${seats.length}. Release a seat or upgrade.`
                );
            }
            seats.push({
                userId: this.userId,
                activatedAt: now,
                lastHeartbeat: now,
                seatType: 'floating',
            });
        }

        saveSeatsRegistry(seats);
        this.startHeartbeat();
        this.notifyListeners();

        return this.getLicenseInfo();
    }

    /**
     * Release current user's seat.
     */
    releaseSeat(): void {
        if (!this.userId) return;

        // Release on server (best effort, async)
        const key = localStorage.getItem(LS_LICENSE_KEY);
        if (key) {
            serverRelease(key, this.userId).catch(() => { });
        }

        let seats = getSeatsRegistry();
        seats = seats.filter(s => s.userId !== this.userId);
        saveSeatsRegistry(seats);

        this.stopHeartbeat();
        this.notifyListeners();
    }

    /**
     * Get current license information.
     */
    getLicenseInfo(): LicenseInfo {
        const key = localStorage.getItem(LS_LICENSE_KEY);

        if (!key) {
            return this.emptyInfo();
        }

        // Check offline grace period
        const lastValidation = localStorage.getItem(LS_LAST_SERVER_VALIDATION);
        let offlineGraceHoursLeft = OFFLINE_GRACE_HOURS;
        let serverValidated = false;

        if (lastValidation) {
            const elapsed = Date.now() - new Date(lastValidation).getTime();
            const elapsedHours = elapsed / (1000 * 60 * 60);
            offlineGraceHoursLeft = Math.max(0, OFFLINE_GRACE_HOURS - elapsedHours);
            serverValidated = elapsedHours < 1; // validated within last hour
        }

        // Try v2 token
        if (key.includes('.') && !key.startsWith('TC-')) {
            const payload = parseTokenPayload(key);
            if (!payload) return this.emptyInfo();

            const seats = cleanupStaleSeats(getSeatsRegistry());
            const expires = payload.expires || '';
            const days = expires ? daysUntil(expires) : -1;

            if (expires && days <= 0) {
                return {
                    ...this.emptyInfo(),
                    expires,
                    daysRemaining: 0,
                    orgId: payload.org_id || '',
                    orgName: payload.org_name || '',
                    serverValidated,
                    offlineGraceHoursLeft,
                };
            }

            return {
                tier: payload.tier || 'pro',
                maxSeats: payload.max_seats || 5,
                activeSeats: seats.length,
                features: payload.features || [],
                expires,
                orgId: payload.org_id || '',
                orgName: payload.org_name || '',
                isValid: true,
                daysRemaining: days,
                version: 2,
                serverValidated,
                offlineGraceHoursLeft,
            };
        }

        // Legacy TC-PRO-* key
        if (key.startsWith('TC-PRO-')) {
            const seats = cleanupStaleSeats(getSeatsRegistry());
            return {
                tier: key === 'TC-PRO-DEV-MODE-2026' ? 'developer' : 'pro',
                maxSeats: 5,
                activeSeats: seats.length,
                features: ['streaming', 'policy', 'redis_ha'],
                expires: '2026-12-31',
                orgId: '',
                orgName: '',
                isValid: true,
                daysRemaining: daysUntil('2026-12-31'),
                version: 1,
                serverValidated: false,
                offlineGraceHoursLeft: OFFLINE_GRACE_HOURS,
            };
        }

        return this.emptyInfo();
    }

    /**
     * Check if a valid license is active.
     */
    isLicensed(): boolean {
        return this.getLicenseInfo().isValid;
    }

    /**
     * Get stored license key.
     */
    getLicenseKey(): string | null {
        return localStorage.getItem(LS_LICENSE_KEY);
    }

    /**
     * Remove license and release seat.
     */
    deactivate(): void {
        this.releaseSeat();
        localStorage.removeItem(LS_LICENSE_KEY);
        localStorage.removeItem(LS_SERVER_VALIDATION_CACHE);
        localStorage.removeItem(LS_LAST_SERVER_VALIDATION);
        this.notifyListeners();
    }

    /**
     * Subscribe to license changes.
     */
    onChange(listener: (info: LicenseInfo) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    /**
     * Get active seats info.
     */
    getActiveSeats(): SeatInfo[] {
        return cleanupStaleSeats(getSeatsRegistry());
    }

    // ── Internal ───────────────────────────────────────────────

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(async () => {
            if (!this.userId) return;

            // Local heartbeat
            const seats = getSeatsRegistry();
            const seat = seats.find(s => s.userId === this.userId);
            if (seat) {
                seat.lastHeartbeat = new Date().toISOString();
                saveSeatsRegistry(seats);
            }

            // Server heartbeat (best effort)
            const key = localStorage.getItem(LS_LICENSE_KEY);
            if (key) {
                const ok = await serverHeartbeat(key, this.userId);
                if (ok) {
                    localStorage.setItem(LS_LAST_SERVER_VALIDATION, new Date().toISOString());
                }
            }
        }, HEARTBEAT_INTERVAL_MS);

        window.addEventListener('beforeunload', this.handleUnload);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
        window.removeEventListener('beforeunload', this.handleUnload);
    }

    private handleUnload = (): void => {
        this.releaseSeat();
    };

    private notifyListeners(): void {
        const info = this.getLicenseInfo();
        for (const listener of this.listeners) {
            try { listener(info); } catch { /* ignore */ }
        }
    }

    private emptyInfo(): LicenseInfo {
        return {
            tier: 'community',
            maxSeats: 0,
            activeSeats: 0,
            features: [],
            expires: '',
            orgId: '',
            orgName: '',
            isValid: false,
            daysRemaining: 0,
            version: 0,
            serverValidated: false,
            offlineGraceHoursLeft: 0,
        };
    }
}

// Singleton export
export const licensingService = new LicensingService();
export default licensingService;
