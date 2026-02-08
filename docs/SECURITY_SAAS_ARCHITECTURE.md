# Security Architecture & SaaS Multi-Tenancy Guide

## SAP Code Insight — Enterprise SaaS Solution

---

## 1. The Core Security Problem

When sending proprietary ABAP code to an external AI API (Claude), the following risks exist:

| Risk | Impact | Our Mitigation |
|------|--------|----------------|
| Code leakage via API | Competitor gains proprietary logic | 5-level code anonymization before API call |
| Credentials in code | Hardcoded passwords exposed | Automatic credential stripping (always on) |
| PII in comments | Employee names, emails leaked | PII detection and masking |
| Company identification | Business logic tied to company | Company-term obfuscation (configurable) |
| Data at rest | Stolen DB exposes client code | AES-256-GCM encryption per tenant |
| Cross-tenant access | Tenant A sees Tenant B data | Row-level security + HDI container isolation |
| Unauthorized AI usage | Code sent without management approval | Explicit consent workflow required |
| Audit compliance | No trail of what was sent | Comprehensive audit logging (code hashed, never stored) |
| Data retention | Old code lingering in system | Auto-purge with configurable retention policies |

---

## 2. Security Architecture

```
                    CUSTOMER'S SAP SYSTEM
                           │
                    ┌──────┴──────┐
                    │   Cloud     │ ← TLS 1.3
                    │ Connector   │
                    └──────┬──────┘
                           │
              ═════════════╪═══════════════════════════════
              ║  SAP BTP (Customer's Subaccount)          ║
              ║            │                               ║
              ║    ┌───────┴────────┐                      ║
              ║    │  BTP Destination│ ← RFC credentials   ║
              ║    │  (per tenant)  │   stored in BTP      ║
              ║    └───────┬────────┘                      ║
              ║            │                               ║
              ║    ┌───────┴────────────────────────────┐  ║
              ║    │         CAP Application             │  ║
              ║    │                                     │  ║
              ║    │  ┌─────────────────────────────┐   │  ║
              ║    │  │   SECURITY LAYER             │   │  ║
              ║    │  │                              │   │  ║
              ║    │  │  1. Consent Check     ✓     │   │  ║
              ║    │  │  2. Quota Check       ✓     │   │  ║
              ║    │  │  3. Input Validation  ✓     │   │  ║
              ║    │  │  4. CODE ANONYMIZER   ████  │   │  ║
              ║    │  │     ├─ Strip credentials     │   │  ║
              ║    │  │     ├─ Mask PII              │   │  ║
              ║    │  │     ├─ Mask hostnames/IPs    │   │  ║
              ║    │  │     ├─ Obfuscate tables      │   │  ║
              ║    │  │     └─ Obfuscate company     │   │  ║
              ║    │  │        terms                  │   │  ║
              ║    │  │  5. Audit Logging     ✓     │   │  ║
              ║    │  │  6. Encryption        ✓     │   │  ║
              ║    │  └──────────────┬───────────────┘   │  ║
              ║    │                 │                    │  ║
              ║    │         ANONYMIZED CODE ONLY         │  ║
              ║    │                 │                    │  ║
              ║    └─────────────────┼────────────────────┘  ║
              ║                      │                        ║
              ═══════════════════════╪════════════════════════
                                    │ TLS 1.3
                                    ▼
                         ┌──────────────────┐
                         │  Claude API       │
                         │  (Anthropic)      │
                         │                   │
                         │  • Sees ONLY      │
                         │    anonymized code│
                         │  • No training    │
                         │    on API data    │
                         │  • No persistence │
                         └──────────────────┘
```

---

## 3. Code Anonymization — 5 Levels

Tenant admins choose their anonymization level. Higher levels = more privacy, slightly less precise AI output.

### Level: NONE (Only for Private AI Deployments)
- No changes to code
- Only appropriate if customer hosts their own Claude instance

### Level: BASIC
- Strip hardcoded passwords, API keys, tokens
- Mask email addresses, phone numbers
- Mask SAP client numbers

**Example:**
```abap
* BEFORE:
lv_password = 'S3cretP@ss!'.
lv_email = 'john.smith@acme-corp.com'.
CALL FUNCTION 'Z_SEND_EMAIL' DESTINATION 'PROD_ERP_01'.

* AFTER (BASIC):
lv_password = '***CREDENTIAL_REMOVED***'.
lv_email = '[EMAIL_1]'.
CALL FUNCTION 'Z_SEND_EMAIL' DESTINATION 'PROD_ERP_01'.
```

### Level: STANDARD (Recommended Default)
- Everything in BASIC plus:
- Mask hostnames, IP addresses, URLs
- Mask RFC destinations, logical system names
- Sanitize comments with author names and ticket numbers

**Example:**
```abap
* BEFORE:
* Changed by John.Smith on 2024-01-15 (JIRA-4521)
CALL FUNCTION 'Z_GET_DATA' DESTINATION 'PRD-ERP-001'.
lv_host = 'sap-prod.acme-internal.corp'.

* AFTER (STANDARD):
* Changed by [AUTHOR_1] on 2024-01-15 ([TICKET_1])
CALL FUNCTION 'Z_GET_DATA' DESTINATION '[SAP_DEST_1]'.
lv_host = '[HOST_1]'.
```

### Level: STRICT
- Everything in STANDARD plus:
- Obfuscate company-specific terms (configured by tenant admin)
- Obfuscate all Z/Y custom table and structure names

**Example:**
```abap
* BEFORE:
SELECT * FROM ZACME_SALES_ORDER INTO TABLE lt_orders.
* Acme Corp Revenue Calculation Module

* AFTER (STRICT):
SELECT * FROM ZCUST_A3F21B INTO TABLE lt_orders.
* [COMPANY_TERM_1] Revenue Calculation Module
```

### Level: MAXIMUM
- Everything in STRICT plus:
- Obfuscate all Z/Y custom object names in CALLs
- Obfuscate business-meaningful variable names (>8 chars)

### De-Anonymization
The reversal map is kept server-side only. After Claude returns the analysis, the CAP service restores all original names before generating the final document. The customer's document has real names; Claude never sees them.

---

## 4. Data Flow — What Goes Where

| Data | Stored in BTP DB? | Sent to Claude? | Logged? |
|------|-------------------|-----------------|---------|
| Source code (raw) | NEVER persisted | NEVER (anonymized version sent) | Hash only |
| Source code (anonymized) | Temp only, auto-purged (1hr) | YES, via TLS 1.3 | Hash only |
| Reversal map | Encrypted, auto-purged (1hr) | NEVER | Entry count only |
| Claude API response | Temp only, auto-purged (1hr) | N/A (from Claude) | Token count only |
| Generated document | Encrypted, auto-purged (24hr) | NEVER | File hash + size |
| Credentials found in code | IMMEDIATELY stripped | NEVER | Count only |
| Audit trail | Encrypted, retained (1 year) | NEVER | N/A (it IS the log) |
| Object list cache | Encrypted at rest | NEVER | Access events |

---

## 5. SaaS Multi-Tenancy Architecture

```
    Customer A              Customer B              Customer C
    (acme.analyzer.com)     (beta.analyzer.com)     (gamma.analyzer.com)
         │                       │                       │
         ▼                       ▼                       ▼
    ┌─────────────────────────────────────────────────────────┐
    │                   APP ROUTER                             │
    │              (Subdomain-based routing)                    │
    │     TENANT_HOST_PATTERN: ^(.*)-app.cfapps...            │
    └───────────────────────┬─────────────────────────────────┘
                            │
                   JWT Token contains:
                   • tenantId (zid claim)
                   • user scopes
                   • subdomain
                            │
    ┌───────────────────────┴─────────────────────────────────┐
    │                 CAP SERVICE LAYER                         │
    │                                                          │
    │   ┌──────────┐  ┌──────────┐  ┌──────────┐             │
    │   │Tenant A  │  │Tenant B  │  │Tenant C  │  Data       │
    │   │Context   │  │Context   │  │Context   │  Isolation   │
    │   │          │  │          │  │          │             │
    │   │• Own DB  │  │• Own DB  │  │• Own DB  │  HDI per    │
    │   │  schema  │  │  schema  │  │  schema  │  tenant     │
    │   │• Own SAP │  │• Own SAP │  │• Own SAP │             │
    │   │  dest.   │  │  dest.   │  │  dest.   │  Separate   │
    │   │• Own     │  │• Own     │  │• Own     │  destination│
    │   │  config  │  │  config  │  │  config  │             │
    │   │• Own     │  │• Own     │  │• Own     │  Separate   │
    │   │  enc key │  │  enc key │  │  enc key │  keys       │
    │   └──────────┘  └──────────┘  └──────────┘             │
    │                                                          │
    └──────────────────────────────────────────────────────────┘
                       │            │            │
                       ▼            ▼            ▼
              ┌──────────┐  ┌──────────┐  ┌──────────┐
              │SAP ECC   │  │S/4HANA   │  │SAP ECC   │
              │Acme Corp │  │Beta Inc  │  │Gamma Ltd │
              └──────────┘  └──────────┘  └──────────┘
```

### Tenant Isolation Guarantees

| Layer | Isolation Method |
|-------|-----------------|
| Network | Each tenant's SAP connected via their own Cloud Connector + Destination |
| Database | Separate HDI container per tenant (Service Manager) |
| Data | Row-level tenantId filtering on every query |
| Encryption | Unique AES-256 key derived per tenant |
| API Keys | Enterprise plan: tenant brings own Claude API key |
| Audit | Separate audit trail per tenant |
| Configuration | Independent anonymization, retention, templates |

---

## 6. Customer Onboarding Flow

```
Step 1: SUBSCRIBE
    Customer admin subscribes via BTP Cockpit
    → SaaS Registry triggers onSubscribe callback
    → HDI container created for tenant
    → Default config, templates seeded
    → Tenant URL assigned: <subdomain>.analyzer.cfapps.*.com

Step 2: CONFIGURE SAP CONNECTION
    Tenant admin opens Admin UI
    → Enters SAP system details (host, system number, client)
    → BTP Destination created automatically
    → Admin sets RFC password in BTP Cockpit (never handled by our app)
    → Admin installs Cloud Connector on their network
    → Tests connectivity via "Test Connection" button

Step 3: DEPLOY ABAP RFCS
    Tenant's ABAP team deploys the two RFCs:
    → Z_MCP_GET_CUSTOM_OBJECTS
    → Z_MCP_GET_SOURCE_CODE
    (We provide transport request or manual copy)

Step 4: GRANT AI CONSENT
    Tenant admin reads and accepts AI Processing Agreement
    → Consent recorded with timestamp, IP, legal entity
    → AI features unlocked

Step 5: CONFIGURE SECURITY
    Tenant admin sets:
    → Anonymization level (BASIC → MAXIMUM)
    → Company-specific terms to obfuscate
    → Data retention periods
    → IP allowlist (optional)

Step 6: READY TO USE
    Developers can now:
    → Browse custom ABAP objects
    → View source code
    → Generate BRD documents via Claude AI
```

---

## 7. Subscription Plans

| Feature | BASIC | PROFESSIONAL | ENTERPRISE |
|---------|-------|-------------|------------|
| Price/month | $299 | $799 | Custom |
| Users | 5 | 25 | Unlimited |
| AI Calls/month | 100 | 500 | Unlimited |
| Object Sync | 500 | 2,000 | Unlimited |
| Min Anonymization | STANDARD | BASIC | NONE (own API) |
| Document Templates | 3 default | Custom templates | Custom + branded |
| Bring Own API Key | No | No | Yes |
| Data Retention Config | Default only | Configurable | Full control |
| SLA | Best effort | 99.5% | 99.9% |
| Support | Email | Priority | Dedicated |
| Audit Export | No | CSV | SAP DLP integration |
| IP Allowlisting | No | Yes | Yes |
| SSO Integration | XSUAA | XSUAA + IDP | XSUAA + Custom IDP |

---

## 8. Compliance & Certifications

### Anthropic Claude API — Key Security Facts
- Enterprise API data is NOT used for model training
- No persistent storage of API inputs/outputs
- SOC 2 Type II certified
- Data encrypted in transit (TLS 1.3)
- Processing in US data centers (check for EU requirements)

### Our Application — Security Measures
- ISO 27001 aligned security controls
- GDPR Article 30 compliant audit logging
- SOC 2 aligned access controls
- Data minimization (source code never persisted)
- Right to erasure (tenant offboarding wipes all data)
- Explicit consent workflow before AI processing
- Encryption at rest (AES-256-GCM) with per-tenant keys
- BTP Credential Store for key management
- BTP Audit Log Service integration
- Rate limiting and DDoS protection
- Security headers (CSP, HSTS, X-Frame-Options)

---

## 9. Key Files Reference

### Security Layer
| File | Purpose |
|------|---------|
| `srv/lib/security/code-anonymizer.js` | 5-level code anonymization engine |
| `srv/lib/security/encryption-service.js` | AES-256-GCM encryption per tenant |
| `srv/lib/security/audit-logger.js` | Comprehensive security audit trail |
| `srv/lib/security/data-retention.js` | Auto-purge and retention policies |
| `srv/lib/security/security-middleware.js` | Rate limiting, headers, validation |

### SaaS Multi-Tenancy Layer
| File | Purpose |
|------|---------|
| `db/schema-multitenant.cds` | Tenant-aware data model |
| `srv/saas-admin-service.cds` | Admin API definition |
| `srv/saas-admin-service.js` | Onboarding, consent, config |
| `srv/lib/multitenancy/tenant-provisioning.js` | Subscription lifecycle |
| `mta-saas.yaml` | SaaS deployment descriptor |
| `xs-security-mt.json` | Multi-tenant XSUAA config |

### Core Application
| File | Purpose |
|------|---------|
| `srv/code-analyzer-service-secure.js` | Main service with security pipeline |
| `srv/lib/sap-connector.js` | Tenant-aware RFC calls |
| `srv/lib/claude-analyzer.js` | Claude API integration |
| `srv/lib/document-generator.js` | DOCX/PDF generation |

