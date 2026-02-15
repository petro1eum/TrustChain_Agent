/**
 * fingerprint.ts — Browser hardware fingerprint for seat binding.
 *
 * Generates a stable machine ID from canvas rendering, WebGL, timezone,
 * screen dimensions, and other browser-specific characteristics.
 * Used to prevent license sharing across different machines.
 */

/**
 * Generate a stable hardware fingerprint hash.
 * Returns a hex SHA-256 hash of combined browser characteristics.
 */
export async function generateFingerprint(): Promise<string> {
    const components: string[] = [];

    // 1. Canvas fingerprint
    try {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 50;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.textBaseline = 'alphabetic';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#f60';
            ctx.fillRect(50, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('TrustChain 🔒', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.5)';
            ctx.fillText('TrustChain 🔒', 4, 17);
            components.push(canvas.toDataURL());
        }
    } catch {
        components.push('canvas:unavailable');
    }

    // 2. WebGL renderer
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl && gl instanceof WebGLRenderingContext) {
            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (debugInfo) {
                const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
                const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
                components.push(`webgl:${vendor}|${renderer}`);
            }
        }
    } catch {
        components.push('webgl:unavailable');
    }

    // 3. Timezone + locale
    components.push(`tz:${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
    components.push(`locale:${navigator.language}`);

    // 4. Screen
    components.push(`screen:${screen.width}x${screen.height}x${screen.colorDepth}`);

    // 5. Platform + cores
    components.push(`platform:${navigator.platform}`);
    components.push(`cores:${navigator.hardwareConcurrency || 'unknown'}`);

    // 6. User agent (partial — major version only)
    const ua = navigator.userAgent;
    const majorBrowser = ua.match(/(Chrome|Firefox|Safari|Edge)\/(\d+)/);
    if (majorBrowser) {
        components.push(`browser:${majorBrowser[1]}/${majorBrowser[2]}`);
    }

    // 7. Available fonts probe (basic)
    try {
        const testFonts = ['monospace', 'serif', 'sans-serif'];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (ctx) {
            const widths = testFonts.map(font => {
                ctx.font = `72px ${font}`;
                return ctx.measureText('TrustChain').width;
            });
            components.push(`fonts:${widths.join(',')}`);
        }
    } catch {
        components.push('fonts:unavailable');
    }

    // Combine and hash
    const combined = components.join('||');
    const hash = await sha256(combined);
    return hash;
}

/**
 * SHA-256 hash using Web Crypto API.
 */
async function sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get or generate a cached fingerprint.
 * Fingerprint is stored in localStorage for consistency.
 */
let _cachedFingerprint: string | null = null;
const LS_FINGERPRINT_KEY = 'tc_machine_fingerprint';

export async function getMachineFingerprint(): Promise<string> {
    if (_cachedFingerprint) return _cachedFingerprint;

    // Check localStorage
    const stored = localStorage.getItem(LS_FINGERPRINT_KEY);
    if (stored) {
        _cachedFingerprint = stored;
        return stored;
    }

    // Generate new
    const fp = await generateFingerprint();
    localStorage.setItem(LS_FINGERPRINT_KEY, fp);
    _cachedFingerprint = fp;
    return fp;
}

export default getMachineFingerprint;
