/**
 * ═══════════════════════════════════════════════════════════════════════
 * CODE ANONYMIZER / OBFUSCATOR
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CRITICAL SECURITY COMPONENT
 *
 * Before ANY code is sent to Claude API (external service), this module:
 * 1. Strips hardcoded credentials, passwords, API keys
 * 2. Obfuscates company-specific table/field names (optional)
 * 3. Removes business-sensitive comments
 * 4. Replaces real hostnames, IPs, URLs with placeholders
 * 5. Masks employee names, email addresses, phone numbers
 * 6. Provides a reversal map so document generator can restore names
 *
 * Anonymization Levels:
 *   NONE     - No anonymization (only for internal/private Claude deployments)
 *   BASIC    - Strip credentials + PII only
 *   STANDARD - BASIC + obfuscate hostnames, URLs, comments with names
 *   STRICT   - STANDARD + obfuscate custom table/field names, company references
 *   MAXIMUM  - STRICT + obfuscate all Z/Y object names, variable names
 */

const cds = require('@sap/cds');
const crypto = require('crypto');
const LOG = cds.log('code-anonymizer');

class CodeAnonymizer {

    constructor(level = 'STANDARD') {
        this.level = level;
        this.reversalMap = new Map();  // For de-anonymization in final document
        this.counter = 0;
        this.sensitivePatterns = [];
        this._initPatterns();
    }

    /**
     * Main entry: Anonymize ABAP source code before sending to Claude
     * Returns { anonymizedCode, reversalMap, strippedItemsCount }
     */
    anonymize(sourceCode, tenantConfig = {}) {
        if (this.level === 'NONE') {
            return {
                anonymizedCode: sourceCode,
                reversalMap: {},
                strippedItemsCount: 0,
                warnings: ['WARNING: No anonymization applied. Code sent as-is to external API.']
            };
        }

        let code = sourceCode;
        let strippedCount = 0;
        const warnings = [];

        // ─── PHASE 1: Always strip (all levels) ───
        // Hardcoded credentials - ALWAYS remove regardless of level
        const credResult = this._stripCredentials(code);
        code = credResult.code;
        strippedCount += credResult.count;
        if (credResult.count > 0) {
            warnings.push(`Stripped ${credResult.count} hardcoded credential(s) from source code.`);
        }

        // ─── PHASE 2: BASIC level and above ───
        if (['BASIC', 'STANDARD', 'STRICT', 'MAXIMUM'].includes(this.level)) {
            // PII: names, emails, phone numbers
            const piiResult = this._maskPII(code);
            code = piiResult.code;
            strippedCount += piiResult.count;

            // SAP client numbers that could identify systems
            const clientResult = this._maskClientNumbers(code);
            code = clientResult.code;
            strippedCount += clientResult.count;
        }

        // ─── PHASE 3: STANDARD level and above ───
        if (['STANDARD', 'STRICT', 'MAXIMUM'].includes(this.level)) {
            // Hostnames, IPs, URLs
            const netResult = this._maskNetworkInfo(code);
            code = netResult.code;
            strippedCount += netResult.count;

            // Comments containing business-sensitive info
            const commentResult = this._sanitizeComments(code, tenantConfig);
            code = commentResult.code;
            strippedCount += commentResult.count;

            // RFC destinations, logical systems
            const destResult = this._maskDestinations(code);
            code = destResult.code;
            strippedCount += destResult.count;
        }

        // ─── PHASE 4: STRICT level and above ───
        if (['STRICT', 'MAXIMUM'].includes(this.level)) {
            // Company-specific terms from tenant config
            if (tenantConfig.companyTerms && tenantConfig.companyTerms.length > 0) {
                const termResult = this._obfuscateCompanyTerms(code, tenantConfig.companyTerms);
                code = termResult.code;
                strippedCount += termResult.count;
            }

            // Custom table names (keep standard SAP tables readable)
            const tableResult = this._obfuscateCustomTables(code);
            code = tableResult.code;
            strippedCount += tableResult.count;
        }

        // ─── PHASE 5: MAXIMUM level ───
        if (this.level === 'MAXIMUM') {
            // Obfuscate all Z/Y custom object names
            const objResult = this._obfuscateObjectNames(code);
            code = objResult.code;
            strippedCount += objResult.count;

            // Obfuscate variable names (aggressive)
            const varResult = this._obfuscateVariables(code);
            code = varResult.code;
            strippedCount += varResult.count;
        }

        // Add anonymization header comment
        code = this._addAnonymizationHeader(code, strippedCount);

        // Build serializable reversal map
        const reversalMapObj = {};
        this.reversalMap.forEach((original, placeholder) => {
            reversalMapObj[placeholder] = original;
        });

        LOG.info(`Anonymization complete: level=${this.level}, items=${strippedCount}`);

        return {
            anonymizedCode: code,
            reversalMap: reversalMapObj,
            strippedItemsCount: strippedCount,
            warnings
        };
    }

    /**
     * De-anonymize text (used to restore real names in final document)
     * Only called server-side when generating the document, NEVER sent externally
     */
    deAnonymize(text, reversalMap) {
        let result = text;
        for (const [placeholder, original] of Object.entries(reversalMap)) {
            result = result.split(placeholder).join(original);
        }
        return result;
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Pattern Initialization
    // ═══════════════════════════════════════════════════════════════

    _initPatterns() {
        // Credential patterns in ABAP code
        this.credentialPatterns = [
            // Hardcoded passwords
            /(['"])(?:password|passwd|pwd|kennwort)\1\s*[=:]\s*(['"])[^'"]+\2/gi,
            /(?:password|passwd|pwd)\s*=\s*(['"])[^'"]+\1/gi,
            // API keys
            /(['"])(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?key)\1\s*[=:]\s*(['"])[^'"]+\2/gi,
            /(?:sk-ant-|sk-|xoxb-|xoxp-|ghp_|gho_|AKIA)[A-Za-z0-9_\-]{20,}/g,
            // Bearer tokens
            /Bearer\s+[A-Za-z0-9_\-\.]+/gi,
            // Basic auth
            /Basic\s+[A-Za-z0-9+\/=]{10,}/gi,
            // SAP connection strings with passwords
            /(?:RFCDES|RFCDATA).*?(?:RFCPSWD|RFCPASS)\s*=\s*['"][^'"]+['"]/gi,
            // Hardcoded client secrets
            /client[_-]?secret\s*[=:]\s*(['"])[^'"]+\1/gi,
            // Database connection strings
            /(?:jdbc|odbc):.*?(?:password|pwd)\s*=\s*[^;]+/gi,
        ];

        // PII patterns
        this.piiPatterns = [
            // Email addresses
            { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, type: 'EMAIL' },
            // Phone numbers (international)
            { regex: /(?:\+\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?){2,3}\d{2,4}/g, type: 'PHONE' },
            // IP Addresses
            { regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, type: 'IP' },
            // URLs with internal hostnames
            { regex: /https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+/g, type: 'URL' },
        ];

        // SAP-specific sensitive patterns
        this.sapSensitivePatterns = [
            // RFC destinations
            /(?:DESTINATION|RFCDEST)\s*=?\s*(['"])[^'"]+\1/gi,
            // Logical system names
            /(?:LOGSYS|LOGICAL_SYSTEM)\s*=?\s*(['"])[^'"]+\1/gi,
            // SAP Router strings
            /\/H\/[^\s\/]+\/S\/\d+/g,
        ];
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Phase 1 - Strip Credentials (ALWAYS)
    // ═══════════════════════════════════════════════════════════════

    _stripCredentials(code) {
        let result = code;
        let count = 0;

        for (const pattern of this.credentialPatterns) {
            const matches = result.match(pattern);
            if (matches) {
                count += matches.length;
                result = result.replace(pattern, (match) => {
                    LOG.warn(`SECURITY: Stripped credential pattern from code`);
                    return '***CREDENTIAL_REMOVED***';
                });
            }
        }

        // Also strip anything that looks like a 32+ char hex/base64 token in string literals
        result = result.replace(/(['"])[A-Fa-f0-9]{32,}(['"])/g, (match, q1, q2) => {
            count++;
            return `${q1}***TOKEN_REMOVED***${q2}`;
        });

        return { code: result, count };
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Phase 2 - Mask PII
    // ═══════════════════════════════════════════════════════════════

    _maskPII(code) {
        let result = code;
        let count = 0;

        for (const { regex, type } of this.piiPatterns) {
            result = result.replace(regex, (match) => {
                // Don't mask SAP standard URLs
                if (type === 'URL' && (
                    match.includes('sap.com') ||
                    match.includes('sapui5') ||
                    match.includes('help.sap.com')
                )) {
                    return match;
                }

                // Don't mask loopback/localhost IPs
                if (type === 'IP' && (
                    match.startsWith('127.') ||
                    match === '0.0.0.0' ||
                    match.startsWith('10.') ||  // Keep class but mask last octets
                    match.startsWith('192.168.')
                )) {
                    // Mask last octets of private IPs
                    if (match.startsWith('10.') || match.startsWith('192.168.')) {
                        const placeholder = `[INTERNAL_IP_${++this.counter}]`;
                        this.reversalMap.set(placeholder, match);
                        count++;
                        return placeholder;
                    }
                    return match;
                }

                const placeholder = `[${type}_${++this.counter}]`;
                this.reversalMap.set(placeholder, match);
                count++;
                return placeholder;
            });
        }

        return { code: result, count };
    }

    _maskClientNumbers(code) {
        let result = code;
        let count = 0;

        // SAP client numbers in context (e.g., sy-mandt = '100')
        result = result.replace(
            /(sy-mandt|mandt|client)\s*=\s*(['"])(\d{3})\2/gi,
            (match, field, quote, client) => {
                const placeholder = `[CLIENT_${++this.counter}]`;
                this.reversalMap.set(placeholder, client);
                count++;
                return `${field} = ${quote}${placeholder}${quote}`;
            }
        );

        return { code: result, count };
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Phase 3 - Network Info & Comments
    // ═══════════════════════════════════════════════════════════════

    _maskNetworkInfo(code) {
        let result = code;
        let count = 0;

        // Hostnames in string literals (pattern: xxx.company.com, xxx.internal.corp)
        result = result.replace(
            /(['"])([a-zA-Z0-9\-]+\.(?:internal|corp|local|company|intra|private|prod|dev|staging|uat)\.[a-zA-Z]{2,})(['"])/gi,
            (match, q1, hostname, q2) => {
                const placeholder = `[HOST_${++this.counter}]`;
                this.reversalMap.set(placeholder, hostname);
                count++;
                return `${q1}${placeholder}${q2}`;
            }
        );

        // SAP system IDs (3-char SIDs in typical patterns)
        result = result.replace(
            /(?:sapsid|SID|system_id)\s*=\s*(['"])([A-Z][A-Z0-9]{2})\1/gi,
            (match, quote, sid) => {
                const placeholder = `[SID_${++this.counter}]`;
                this.reversalMap.set(placeholder, sid);
                count++;
                return `system_id = ${quote}${placeholder}${quote}`;
            }
        );

        return { code: result, count };
    }

    _sanitizeComments(code, tenantConfig) {
        let result = code;
        let count = 0;

        // Remove comments that contain author names / change history with real names
        // Pattern: * Changed by John.Smith on 2024-01-15
        result = result.replace(
            /^\*.*(?:changed|modified|created|updated|fixed)\s+by\s+([A-Z][a-z]+[\s.][A-Z][a-z]+)/gmi,
            (match, name) => {
                const placeholder = `[AUTHOR_${++this.counter}]`;
                this.reversalMap.set(placeholder, name);
                count++;
                return match.replace(name, placeholder);
            }
        );

        // Remove comments with ticket/incident numbers (could identify company)
        result = result.replace(
            /^\*.*(?:ticket|incident|JIRA|SNOW|CHG|INC|REQ)[\s:#-]*([A-Z]{2,5}-?\d{4,10})/gmi,
            (match, ticketId) => {
                const placeholder = `[TICKET_${++this.counter}]`;
                this.reversalMap.set(placeholder, ticketId);
                count++;
                return match.replace(ticketId, placeholder);
            }
        );

        // Tenant-specific comment keywords to strip
        if (tenantConfig.sensitiveKeywords) {
            for (const keyword of tenantConfig.sensitiveKeywords) {
                const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                const matches = result.match(regex);
                if (matches) {
                    const placeholder = `[TERM_${++this.counter}]`;
                    this.reversalMap.set(placeholder, keyword);
                    result = result.replace(regex, placeholder);
                    count += matches.length;
                }
            }
        }

        return { code: result, count };
    }

    _maskDestinations(code) {
        let result = code;
        let count = 0;

        for (const pattern of this.sapSensitivePatterns) {
            result = result.replace(pattern, (match) => {
                const placeholder = `[SAP_DEST_${++this.counter}]`;
                this.reversalMap.set(placeholder, match);
                count++;
                return placeholder;
            });
        }

        return { code: result, count };
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Phase 4 - STRICT obfuscation
    // ═══════════════════════════════════════════════════════════════

    _obfuscateCompanyTerms(code, terms) {
        let result = code;
        let count = 0;

        for (const term of terms) {
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escaped, 'gi');
            const matches = result.match(regex);
            if (matches) {
                const placeholder = `[COMPANY_TERM_${++this.counter}]`;
                this.reversalMap.set(placeholder, term);
                result = result.replace(regex, placeholder);
                count += matches.length;
            }
        }

        return { code: result, count };
    }

    _obfuscateCustomTables(code) {
        let result = code;
        let count = 0;

        // Find custom table references (Z* / Y* tables, but not standard SAP tables)
        // Pattern: FROM ZTABLE, INTO ZTABLE, UPDATE ZTABLE, etc.
        result = result.replace(
            /\b([ZY][A-Z0-9_]{2,29})\b/g,
            (match, tableName) => {
                // Keep ABAP keywords that start with Z/Y (rare but possible)
                if (['ZERO'].includes(tableName)) return match;

                // Generate deterministic hash-based replacement
                // (same table name always gets same placeholder for readability)
                if (!this._tableMap) this._tableMap = new Map();

                if (!this._tableMap.has(tableName)) {
                    const hash = crypto.createHash('md5')
                        .update(tableName)
                        .digest('hex')
                        .substring(0, 6)
                        .toUpperCase();
                    const placeholder = `ZCUST_${hash}`;
                    this._tableMap.set(tableName, placeholder);
                    this.reversalMap.set(placeholder, tableName);
                    count++;
                }

                return this._tableMap.get(tableName);
            }
        );

        return { code: result, count };
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Phase 5 - MAXIMUM obfuscation
    // ═══════════════════════════════════════════════════════════════

    _obfuscateObjectNames(code) {
        let result = code;
        let count = 0;

        // Obfuscate function module names, class names in calls
        const patterns = [
            /CALL\s+FUNCTION\s+(['"])([ZY][A-Z0-9_]+)\1/gi,
            /CALL\s+METHOD\s+([ZY][A-Z0-9_]+)=>/gi,
            /CREATE\s+OBJECT\s+[a-z_]+\s+TYPE\s+([ZY][A-Z0-9_]+)/gi,
        ];

        for (const pattern of patterns) {
            result = result.replace(pattern, (match, ...groups) => {
                count++;
                return match; // Keep structure but names already handled by _obfuscateCustomTables
            });
        }

        return { code: result, count };
    }

    _obfuscateVariables(code) {
        // Intentionally conservative - only obfuscate clearly named business variables
        let result = code;
        let count = 0;

        // Obfuscate variables with business-meaningful names in DATA declarations
        // e.g., lv_customer_revenue -> lv_var_001
        result = result.replace(
            /\b(l[vtsrc]_)([a-z][a-z0-9_]{8,})\b/gi,
            (match, prefix, varName) => {
                const placeholder = `${prefix}var_${++this.counter}`;
                this.reversalMap.set(placeholder, `${prefix}${varName}`);
                count++;
                return placeholder;
            }
        );

        return { code: result, count };
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Utilities
    // ═══════════════════════════════════════════════════════════════

    _addAnonymizationHeader(code, count) {
        return `* ══════════════════════════════════════════════════════════════
* CODE ANONYMIZATION APPLIED
* Level: ${this.level} | Items Processed: ${count}
* Placeholders like [TYPE_N] replace sensitive data
* The AI analysis will reference these placeholders
* Original values are restored in the final document server-side
* ══════════════════════════════════════════════════════════════
${code}`;
    }
}

module.exports = CodeAnonymizer;

