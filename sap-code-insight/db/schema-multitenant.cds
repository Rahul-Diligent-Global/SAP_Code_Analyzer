namespace abap.analyzer;

using from './schema';
using { cuid, managed } from '@sap/cds/common';

// ═══════════════════════════════════════════════════════════════════════
// MULTI-TENANT AWARE: Extend base entities with tenantId for isolation
// HANA Row-Level Security enforces tenant boundaries at DB level
// ═══════════════════════════════════════════════════════════════════════

// ─── Tenant Isolation Aspect ───
aspect tenantAware {
    tenantId : String(36) @mandatory @readonly;
}

// ─── Extend base entities with tenant isolation ───
extend CustomObjects with tenantAware;
extend DocumentGenerationLog with tenantAware;
extend DocumentTemplates with tenantAware;

// ═══════════════════════════════════════════════════════════════════════
// TENANT MANAGEMENT (new entities)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Tenant configuration - one record per subscribed customer
 */
entity TenantConfig : cuid, managed, tenantAware {
    tenantName          : String(200)  @title: 'Company Name';
    tenantDomain        : String(200)  @title: 'Custom Domain';
    status              : String(20)   @title: 'Status'; // ACTIVE, SUSPENDED, OFFBOARDING
    plan                : String(20)   @title: 'Subscription Plan'; // BASIC, PROFESSIONAL, ENTERPRISE
    sapSystemId         : String(10)   @title: 'SAP System ID';
    sapClientNumber     : String(3)    @title: 'SAP Client';
    destinationName     : String(100)  @title: 'BTP Destination Name';
    cloudConnectorLocId : String(50)   @title: 'Cloud Connector Location ID';
    maxUsersAllowed     : Integer      @title: 'Max Users';
    maxAPICallsPerMonth : Integer      @title: 'Max Claude API Calls/Month';
    currentAPICallCount : Integer default 0;
    apiCallResetDate    : Date;

    // Security settings per tenant
    anonymizationLevel  : String(10) default 'STANDARD'; // NONE/BASIC/STANDARD/STRICT/MAXIMUM
    retentionPolicy     : LargeString; // JSON with retention hours per data type
    companyTerms        : LargeString; // JSON array of company-specific terms to obfuscate
    sensitiveKeywords   : LargeString; // JSON array of keywords to strip from comments
    ipAllowlist         : LargeString; // JSON array of allowed IP ranges
    claudeApiKeyOverride: LargeString; // Encrypted - tenant's own API key (Enterprise plan)

    // Onboarding tracking
    onboardedAt         : Timestamp;
    onboardedBy         : String(100);
    lastActiveAt        : Timestamp;
}

/**
 * Consent records for AI processing (GDPR/Compliance)
 */
entity TenantConsent : cuid, managed, tenantAware {
    consentType    : String(50)    @title: 'Consent Type'; // AI_CODE_PROCESSING, DATA_COLLECTION
    status         : String(20)    @title: 'Status'; // ACTIVE, REVOKED, EXPIRED
    grantedBy      : String(100)   @title: 'Granted By (Admin)';
    grantedAt      : Timestamp;
    expiresAt      : Timestamp;
    consentVersion : String(10)    @title: 'Agreement Version';
    ipAddress      : String(50);
    legalEntity    : String(200);
    agreementText  : LargeString   @title: 'Full Agreement Text Accepted';
}

/**
 * Tenant users mapping (supplementary to XSUAA)
 */
entity TenantUsers : cuid, managed, tenantAware {
    userId     : String(100)  @title: 'User ID (from IDP)';
    email      : String(200)  @title: 'Email';
    role       : String(20)   @title: 'Role'; // ADMIN, DEVELOPER, VIEWER
    isActive   : Boolean default true;
    lastLogin  : Timestamp;
}

// ═══════════════════════════════════════════════════════════════════════
// SECURITY & AUDIT ENTITIES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Security audit log - immutable, comprehensive
 */
entity SecurityAuditLog : cuid, tenantAware {
    timestamp   : Timestamp  @title: 'Event Time';
    eventType   : String(50) @title: 'Event Type';
    severity    : String(10) @title: 'Severity'; // INFO, MEDIUM, HIGH, CRITICAL
    userId      : String(100);
    action      : String(50);
    objectName  : String(120);
    details     : LargeString; // JSON
}

/**
 * Temporary storage for Claude API responses (auto-purged)
 */
entity ClaudeResponseCache : cuid, managed, tenantAware {
    requestId      : UUID;
    objectName     : String(120);
    responseHash   : String(64);  // SHA-256 hash (not the actual response in prod)
    tokensUsed     : Integer;
    expiresAt      : Timestamp;
}

/**
 * Reversal maps for de-anonymization (auto-purged)
 */
entity ReversalMaps : cuid, managed, tenantAware {
    requestId      : UUID;
    encryptedMap   : LargeString;  // AES-256 encrypted JSON
    expiresAt      : Timestamp;
}

/**
 * Temporary source code holder (auto-purged, memory-preferred)
 */
entity TempSourceCode : cuid, managed, tenantAware {
    requestId      : UUID;
    objectName     : String(120);
    encryptedCode  : LargeString;  // Encrypted, never plain text
    expiresAt      : Timestamp;
}

/**
 * Session data (auto-purged)
 */
entity SessionData : cuid, managed, tenantAware {
    sessionId   : String(100);
    userId      : String(100);
    data        : LargeString;
    expiresAt   : Timestamp;
}

// ═══════════════════════════════════════════════════════════════════════
// SUBSCRIPTION PLAN LIMITS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Plan definitions
 */
entity SubscriptionPlans : cuid, managed {
    planId              : String(20)  @title: 'Plan ID';
    planName            : String(100) @title: 'Plan Name';
    maxUsers            : Integer;
    maxAPICallsPerMonth : Integer;
    maxObjectsSync      : Integer;
    features            : LargeString; // JSON array of enabled features
    anonymizationMin    : String(10); // Minimum anonymization level required
    canUseOwnAPIKey     : Boolean default false;
    pricePerMonth       : Decimal(10,2);
}
