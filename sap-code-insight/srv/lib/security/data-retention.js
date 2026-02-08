/**
 * ═══════════════════════════════════════════════════════════════════════
 * DATA RETENTION & PURGE SERVICE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ensures proprietary code is NOT retained longer than necessary:
 * 1. Source code is NEVER persisted - only held in memory during processing
 * 2. Claude API responses are purged after document generation
 * 3. Generated documents have configurable retention (default: 24 hours)
 * 4. Audit logs retained per compliance requirement (default: 1 year)
 * 5. Reversal maps (anonymization) purged with their associated request
 *
 * Each tenant can configure their own retention policy
 */

const cds = require('@sap/cds');
const LOG = cds.log('data-retention');

// Default retention periods (in hours)
const DEFAULT_RETENTION = {
    SOURCE_CODE_CACHE: 0,        // NEVER cache source code by default
    CLAUDE_API_RESPONSE: 1,      // Purge API response after 1 hour
    GENERATED_DOCUMENTS: 24,     // Keep documents for 24 hours
    REVERSAL_MAPS: 1,            // Purge with API response
    AUDIT_LOGS: 8760,            // 1 year (365 * 24)
    SESSION_DATA: 4,             // 4 hours
    FAILED_REQUESTS: 48,         // Keep failed request logs for 48 hours
};

class DataRetentionService {

    constructor(tenantId) {
        this.tenantId = tenantId;
        this.retentionPolicy = { ...DEFAULT_RETENTION };
    }

    /**
     * Load tenant-specific retention policy
     */
    async loadTenantPolicy() {
        try {
            const { TenantConfig } = cds.entities('abap.analyzer');
            const config = await SELECT.one.from(TenantConfig)
                .where({ tenantId: this.tenantId });

            if (config?.retentionPolicy) {
                const tenantPolicy = JSON.parse(config.retentionPolicy);
                this.retentionPolicy = { ...DEFAULT_RETENTION, ...tenantPolicy };
            }
        } catch (e) {
            LOG.warn(`Using default retention policy for tenant ${this.tenantId}`);
        }
    }

    /**
     * Run scheduled purge for all data types
     * Should be called by a scheduled job (e.g., every hour)
     */
    async runPurge() {
        LOG.info(`Running data purge for tenant: ${this.tenantId}`);
        const SecurityAuditLogger = require('./audit-logger');
        const auditLogger = new SecurityAuditLogger(this.tenantId);
        let totalPurged = 0;

        // 1. Purge Claude API response cache
        const apiPurged = await this._purgeByAge(
            'ClaudeResponseCache',
            this.retentionPolicy.CLAUDE_API_RESPONSE
        );
        totalPurged += apiPurged;

        // 2. Purge generated documents
        const docPurged = await this._purgeByAge(
            'GeneratedDocuments',
            this.retentionPolicy.GENERATED_DOCUMENTS
        );
        totalPurged += docPurged;

        // 3. Purge reversal maps
        const mapPurged = await this._purgeByAge(
            'ReversalMaps',
            this.retentionPolicy.REVERSAL_MAPS
        );
        totalPurged += mapPurged;

        // 4. Purge old audit logs (keep per policy)
        const auditPurged = await this._purgeByAge(
            'SecurityAuditLog',
            this.retentionPolicy.AUDIT_LOGS
        );
        totalPurged += auditPurged;

        // 5. Purge session data
        const sessionPurged = await this._purgeByAge(
            'SessionData',
            this.retentionPolicy.SESSION_DATA
        );
        totalPurged += sessionPurged;

        // Log the purge event
        if (totalPurged > 0) {
            await auditLogger.logDataDeletion({
                action: 'AUTO_PURGE',
                recordCount: totalPurged,
                dataType: 'MIXED',
                policy: JSON.stringify(this.retentionPolicy),
                reason: 'Scheduled data retention purge'
            });
        }

        LOG.info(`Purge complete: ${totalPurged} records removed`);
        return totalPurged;
    }

    /**
     * Immediately purge all data for a specific processing request
     * Called after document download to ensure no code lingers
     */
    async purgeRequestData(requestId) {
        LOG.info(`Immediate purge for request: ${requestId}`);

        try {
            const entities = cds.entities('abap.analyzer');

            // Delete API response cache
            await DELETE.from(entities.ClaudeResponseCache)
                .where({ requestId, tenantId: this.tenantId });

            // Delete reversal map
            await DELETE.from(entities.ReversalMaps)
                .where({ requestId, tenantId: this.tenantId });

            // Delete any temporary source code (should be empty, but safety net)
            await DELETE.from(entities.TempSourceCode)
                .where({ requestId, tenantId: this.tenantId });

            LOG.info(`Request data purged: ${requestId}`);

        } catch (error) {
            LOG.error(`Failed to purge request data: ${error.message}`);
            throw error;
        }
    }

    /**
     * Complete tenant data wipe (for offboarding)
     */
    async wipeAllTenantData() {
        LOG.warn(`WIPING ALL DATA for tenant: ${this.tenantId}`);

        const SecurityAuditLogger = require('./audit-logger');
        const auditLogger = new SecurityAuditLogger(this.tenantId);

        const entities = cds.entities('abap.analyzer');
        const tables = [
            'CustomObjects', 'DocumentGenerationLog', 'DocumentTemplates',
            'ClaudeResponseCache', 'GeneratedDocuments', 'ReversalMaps',
            'TempSourceCode', 'SessionData', 'TenantConfig'
        ];

        let totalDeleted = 0;
        for (const table of tables) {
            if (entities[table]) {
                try {
                    const result = await DELETE.from(entities[table])
                        .where({ tenantId: this.tenantId });
                    totalDeleted += result || 0;
                } catch (e) {
                    LOG.warn(`Could not purge ${table}: ${e.message}`);
                }
            }
        }

        // Log before deleting audit logs (audit log deletion is itself logged)
        await auditLogger.logDataDeletion({
            action: 'TENANT_OFFBOARD',
            recordCount: totalDeleted,
            dataType: 'ALL_TENANT_DATA',
            reason: 'Tenant offboarding - complete data wipe'
        });

        // Finally delete audit logs
        await DELETE.from(entities.SecurityAuditLog)
            .where({ tenantId: this.tenantId });

        LOG.warn(`Tenant data wipe complete: ${totalDeleted} records`);
        return totalDeleted;
    }

    /**
     * Get retention policy summary (for tenant admin UI)
     */
    getPolicySummary() {
        return Object.entries(this.retentionPolicy).map(([key, hours]) => ({
            dataType: key,
            retentionHours: hours,
            retentionDays: Math.round(hours / 24 * 10) / 10,
            description: this._getDescription(key)
        }));
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE
    // ═══════════════════════════════════════════════════════════════

    async _purgeByAge(entityName, retentionHours) {
        try {
            const entities = cds.entities('abap.analyzer');
            if (!entities[entityName]) return 0;

            const cutoff = new Date(Date.now() - retentionHours * 3600 * 1000).toISOString();

            const result = await DELETE.from(entities[entityName])
                .where({
                    tenantId: this.tenantId,
                    createdAt: { '<': cutoff }
                });

            return result || 0;
        } catch (e) {
            LOG.warn(`Purge failed for ${entityName}: ${e.message}`);
            return 0;
        }
    }

    _getDescription(key) {
        const descriptions = {
            SOURCE_CODE_CACHE: 'Cached ABAP source code (0 = never cache)',
            CLAUDE_API_RESPONSE: 'Raw responses from Claude API',
            GENERATED_DOCUMENTS: 'Generated BRD/PDF documents available for download',
            REVERSAL_MAPS: 'Anonymization reversal mappings',
            AUDIT_LOGS: 'Security and compliance audit trail',
            SESSION_DATA: 'User session and temporary data',
            FAILED_REQUESTS: 'Logs of failed processing requests',
        };
        return descriptions[key] || key;
    }
}

module.exports = DataRetentionService;

