/**
 * ═══════════════════════════════════════════════════════════════════════
 * TENANT PROVISIONING HANDLER
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Manages the complete SaaS tenant lifecycle:
 * 1. Subscription (onboarding) - create tenant DB schema, seed data
 * 2. Upgrade/Downgrade - change plan, adjust limits
 * 3. Unsubscription (offboarding) - wipe data, delete schema
 *
 * Integrates with BTP SaaS Provisioning Service (saas-registry)
 */

const cds = require('@sap/cds');
const LOG = cds.log('tenant-provisioning');
const DataRetentionService = require('../security/data-retention');

class TenantProvisioning {

    /**
     * Called by SaaS Registry when a new tenant subscribes
     * This is the main onboarding entry point
     */
    static async onSubscribe(tenant, options) {
        const tenantId = tenant.subscribedTenantId;
        const tenantHost = tenant.subscribedSubdomain;

        LOG.info(`═══ TENANT ONBOARDING: ${tenantId} (${tenantHost}) ═══`);

        try {
            // Step 1: Create HDI container / DB schema for tenant
            await TenantProvisioning._createTenantDB(tenantId);

            // Step 2: Seed default data
            await TenantProvisioning._seedTenantData(tenantId, tenant);

            // Step 3: Create tenant-specific BTP destination placeholder
            await TenantProvisioning._setupDestination(tenantId, tenantHost);

            LOG.info(`Tenant ${tenantId} onboarded successfully`);

            // Return the app URL for this tenant
            const appUrl = `https://${tenantHost}.${process.env.APP_DOMAIN || 'cfapps.us10.hana.ondemand.com'}`;
            return appUrl;

        } catch (error) {
            LOG.error(`Tenant onboarding failed for ${tenantId}:`, error.message);
            // Rollback: clean up any partial setup
            await TenantProvisioning._rollbackOnboarding(tenantId);
            throw error;
        }
    }

    /**
     * Called by SaaS Registry when a tenant unsubscribes
     */
    static async onUnsubscribe(tenant) {
        const tenantId = tenant.subscribedTenantId;
        LOG.warn(`═══ TENANT OFFBOARDING: ${tenantId} ═══`);

        try {
            // Step 1: Wipe all tenant data
            const retentionService = new DataRetentionService(tenantId);
            await retentionService.wipeAllTenantData();

            // Step 2: Delete HDI container
            await TenantProvisioning._deleteTenantDB(tenantId);

            // Step 3: Clean up destinations
            await TenantProvisioning._cleanupDestination(tenantId);

            LOG.warn(`Tenant ${tenantId} offboarded and all data deleted`);
            return tenantId;

        } catch (error) {
            LOG.error(`Tenant offboarding failed for ${tenantId}:`, error.message);
            throw error;
        }
    }

    /**
     * Called when tenant dependency changes (upgrade/downgrade)
     */
    static async onDependenciesUpdate(tenant, options) {
        const tenantId = tenant.subscribedTenantId;
        LOG.info(`Tenant dependency update: ${tenantId}`);
        // Upgrade schema if needed
        await TenantProvisioning._upgradeTenantDB(tenantId);
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Database Operations
    // ═══════════════════════════════════════════════════════════════

    static async _createTenantDB(tenantId) {
        LOG.info(`Creating DB schema for tenant: ${tenantId}`);

        // In CAP multitenancy, the framework handles HDI container creation
        // when using @sap/cds-mtxs (Multitenancy Extension Service)
        // The schema is deployed automatically per tenant

        // For manual control:
        try {
            const mtxs = require('@sap/cds-mtxs');
            if (mtxs) {
                // CAP MTXS handles this automatically
                LOG.info('Using CAP MTXS for tenant DB provisioning');
            }
        } catch (e) {
            LOG.info('CAP MTXS not available, using manual DB setup');
        }
    }

    static async _deleteTenantDB(tenantId) {
        LOG.warn(`Deleting DB schema for tenant: ${tenantId}`);
        // CAP MTXS handles HDI container deletion
    }

    static async _upgradeTenantDB(tenantId) {
        LOG.info(`Upgrading DB schema for tenant: ${tenantId}`);
        // Deploy latest schema changes to tenant's HDI container
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Seed Default Data
    // ═══════════════════════════════════════════════════════════════

    static async _seedTenantData(tenantId, tenantInfo) {
        LOG.info(`Seeding default data for tenant: ${tenantId}`);

        try {
            const { TenantConfig, DocumentTemplates, SubscriptionPlans } = cds.entities('abap.analyzer');

            // Create tenant config
            await INSERT.into(TenantConfig).entries({
                tenantId: tenantId,
                tenantName: tenantInfo.subscribedSubdomain || 'New Tenant',
                status: 'ACTIVE',
                plan: 'PROFESSIONAL', // Default plan
                anonymizationLevel: 'STANDARD',
                maxUsersAllowed: 10,
                maxAPICallsPerMonth: 500,
                currentAPICallCount: 0,
                apiCallResetDate: new Date().toISOString().split('T')[0],
                retentionPolicy: JSON.stringify({
                    SOURCE_CODE_CACHE: 0,
                    CLAUDE_API_RESPONSE: 1,
                    GENERATED_DOCUMENTS: 24,
                    REVERSAL_MAPS: 1,
                    AUDIT_LOGS: 8760
                }),
                onboardedAt: new Date().toISOString()
            });

            // Seed default BRD template
            await INSERT.into(DocumentTemplates).entries({
                tenantId: tenantId,
                templateName: 'Standard BRD Template',
                templateType: 'BRD',
                description: 'Default Business Requirements Document template',
                isActive: true,
                isDefault: true,
                promptTemplate: 'Analyze this ABAP code and generate a comprehensive BRD following the section structure provided.'
            });

            // Seed Functional Spec template
            await INSERT.into(DocumentTemplates).entries({
                tenantId: tenantId,
                templateName: 'Functional Specification',
                templateType: 'FUNC_SPEC',
                description: 'Detailed functional specification with data mappings',
                isActive: true,
                isDefault: false,
                promptTemplate: 'Create a detailed functional specification from this ABAP code. Include data flow diagrams description, screen layouts, and complete field mappings.'
            });

            // Seed Technical Spec template
            await INSERT.into(DocumentTemplates).entries({
                tenantId: tenantId,
                templateName: 'Technical Design Document',
                templateType: 'TECH_SPEC',
                description: 'Technical architecture and design document',
                isActive: true,
                isDefault: false,
                promptTemplate: 'Generate a technical design document from this ABAP code. Include class diagrams description, database design, API specifications, and performance considerations.'
            });

            LOG.info(`Default data seeded for tenant: ${tenantId}`);

        } catch (error) {
            LOG.error(`Failed to seed data for tenant ${tenantId}:`, error.message);
            throw error;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Destination Management
    // ═══════════════════════════════════════════════════════════════

    static async _setupDestination(tenantId, tenantHost) {
        LOG.info(`Setting up destination placeholder for tenant: ${tenantId}`);

        // Each tenant needs their own BTP destination pointing to their SAP system
        // The destination is named: SAP_ONPREM_<TENANT_ID>
        // Tenant admin configures the actual connection details via self-service UI
        //
        // In production, use BTP Destination Service API to create destinations:
        // POST /destination-configuration/v1/subaccountDestinations
        //
        // For now, we log what needs to be configured
        LOG.info(`Tenant ${tenantId} needs destination: SAP_ONPREM_${tenantId.substring(0, 8).toUpperCase()}`);
    }

    static async _cleanupDestination(tenantId) {
        LOG.info(`Cleaning up destination for tenant: ${tenantId}`);
        // DELETE destination via BTP Destination Service API
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Rollback
    // ═══════════════════════════════════════════════════════════════

    static async _rollbackOnboarding(tenantId) {
        LOG.warn(`Rolling back partial onboarding for tenant: ${tenantId}`);
        try {
            const retentionService = new DataRetentionService(tenantId);
            await retentionService.wipeAllTenantData();
        } catch (e) {
            LOG.error(`Rollback also failed: ${e.message}`);
        }
    }
}

module.exports = TenantProvisioning;

