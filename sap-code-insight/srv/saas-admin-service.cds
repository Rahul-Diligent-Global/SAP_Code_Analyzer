using abap.analyzer from '../db/schema';

/**
 * SaaS Administration Service
 * Accessible only to SaaS Provider Admin and Tenant Admins
 */
service SaaSAdminService @(path: '/api/admin', requires: 'Admin') {

    // ─── Tenant Management ───
    entity TenantConfig      as projection on analyzer.TenantConfig;
    entity TenantConsent     as projection on analyzer.TenantConsent;
    entity TenantUsers       as projection on analyzer.TenantUsers;
    entity SubscriptionPlans as projection on analyzer.SubscriptionPlans;

    // ─── Audit & Compliance ───
    @readonly
    entity SecurityAuditLog  as projection on analyzer.SecurityAuditLog;

    @readonly
    entity DocumentGenerationLog as projection on analyzer.DocumentGenerationLog;

    // ─── Tenant Onboarding Actions ───

    /** Complete SAP system connection setup for a tenant */
    action configureSAPConnection(
        tenantId        : UUID,
        sapHost         : String(200),
        sapSystemNumber : String(2),
        sapClient       : String(3),
        rfcUser         : String(12),
        cloudConnectorLocationId : String(50)
    ) returns String;

    /** Test SAP connectivity for a tenant */
    action testSAPConnection(tenantId : UUID) returns String;

    /** Record AI processing consent */
    action grantAIConsent(
        tenantId       : UUID,
        consentVersion : String(10),
        legalEntity    : String(200)
    ) returns Boolean;

    /** Revoke AI processing consent (stops all Claude API calls) */
    action revokeAIConsent(tenantId : UUID) returns Boolean;

    /** Update tenant security settings */
    action updateSecuritySettings(
        tenantId           : UUID,
        anonymizationLevel : String(10),
        retentionPolicy    : LargeString,
        companyTerms       : LargeString,
        sensitiveKeywords  : LargeString,
        ipAllowlist        : LargeString
    ) returns Boolean;

    /** Trigger immediate data purge for a tenant */
    action triggerDataPurge(tenantId : UUID) returns Integer;

    /** Get tenant usage statistics */
    action getTenantUsage(tenantId : UUID) returns String; // JSON

    /** Offboard tenant - wipe all data */
    action offboardTenant(
        tenantId    : UUID,
        confirmation: String(50) // Must be "DELETE-ALL-DATA"
    ) returns Boolean;
}

