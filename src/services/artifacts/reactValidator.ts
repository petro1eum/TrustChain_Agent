/**
 * React Artifact Validator — validates and sanitizes React code for artifact rendering.
 */

export function validateReactCode(code: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Basic checks
    if (!code || code.trim().length === 0) {
        errors.push('Empty code');
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
        /eval\s*\(/,
        /Function\s*\(/,
        /document\.write/,
        /__proto__/,
    ];

    for (const pattern of dangerousPatterns) {
        if (pattern.test(code)) {
            errors.push(`Potential security issue: ${pattern.source}`);
        }
    }

    return { valid: errors.length === 0, errors };
}

export function sanitizeReactCode(code: string): string {
    // Remove script injections
    return code
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/on\w+\s*=/gi, 'data-removed=');
}

/** Class-based validator for compatibility with imports expecting `new ReactValidator()` */
export class ReactValidator {
    validate(code: string): { valid: boolean; errors: string[] } {
        return validateReactCode(code);
    }

    sanitize(code: string): string {
        return sanitizeReactCode(code);
    }
}
