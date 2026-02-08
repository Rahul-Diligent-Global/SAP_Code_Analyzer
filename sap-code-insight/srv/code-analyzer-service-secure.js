/**
 * ═══════════════════════════════════════════════════════════════════════
 * CODE ANALYZER SERVICE (SECURITY-ENHANCED, MULTI-TENANT)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Flow with security:
 * 1. Verify tenant consent for AI processing
 * 2. Check API call quota for tenant
 * 3. Fetch code from tenant's SAP system (tenant-specific destination)
 * 4. ANONYMIZE code before sending to Claude
 * 5. Send anonymized code to Claude API over TLS
 * 6. Log audit trail (NO code in logs)
 * 7. DE-ANONYMIZE Claude response server-side
 * 8. Generate document with restored original names
 * 9. Purge all intermediate data
 */

const cds = require('@sap/cds');
const LOG = cds.log('code-analyzer');

const SAPConnector = require('./lib/sap-connector');
const ClaudeAnalyzer = require('./lib/claude-analyzer');
const DocumentGenerator = require('./lib/document-generator');
const CodeAnonymizer = require('./lib/security/code-anonymizer');
const EncryptionService = require('./lib/security/encryption-service');
const SecurityAuditLogger = require('./lib/security/audit-logger');
const SecurityMiddleware = require('./lib/security/security-middleware');
const DataRetentionService = require('./lib/security/data-retention');

module.exports = class CodeAnalyzerService extends cds.ApplicationService {

    async init() {
        // Initialize encryption service
        this._encService = new EncryptionService();
        await this._encService.initialize();

        // ─── BEFORE handlers: security checks ───

        this.before('*', async (req) => {
            // Get tenant ID from JWT token
            req.tenantId = req.user?.tenant || req.headers?.['x-tenant-id'] || 'default';

            // Inject tenant filter for data isolation
            if (req.query?.SELECT) {
                req.query.where({ tenantId: req.tenantId });
            }
        });

        // ─── READ handlers ───

        this.before('READ', 'CustomObjects', async (req) => {
            const { CustomObjects } = this.entities;
            const count = await SELECT.one.from(CustomObjects)
                .columns('count(*) as cnt')
                .where({ tenantId: req.tenantId });

            if (!count || count.cnt === 0) {
                LOG.info(`Cache empty for tenant ${req.tenantId}, triggering sync...`);
                await this._syncObjects(
                    { objectType: 'ALL', namespace: 'Z', maxRows: 1000 },
                    req.tenantId, req.user
                );
            }
        });

        // ─── ACTION handlers ───

        this.on('refreshObjects', async (req) => {
            return this._syncObjects(req.data.filter || {}, req.tenantId, req.user);
        });

        this.on('getSourceCode', async (req) => {
            // Validate input
            const objectName = SecurityMiddleware.validateObjectName(req.data.objectName);
            const category = req.data.category;

            // Audit log: code access
            const auditLogger = new SecurityAuditLogger(req.tenantId);
            await auditLogger.logCodeAccess({
                userId: req.user?.id,
                action: 'FETCH',
                objectName,
                objectType: category
            });

            return this._getSourceCode(objectName, category, req.tenantId);
        });

        this.on('generateDocument', async (req) => {
            return this._generateDocumentSecure(req.data, req.tenantId, req.user);
        });

        this.on('analyzeCode', async (req) => {
            return this._analyzeCodeSecure(req.data, req.tenantId, req.user);
        });

        await super.init();
    }

    // ═══════════════════════════════════════════════════════════════
    // SECURE: Document Generation with Full Security Pipeline
    // ═══════════════════════════════════════════════════════════════

    async _generateDocumentSecure(data, tenantId, user) {
        const { DocumentGenerationLog, TenantConfig } = this.entities;
        const startTime = Date.now();
        const auditLogger = new SecurityAuditLogger(tenantId);
        const requestId = crypto.randomUUID();

        try {
            // ── STEP 1: Verify AI processing consent ──
            LOG.info(`[${requestId}] Step 1: Verifying consent...`);
            await SecurityMiddleware.verifyConsent(tenantId, user?.id);

            // ── STEP 2: Check API quota ──
            LOG.info(`[${requestId}] Step 2: Checking API quota...`);
            const tenantConfig = await SELECT.one.from(TenantConfig).where({ tenantId });
            if (!tenantConfig) throw new Error('Tenant not configured');

            if (tenantConfig.currentAPICallCount >= tenantConfig.maxAPICallsPerMonth) {
                throw new Error(
                    `Monthly API call limit reached (${tenantConfig.maxAPICallsPerMonth}). ` +
                    `Resets on ${tenantConfig.apiCallResetDate}. Contact your admin to upgrade.`
                );
            }

            // ── STEP 3: Fetch source code ──
            LOG.info(`[${requestId}] Step 3: Fetching source code...`);
            const objectName = SecurityMiddleware.validateObjectName(data.objectName);
            const sourceResult = await this._getSourceCode(objectName, data.category, tenantId);
            const fullCode = this._buildCodeString(sourceResult);

            // ── STEP 4: ANONYMIZE CODE ──
            LOG.info(`[${requestId}] Step 4: Anonymizing code (level: ${tenantConfig.anonymizationLevel})...`);
            const anonymizer = new CodeAnonymizer(tenantConfig.anonymizationLevel);

            const anonymizationResult = anonymizer.anonymize(fullCode, {
                companyTerms: tenantConfig.companyTerms ? JSON.parse(tenantConfig.companyTerms) : [],
                sensitiveKeywords: tenantConfig.sensitiveKeywords ? JSON.parse(tenantConfig.sensitiveKeywords) : []
            });

            // Audit: anonymization event
            await auditLogger.logAnonymization({
                userId: user?.id,
                objectName,
                level: tenantConfig.anonymizationLevel,
                itemsStripped: anonymizationResult.strippedItemsCount,
                credentialsFound: anonymizationResult.warnings.filter(w => w.includes('credential')).length,
                piiFound: anonymizationResult.warnings.filter(w => w.includes('PII')).length,
                warnings: anonymizationResult.warnings
            });

            // ── STEP 5: Send ANONYMIZED code to Claude ──
            LOG.info(`[${requestId}] Step 5: Sending anonymized code to Claude API...`);
            const claudeAnalyzer = new ClaudeAnalyzer();

            // Use tenant's own API key if Enterprise plan
            if (tenantConfig.claudeApiKeyOverride && tenantConfig.plan === 'ENTERPRISE') {
                const decryptedKey = this._encService.decrypt(
                    JSON.parse(tenantConfig.claudeApiKeyOverride), tenantId
                );
                claudeAnalyzer.apiKey = decryptedKey;
            }

            const analysis = await claudeAnalyzer.generateBRD({
                objectName: objectName, // Keep real name for document title
                objectType: sourceResult.objectType,
                title: sourceResult.title,
                sourceCode: anonymizationResult.anonymizedCode, // ← ANONYMIZED!
                includes: sourceResult.includes,
                detailLevel: data.options?.detailLevel || 'DETAILED',
                customPrompt: data.options?.customPrompt
            });

            // Audit: Claude API call
            await auditLogger.logClaudeAPICall({
                userId: user?.id,
                objectName,
                model: analysis.modelUsed,
                inputTokens: analysis.inputTokens,
                outputTokens: analysis.outputTokens,
                anonymizationLevel: tenantConfig.anonymizationLevel,
                itemsAnonymized: anonymizationResult.strippedItemsCount,
                codePayload: anonymizationResult.anonymizedCode, // Hashed in logger, not stored
                durationMs: Date.now() - startTime,
                success: true
            });

            // ── STEP 6: DE-ANONYMIZE the analysis (server-side only) ──
            LOG.info(`[${requestId}] Step 6: De-anonymizing analysis for document...`);
            const deAnonymizedAnalysis = this._deAnonymizeAnalysis(
                analysis, anonymizationResult.reversalMap, anonymizer
            );

            // ── STEP 7: Generate document ──
            LOG.info(`[${requestId}] Step 7: Generating ${data.options?.documentType || 'DOCX'}...`);
            const docGenerator = new DocumentGenerator();
            const docType = data.options?.documentType || 'DOCX';

            let docResult;
            if (docType === 'PDF') {
                docResult = await docGenerator.generatePDF(deAnonymizedAnalysis, sourceResult, data.options);
            } else {
                docResult = await docGenerator.generateDOCX(deAnonymizedAnalysis, sourceResult, data.options);
            }

            // Audit: document generation
            const docHash = require('crypto').createHash('sha256')
                .update(docResult.base64Content.substring(0, 1000))
                .digest('hex').substring(0, 32);

            await auditLogger.logDocumentGeneration({
                userId: user?.id,
                objectName,
                documentType: docType,
                templateUsed: 'DEFAULT',
                detailLevel: data.options?.detailLevel,
                includesSourceCode: data.options?.includeCode !== false,
                fileSize: docResult.fileSize,
                documentHash: docHash
            });

            // ── STEP 8: Increment API call counter ──
            await UPDATE(TenantConfig)
                .set({ currentAPICallCount: { '+=': 1 }, lastActiveAt: new Date().toISOString() })
                .where({ tenantId });

            // ── STEP 9: Log and return ──
            const genTime = Date.now() - startTime;

            await INSERT.into(DocumentGenerationLog).entries({
                tenantId,
                objectName,
                objectType: data.category,
                documentType: docType,
                claudeModel: analysis.modelUsed,
                tokensUsed: analysis.tokensUsed,
                generationTime: genTime,
                status: 'SUCCESS',
                generatedBy: user?.id || 'anonymous',
                generatedAt: new Date().toISOString()
            });

            LOG.info(`[${requestId}] Document generated in ${genTime}ms. ` +
                     `Items anonymized: ${anonymizationResult.strippedItemsCount}. ` +
                     `Tokens: ${analysis.tokensUsed}`);

            return {
                success: true,
                fileName: docResult.fileName,
                fileType: docType,
                fileContent: docResult.base64Content,
                fileSize: docResult.fileSize,
                generationId: requestId,
                message: `Document generated in ${genTime}ms. ` +
                         `${anonymizationResult.strippedItemsCount} sensitive items were anonymized before AI processing.`
            };

        } catch (error) {
            LOG.error(`[${requestId}] Generation failed:`, error.message);

            await auditLogger.logClaudeAPICall({
                userId: user?.id,
                objectName: data.objectName,
                anonymizationLevel: 'N/A',
                success: false,
                errorCode: error.message?.substring(0, 100),
                durationMs: Date.now() - startTime
            });

            return {
                success: false,
                message: `Generation failed: ${error.message}`
            };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SECURE: Code Analysis with anonymization
    // ═══════════════════════════════════════════════════════════════

    async _analyzeCodeSecure(data, tenantId, user) {
        // Same security pipeline as generateDocument
        await SecurityMiddleware.verifyConsent(tenantId, user?.id);

        const { TenantConfig } = this.entities;
        const tenantConfig = await SELECT.one.from(TenantConfig).where({ tenantId });

        const sourceResult = await this._getSourceCode(data.objectName, data.category, tenantId);
        const fullCode = this._buildCodeString(sourceResult);

        // Anonymize
        const anonymizer = new CodeAnonymizer(tenantConfig?.anonymizationLevel || 'STANDARD');
        const anonResult = anonymizer.anonymize(fullCode);

        // Analyze anonymized code
        const claudeAnalyzer = new ClaudeAnalyzer();
        const analysis = await claudeAnalyzer.analyzeCode({
            objectName: data.objectName,
            objectType: sourceResult.objectType,
            title: sourceResult.title,
            sourceCode: anonResult.anonymizedCode,
            analysisType: data.analysisType || 'BRD'
        });

        // De-anonymize response
        const deAnon = anonymizer.deAnonymize(
            JSON.stringify(analysis), anonResult.reversalMap
        );

        return deAnon;
    }

    // ═══════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════

    _deAnonymizeAnalysis(analysis, reversalMap, anonymizer) {
        // Deep-walk the analysis object and replace all placeholders
        const deAnon = (obj) => {
            if (typeof obj === 'string') {
                return anonymizer.deAnonymize(obj, reversalMap);
            }
            if (Array.isArray(obj)) {
                return obj.map(item => deAnon(item));
            }
            if (obj && typeof obj === 'object') {
                const result = {};
                for (const [key, value] of Object.entries(obj)) {
                    result[key] = deAnon(value);
                }
                return result;
            }
            return obj;
        };
        return deAnon(analysis);
    }

    async _syncObjects(filter, tenantId, user) {
        const { CustomObjects, TenantConfig } = this.entities;

        const tenantConfig = await SELECT.one.from(TenantConfig).where({ tenantId });
        if (!tenantConfig?.destinationName) {
            throw new Error('SAP system not configured. Please complete onboarding setup.');
        }

        const sapConnector = new SAPConnector(tenantId);

        const result = await sapConnector.getCustomObjects({
            ivObjectType: filter.objectType || 'ALL',
            ivNamespace: filter.namespace || 'Z',
            ivMaxRows: filter.maxRows || 500
        });

        await DELETE.from(CustomObjects).where({ tenantId });

        const objects = result.etObjects.map(obj => ({
            tenantId,
            objectName: obj.objectName,
            objectType: obj.objectType,
            objectTypeText: obj.objectTypeText,
            category: obj.category,
            subType: obj.subType,
            package: obj.package,
            createdByAbap: obj.createdBy,
            createdOnAbap: obj.createdOn,
            lastSynced: new Date().toISOString()
        }));

        for (let i = 0; i < objects.length; i += 100) {
            await INSERT.into(CustomObjects).entries(objects.slice(i, i + 100));
        }

        return objects;
    }

    async _getSourceCode(objectName, category, tenantId) {
        const { TenantConfig } = this.entities;
        const tenantConfig = await SELECT.one.from(TenantConfig).where({ tenantId });

        const sapConnector = new SAPConnector(tenantId);

        const result = await sapConnector.getSourceCode(objectName, category);

        return {
            objectName,
            title: result.evTitle,
            objectType: result.evObjectType,
            package: result.evPackage,
            author: result.evAuthor,
            createdOn: result.evCreatedOn,
            totalLines: result.etSourceCode.length,
            sourceCode: result.etSourceCode.map(line => ({
                lineNumber: line.lineNumber,
                sourceLine: line.sourceLine,
                includeName: line.includeName,
                section: line.section
            })),
            includes: result.etIncludes.map(inc => ({
                includeName: inc.includeName,
                includeType: inc.includeType,
                parentObject: inc.parentObject,
                lineCount: inc.lineCount
            }))
        };
    }

    _buildCodeString(sourceResult) {
        const sections = {};
        for (const line of sourceResult.sourceCode) {
            if (!sections[line.section]) sections[line.section] = [];
            sections[line.section].push(line.sourceLine);
        }
        let fullCode = '';
        for (const [section, lines] of Object.entries(sections)) {
            fullCode += `\n${'='.repeat(70)}\n* SECTION: ${section}\n${'='.repeat(70)}\n`;
            fullCode += lines.join('\n') + '\n';
        }
        return fullCode;
    }
};

