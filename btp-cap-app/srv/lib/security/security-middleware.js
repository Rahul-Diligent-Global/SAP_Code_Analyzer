/**
 * ═══════════════════════════════════════════════════════════════════════
 * SECURITY MIDDLEWARE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CAP middleware that enforces security policies:
 * 1. Rate limiting per tenant (prevent API abuse)
 * 2. Input validation & sanitization
 * 3. Consent verification (user must accept AI processing terms)
 * 4. Request size limits (prevent oversized code submissions)
 * 5. IP allowlisting per tenant (optional)
 * 6. Content Security Policy headers
 */

const cds = require('@sap/cds');
const LOG = cds.log('security-middleware');

class SecurityMiddleware {

    /**
     * Register all middleware with CAP server
     */
    static register(app) {
        // 1. Security headers
        app.use(SecurityMiddleware.securityHeaders);

        // 2. Request size limit
        app.use(SecurityMiddleware.requestSizeLimit);

        // 3. Rate limiting
        app.use(SecurityMiddleware.rateLimiter);

        LOG.info('Security middleware registered');
    }

    /**
     * Security headers for all responses
     */
    static securityHeaders(req, res, next) {
        // Prevent clickjacking
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        // XSS Protection
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        // Content Security Policy
        res.setHeader('Content-Security-Policy',
            "default-src 'self'; " +
            "script-src 'self' https://sapui5.hana.ondemand.com; " +
            "style-src 'self' 'unsafe-inline' https://sapui5.hana.ondemand.com; " +
            "font-src 'self' https://sapui5.hana.ondemand.com; " +
            "img-src 'self' data:; " +
            "connect-src 'self'"
        );
        // Strict Transport Security
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        // Referrer Policy
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        // Permissions Policy
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

        next();
    }

    /**
     * Request size limit (prevent oversized payloads)
     * ABAP programs rarely exceed 5MB of source code
     */
    static requestSizeLimit(req, res, next) {
        const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

        if (req.headers['content-length'] &&
            parseInt(req.headers['content-length']) > MAX_BODY_SIZE) {
            LOG.warn(`Request too large: ${req.headers['content-length']} bytes from ${req.ip}`);
            return res.status(413).json({
                error: 'Request too large',
                maxSize: '10MB'
            });
        }
        next();
    }

    /**
     * Rate limiter per tenant
     */
    static rateLimiter(req, res, next) {
        // Simple in-memory rate limiter (use Redis in production)
        if (!SecurityMiddleware._rateLimitStore) {
            SecurityMiddleware._rateLimitStore = new Map();
        }

        const tenantId = req.headers['x-tenant-id'] || 'default';
        const key = `${tenantId}:${req.ip}`;
        const now = Date.now();
        const windowMs = 60 * 1000; // 1 minute window
        const maxRequests = 60;      // 60 requests per minute

        const store = SecurityMiddleware._rateLimitStore;
        const record = store.get(key) || { count: 0, resetAt: now + windowMs };

        if (now > record.resetAt) {
            record.count = 0;
            record.resetAt = now + windowMs;
        }

        record.count++;
        store.set(key, record);

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - record.count));
        res.setHeader('X-RateLimit-Reset', new Date(record.resetAt).toISOString());

        if (record.count > maxRequests) {
            LOG.warn(`Rate limit exceeded: tenant=${tenantId}, ip=${req.ip}`);
            return res.status(429).json({
                error: 'Too many requests',
                retryAfter: Math.ceil((record.resetAt - now) / 1000)
            });
        }

        next();
    }

    /**
     * Validate that tenant has accepted AI processing consent
     * Call this before any Claude API interaction
     */
    static async verifyConsent(tenantId, userId) {
        try {
            const { TenantConsent } = cds.entities('abap.analyzer');
            const consent = await SELECT.one.from(TenantConsent)
                .where({
                    tenantId: tenantId,
                    consentType: 'AI_CODE_PROCESSING',
                    status: 'ACTIVE'
                });

            if (!consent) {
                throw new Error(
                    'AI Processing Consent Required. ' +
                    'Your organization must accept the AI Code Processing Agreement ' +
                    'before code can be analyzed. Please contact your tenant administrator.'
                );
            }

            // Check if consent has expired
            if (consent.expiresAt && new Date(consent.expiresAt) < new Date()) {
                throw new Error(
                    'AI Processing Consent has expired. ' +
                    'Please ask your tenant administrator to renew the agreement.'
                );
            }

            return consent;
        } catch (error) {
            if (error.message.includes('Consent')) throw error;
            LOG.warn(`Consent check failed: ${error.message}`);
            throw new Error('Unable to verify AI processing consent. Please try again.');
        }
    }

    /**
     * Validate and sanitize input parameters
     */
    static sanitizeInput(params) {
        const sanitized = {};

        for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'string') {
                // Remove null bytes
                let clean = value.replace(/\0/g, '');
                // Limit string length
                clean = clean.substring(0, 10000);
                // Remove potential script injection in non-code fields
                if (key !== 'sourceCode' && key !== 'customPrompt') {
                    clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
                    clean = clean.replace(/javascript:/gi, '');
                }
                sanitized[key] = clean;
            } else {
                sanitized[key] = value;
            }
        }

        return sanitized;
    }

    /**
     * Validate object name (prevent path traversal / injection)
     */
    static validateObjectName(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Object name is required');
        }
        // ABAP object names: alphanumeric + underscore, max 30 chars
        if (!/^[A-Za-z0-9_\/]{1,120}$/.test(name)) {
            throw new Error('Invalid object name format');
        }
        // Prevent directory traversal
        if (name.includes('..') || name.includes('//')) {
            throw new Error('Invalid characters in object name');
        }
        return name.toUpperCase();
    }
}

module.exports = SecurityMiddleware;

