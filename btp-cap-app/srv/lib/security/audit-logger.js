/**
 * ═══════════════════════════════════════════════════════════════════════
 * SECURITY AUDIT LOGGER
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Logs all security-relevant events for compliance:
 * - Code access events (who accessed what code, when)
 * - Claude API calls (what was sent, tokens used, NO actual code logged)
 * - Document generation events
 * - Data anonymization events
 * - Authentication / authorization events
 * - Data retention/deletion events
 *
 * Compliant with: SOC 2, GDPR Article 30, ISO 27001
 */

const cds = require('@sap/cds');
const crypto = require('crypto');
const LOG = cds.log('security-audit');

class SecurityAuditLogger {

    constructor(tenantId) {
        this.tenantId = tenantId;
    }

    /**
     * Log code access event
     */
    async logCodeAccess(params) {
        return this._log({
            eventType: 'CODE_ACCESS',
            severity: 'INFO',
            userId: params.userId,
            action: params.action,  // VIEW, FETCH, EXPORT
            objectName: params.objectName,
            objectType: params.objectType,
            details: {
                linesAccessed: params.lineCount,
                includeCount: params.includeCount,
                sourceSystem: params.sourceSystem
            }
        });
    }

    /**
     * Log Claude API call (CRITICAL - never log actual code)
     */
    async logClaudeAPICall(params) {
        return this._log({
            eventType: 'EXTERNAL_API_CALL',
            severity: 'HIGH',
            userId: params.userId,
            action: 'CLAUDE_API_INVOCATION',
            objectName: params.objectName,
            details: {
                // NEVER log actual source code or API response content
                model: params.model,
                inputTokens: params.inputTokens,
                outputTokens: params.outputTokens,
                anonymizationLevel: params.anonymizationLevel,
                itemsAnonymized: params.itemsAnonymized,
                // Hash of what was sent (for forensic correlation without exposing code)
                payloadHash: this._hashPayload(params.codePayload),
                apiEndpoint: 'api.anthropic.com',
                requestDurationMs: params.durationMs,
                success: params.success,
                errorCode: params.errorCode
            }
        });
    }

    /**
     * Log document generation
     */
    async logDocumentGeneration(params) {
        return this._log({
            eventType: 'DOCUMENT_GENERATION',
            severity: 'MEDIUM',
            userId: params.userId,
            action: 'GENERATE_DOCUMENT',
            objectName: params.objectName,
            details: {
                documentType: params.documentType,
                templateUsed: params.templateUsed,
                detailLevel: params.detailLevel,
                includesSourceCode: params.includesSourceCode,
                fileSizeBytes: params.fileSize,
                documentHash: params.documentHash
            }
        });
    }

    /**
     * Log anonymization event
     */
    async logAnonymization(params) {
        return this._log({
            eventType: 'DATA_ANONYMIZATION',
            severity: 'HIGH',
            userId: params.userId,
            action: 'CODE_ANONYMIZED',
            objectName: params.objectName,
            details: {
                level: params.level,
                itemsStripped: params.itemsStripped,
                credentialsFound: params.credentialsFound,
                piiFound: params.piiFound,
                warnings: params.warnings
            }
        });
    }

    /**
     * Log authentication event
     */
    async logAuth(params) {
        return this._log({
            eventType: 'AUTHENTICATION',
            severity: params.success ? 'INFO' : 'CRITICAL',
            userId: params.userId,
            action: params.success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED',
            details: {
                method: params.method,  // XSUAA, IDP
                ipAddress: this._maskIP(params.ipAddress),
                userAgent: params.userAgent?.substring(0, 100),
                failureReason: params.failureReason
            }
        });
    }

    /**
     * Log data retention/deletion event
     */
    async logDataDeletion(params) {
        return this._log({
            eventType: 'DATA_DELETION',
            severity: 'HIGH',
            userId: params.userId || 'SYSTEM',
            action: params.action,  // AUTO_PURGE, MANUAL_DELETE, TENANT_OFFBOARD
            details: {
                recordsDeleted: params.recordCount,
                dataType: params.dataType,
                retentionPolicy: params.policy,
                reason: params.reason
            }
        });
    }

    /**
     * Log consent/agreement events (for data processing consent)
     */
    async logConsent(params) {
        return this._log({
            eventType: 'DATA_CONSENT',
            severity: 'HIGH',
            userId: params.userId,
            action: params.action,  // CONSENT_GIVEN, CONSENT_REVOKED
            details: {
                consentType: params.consentType,  // CODE_PROCESSING, AI_ANALYSIS
                version: params.consentVersion,
                ipAddress: this._maskIP(params.ipAddress)
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE
    // ═══════════════════════════════════════════════════════════════

    async _log(entry) {
        const auditEntry = {
            ID: crypto.randomUUID(),
            tenantId: this.tenantId,
            timestamp: new Date().toISOString(),
            ...entry,
            details: JSON.stringify(entry.details || {})
        };

        try {
            // Write to DB
            const { SecurityAuditLog } = cds.entities('abap.analyzer');
            await INSERT.into(SecurityAuditLog).entries(auditEntry);

            // Also write to CDS audit log for BTP Audit Log Service integration
            if (entry.severity === 'CRITICAL' || entry.severity === 'HIGH') {
                LOG.warn(`AUDIT [${entry.eventType}] tenant=${this.tenantId} ` +
                    `user=${entry.userId} action=${entry.action} ` +
                    `object=${entry.objectName || 'N/A'}`);
            }

            return auditEntry.ID;
        } catch (error) {
            // Audit logging failure is itself a critical event
            LOG.error(`CRITICAL: Audit log write failed: ${error.message}`, auditEntry);
            throw error;
        }
    }

    _hashPayload(payload) {
        if (!payload) return null;
        return crypto.createHash('sha256')
            .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
            .digest('hex')
            .substring(0, 32);
    }

    _maskIP(ip) {
        if (!ip) return 'unknown';
        // Mask last octet for privacy
        const parts = ip.split('.');
        if (parts.length === 4) {
            return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
        }
        return ip.substring(0, ip.length / 2) + '***';
    }
}

module.exports = SecurityAuditLogger;

