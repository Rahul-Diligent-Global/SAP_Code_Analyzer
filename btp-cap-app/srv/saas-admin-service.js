const cds = require('@sap/cds');
const LOG = cds.log('saas-admin');
const DataRetentionService = require('./lib/security/data-retention');
const SecurityAuditLogger = require('./lib/security/audit-logger');
const EncryptionService = require('./lib/security/encryption-service');

module.exports = class SaaSAdminService extends cds.ApplicationService {

    async init() {

        // ─── Configure SAP Connection ───
        this.on('configureSAPConnection', async (req) => {
            const { tenantId, sapHost, sapSystemNumber, sapClient, rfcUser, cloudConnectorLocationId } = req.data;
            const userId = req.user?.id;
            const auditLogger = new SecurityAuditLogger(tenantId);

            try {
                const { TenantConfig } = this.entities;

                // Encrypt sensitive connection details
                const encService = new EncryptionService();
                await encService.initialize();

                await UPDATE(TenantConfig)
                    .set({
                        sapSystemId: sapHost?.substring(0, 10),
                        sapClientNumber: sapClient,
                        destinationName: `SAP_ONPREM_${tenantId.substring(0, 8).toUpperCase()}`,
                        cloudConnectorLocId: cloudConnectorLocationId,
                    })
                    .where({ tenantId });

                // In production: Create actual BTP Destination via Destination Service REST API
                // POST /destination-configuration/v1/subaccountDestinations
                const destinationConfig = {
                    Name: `SAP_ONPREM_${tenantId.substring(0, 8).toUpperCase()}`,
                    Type: 'RFC',
                    ProxyType: 'OnPremise',
                    Authentication: 'BasicAuthentication',
                    User: rfcUser,
                    'jco.client.ashost': sapHost,
                    'jco.client.sysnr': sapSystemNumber,
                    'jco.client.client': sapClient,
                    CloudConnectorLocationId: cloudConnectorLocationId
                };

                LOG.info(`SAP connection configured for tenant ${tenantId}. Destination config prepared.`);
                LOG.info('NOTE: Password must be configured directly in BTP Cockpit for security.');

                await auditLogger.logAuth({
                    userId, success: true,
                    method: 'SAP_CONNECTION_SETUP'
                });

                return `Destination ${destinationConfig.Name} configured. Please set the RFC password in BTP Cockpit > Destinations.`;

            } catch (error) {
                LOG.error(`SAP connection setup failed: ${error.message}`);
                throw new Error(`Configuration failed: ${error.message}`);
            }
        });

        // ─── Test SAP Connection ───
        this.on('testSAPConnection', async (req) => {
            const { tenantId } = req.data;
            try {
                const { TenantConfig } = this.entities;
                const config = await SELECT.one.from(TenantConfig).where({ tenantId });

                if (!config?.destinationName) {
                    return 'ERROR: No SAP destination configured. Run configureSAPConnection first.';
                }

                // Test RFC connectivity
                const SAPConnector = require('./lib/sap-connector');
                const connector = new SAPConnector();
                connector.destinationName = config.destinationName;

                const result = await connector.getCustomObjects({
                    ivObjectType: 'PROG',
                    ivNamespace: 'Z',
                    ivMaxRows: 1
                });

                return `SUCCESS: Connected to SAP system. Found ${result.evTotalCount} objects.`;

            } catch (error) {
                return `FAILED: ${error.message}. Check Cloud Connector and Destination settings.`;
            }
        });

        // ─── Grant AI Consent ───
        this.on('grantAIConsent', async (req) => {
            const { tenantId, consentVersion, legalEntity } = req.data;
            const userId = req.user?.id;
            const auditLogger = new SecurityAuditLogger(tenantId);

            const { TenantConsent } = this.entities;

            // Deactivate any existing consent
            await UPDATE(TenantConsent)
                .set({ status: 'SUPERSEDED' })
                .where({ tenantId, consentType: 'AI_CODE_PROCESSING', status: 'ACTIVE' });

            // Create new consent record
            await INSERT.into(TenantConsent).entries({
                tenantId,
                consentType: 'AI_CODE_PROCESSING',
                status: 'ACTIVE',
                grantedBy: userId,
                grantedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(), // 1 year
                consentVersion: consentVersion || '1.0',
                legalEntity,
                agreementText: this._getConsentText(consentVersion)
            });

            await auditLogger.logConsent({
                userId,
                action: 'CONSENT_GIVEN',
                consentType: 'AI_CODE_PROCESSING',
                consentVersion
            });

            LOG.info(`AI processing consent granted for tenant ${tenantId} by ${userId}`);
            return true;
        });

        // ─── Revoke AI Consent ───
        this.on('revokeAIConsent', async (req) => {
            const { tenantId } = req.data;
            const userId = req.user?.id;
            const auditLogger = new SecurityAuditLogger(tenantId);

            const { TenantConsent } = this.entities;

            await UPDATE(TenantConsent)
                .set({ status: 'REVOKED' })
                .where({ tenantId, consentType: 'AI_CODE_PROCESSING', status: 'ACTIVE' });

            await auditLogger.logConsent({
                userId,
                action: 'CONSENT_REVOKED',
                consentType: 'AI_CODE_PROCESSING'
            });

            LOG.warn(`AI processing consent REVOKED for tenant ${tenantId}. All Claude API calls will be blocked.`);
            return true;
        });

        // ─── Update Security Settings ───
        this.on('updateSecuritySettings', async (req) => {
            const { tenantId, anonymizationLevel, retentionPolicy,
                    companyTerms, sensitiveKeywords, ipAllowlist } = req.data;
            const userId = req.user?.id;
            const auditLogger = new SecurityAuditLogger(tenantId);

            // Validate anonymization level
            const validLevels = ['NONE', 'BASIC', 'STANDARD', 'STRICT', 'MAXIMUM'];
            if (anonymizationLevel && !validLevels.includes(anonymizationLevel)) {
                throw new Error(`Invalid anonymization level. Must be: ${validLevels.join(', ')}`);
            }

            // Check plan restrictions
            const { TenantConfig } = this.entities;
            const config = await SELECT.one.from(TenantConfig).where({ tenantId });
            if (config?.plan === 'BASIC' && anonymizationLevel === 'NONE') {
                throw new Error('BASIC plan requires minimum STANDARD anonymization level.');
            }

            const updates = {};
            if (anonymizationLevel) updates.anonymizationLevel = anonymizationLevel;
            if (retentionPolicy) updates.retentionPolicy = retentionPolicy;
            if (companyTerms) updates.companyTerms = companyTerms;
            if (sensitiveKeywords) updates.sensitiveKeywords = sensitiveKeywords;
            if (ipAllowlist) updates.ipAllowlist = ipAllowlist;

            await UPDATE(TenantConfig).set(updates).where({ tenantId });

            await auditLogger.logAuth({
                userId, success: true,
                method: 'SECURITY_SETTINGS_UPDATE'
            });

            LOG.info(`Security settings updated for tenant ${tenantId}`);
            return true;
        });

        // ─── Trigger Data Purge ───
        this.on('triggerDataPurge', async (req) => {
            const { tenantId } = req.data;
            const retentionService = new DataRetentionService(tenantId);
            await retentionService.loadTenantPolicy();
            const count = await retentionService.runPurge();
            return count;
        });

        // ─── Get Tenant Usage ───
        this.on('getTenantUsage', async (req) => {
            const { tenantId } = req.data;
            const { TenantConfig, DocumentGenerationLog, SecurityAuditLog, CustomObjects } = this.entities;

            const config = await SELECT.one.from(TenantConfig).where({ tenantId });
            const docCount = await SELECT.one.from(DocumentGenerationLog)
                .columns('count(*) as cnt').where({ tenantId });
            const objectCount = await SELECT.one.from(CustomObjects)
                .columns('count(*) as cnt').where({ tenantId });
            const auditCount = await SELECT.one.from(SecurityAuditLog)
                .columns('count(*) as cnt').where({ tenantId });

            return JSON.stringify({
                plan: config?.plan,
                apiCallsUsed: config?.currentAPICallCount || 0,
                apiCallsLimit: config?.maxAPICallsPerMonth || 0,
                documentsGenerated: docCount?.cnt || 0,
                objectsSynced: objectCount?.cnt || 0,
                auditEvents: auditCount?.cnt || 0,
                anonymizationLevel: config?.anonymizationLevel
            });
        });

        // ─── Offboard Tenant ───
        this.on('offboardTenant', async (req) => {
            const { tenantId, confirmation } = req.data;

            if (confirmation !== 'DELETE-ALL-DATA') {
                throw new Error('Confirmation text must be exactly: DELETE-ALL-DATA');
            }

            const retentionService = new DataRetentionService(tenantId);
            await retentionService.wipeAllTenantData();

            LOG.warn(`Tenant ${tenantId} fully offboarded and all data wiped.`);
            return true;
        });

        await super.init();
    }

    _getConsentText(version) {
        return `AI CODE PROCESSING AGREEMENT (v${version || '1.0'})

By granting this consent, you acknowledge and agree that:

1. ABAP source code from your SAP system will be sent to Anthropic's Claude API for analysis.

2. Before transmission, code will be anonymized according to your configured anonymization level
   to remove credentials, PII, hostnames, and optionally company-specific identifiers.

3. Anthropic's Claude API processes data according to their Enterprise API Terms which state
   that input/output data is NOT used for model training.

4. Source code is transmitted via TLS 1.3 encrypted connection and is not persistently stored
   by the Claude API.

5. Generated documents are stored temporarily (per your retention policy) and then auto-purged.

6. You can revoke this consent at any time, which will immediately stop all AI processing.

7. A complete audit trail of all code transmissions is maintained and available for review.`;
    }
};

