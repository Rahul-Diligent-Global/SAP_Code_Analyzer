const cds = require('@sap/cds');
const LOG = cds.log('code-analyzer');

// Import helper modules
const SAPConnector = require('./lib/sap-connector');
const ClaudeAnalyzer = require('./lib/claude-analyzer');
const DocumentGenerator = require('./lib/document-generator');

module.exports = class CodeAnalyzerService extends cds.ApplicationService {

    async init() {
        // ═══════════════════════════════════════════════════════════
        // Entity Handlers
        // ═══════════════════════════════════════════════════════════

        this.before('READ', 'CustomObjects', async (req) => {
            // Check if cache is stale (older than 1 hour)
            const { CustomObjects } = this.entities;
            const count = await SELECT.one.from(CustomObjects).columns('count(*) as cnt');
            if (!count || count.cnt === 0) {
                LOG.info('Cache empty, triggering initial sync...');
                await this._syncObjects({ objectType: 'ALL', namespace: 'Z', maxRows: 1000 });
            }
        });

        // ═══════════════════════════════════════════════════════════
        // Action Handlers
        // ═══════════════════════════════════════════════════════════

        this.on('refreshObjects', async (req) => {
            return this._syncObjects(req.data.filter || {});
        });

        this.on('getSourceCode', async (req) => {
            return this._getSourceCode(req.data.objectName, req.data.category);
        });

        this.on('generateDocument', async (req) => {
            return this._generateDocument(req.data, req.user);
        });

        this.on('analyzeCode', async (req) => {
            return this._analyzeCode(
                req.data.objectName,
                req.data.category,
                req.data.analysisType
            );
        });

        this.on('analyzeOfflineCode', async (req) => {
            return this._analyzeOfflineCode(
                req.data.objectName,
                req.data.sourceCode,
                req.data.analysisType
            );
        });

        this.on('generateOfflineDocument', async (req) => {
            return this._generateOfflineDocument(req.data, req.user);
        });

        this.on('getUserInfo', async (req) => {
            const user = req.user;
            return {
                id: user?.id || 'anonymous',
                name: user?.id || 'anonymous',
                isAdmin: user?.is('Admin') || user?.is('admin') || false
            };
        });

        await super.init();
    }

    // ═══════════════════════════════════════════════════════════════
    // Private Methods
    // ═══════════════════════════════════════════════════════════════

    /**
     * Sync custom objects from SAP On-Premise to local cache
     */
    async _syncObjects(filter) {
        const { CustomObjects } = this.entities;

        try {
            LOG.info('Fetching custom objects from SAP On-Premise...');

            const sapConnector = new SAPConnector();
            const result = await sapConnector.getCustomObjects({
                ivObjectType: filter.objectType || 'ALL',
                ivNamespace: filter.namespace || 'Z',
                ivMaxRows: filter.maxRows || 500
            });

            // Clear existing cache and insert fresh data
            await DELETE.from(CustomObjects);

            const objects = result.etObjects.map(obj => ({
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

            if (objects.length > 0) {
                // Insert in batches of 100
                for (let i = 0; i < objects.length; i += 100) {
                    const batch = objects.slice(i, i + 100);
                    await INSERT.into(CustomObjects).entries(batch);
                }
            }

            LOG.info(`Synced ${objects.length} objects from SAP On-Premise`);
            return objects;

        } catch (error) {
            LOG.error('Failed to sync objects:', error.message);
            throw new Error(`Failed to fetch objects from SAP: ${error.message}`);
        }
    }

    /**
     * Get complete source code from SAP On-Premise
     */
    async _getSourceCode(objectName, category) {
        try {
            LOG.info(`Fetching source code for: ${objectName} (${category})`);

            const sapConnector = new SAPConnector();
            const result = await sapConnector.getSourceCode(objectName, category);

            return {
                objectName: objectName,
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

        } catch (error) {
            LOG.error(`Failed to fetch source code for ${objectName}:`, error.message);
            throw new Error(`Failed to fetch source code: ${error.message}`);
        }
    }

    /**
     * Generate BRD/Functional document using Claude AI
     */
    async _generateDocument(data, user) {
        const { DocumentGenerationLog, DocumentTemplates } = this.entities;
        const startTime = Date.now();
        let logEntry;

        try {
            // 1. Fetch source code
            LOG.info(`Generating document for: ${data.objectName}`);
            const sourceResult = await this._getSourceCode(data.objectName, data.category);

            // 2. Get template if specified
            let template = null;
            if (data.options?.templateId) {
                template = await SELECT.one.from(DocumentTemplates)
                    .where({ ID: data.options.templateId });
            }

            // 3. Build full source code string
            const fullCode = this._buildCodeString(sourceResult);

            // 4. Send to Claude API for analysis
            LOG.info(`Sending code to AI for ${data.options?.analysisType || 'BRD'} analysis...`);
            const claudeAnalyzer = new ClaudeAnalyzer();
            const analysis = await claudeAnalyzer.generateBRD({
                objectName: data.objectName,
                objectType: sourceResult.objectType,
                title: sourceResult.title,
                sourceCode: fullCode,
                includes: sourceResult.includes,
                analysisType: data.options?.analysisType || 'BRD',
                detailLevel: data.options?.detailLevel || 'DETAILED',
                customPrompt: data.options?.customPrompt,
                templatePrompt: template?.promptTemplate,
                templateSections: template?.sections,
                referenceContent: template?.referenceContent
            });

            // 5. Generate document (PDF or DOCX)
            LOG.info(`Generating ${data.options?.documentType || 'DOCX'} document...`);
            const docGenerator = new DocumentGenerator();
            const docType = data.options?.documentType || 'DOCX';

            let docResult;
            if (docType === 'PDF') {
                docResult = await docGenerator.generatePDF(analysis, sourceResult, data.options);
            } else {
                docResult = await docGenerator.generateDOCX(analysis, sourceResult, data.options);
            }

            // 6. Log the generation
            const genTime = Date.now() - startTime;
            logEntry = {
                objectName: data.objectName,
                objectType: data.category,
                documentType: docType,
                templateUsed: template?.templateName || 'DEFAULT',
                claudeModel: analysis.modelUsed,
                tokensUsed: analysis.tokensUsed,
                generationTime: genTime,
                status: 'SUCCESS',
                generatedBy: user?.id || 'anonymous',
                generatedAt: new Date().toISOString()
            };
            await INSERT.into(DocumentGenerationLog).entries(logEntry);

            return {
                success: true,
                fileName: docResult.fileName,
                fileType: docType,
                fileContent: docResult.base64Content,
                fileSize: docResult.fileSize,
                generationId: logEntry.ID,
                message: `Document generated successfully in ${genTime}ms`
            };

        } catch (error) {
            LOG.error('Document generation failed:', error.message);

            // Log the failure
            logEntry = {
                objectName: data.objectName,
                objectType: data.category,
                documentType: data.options?.documentType || 'DOCX',
                status: 'FAILED',
                errorMessage: error.message?.substring(0, 500),
                generationTime: Date.now() - startTime,
                generatedBy: user?.id || 'anonymous',
                generatedAt: new Date().toISOString()
            };
            await INSERT.into(DocumentGenerationLog).entries(logEntry);

            return {
                success: false,
                message: `Document generation failed: ${error.message}`
            };
        }
    }

    /**
     * Analyze code with Claude without generating document
     * Returns structured BRD-like analysis as JSON string
     */
    async _analyzeCode(objectName, category, analysisType) {
        try {
            const sourceResult = await this._getSourceCode(objectName, category);
            const fullCode = this._buildCodeString(sourceResult);

            const claudeAnalyzer = new ClaudeAnalyzer();
            const analysis = await claudeAnalyzer.analyzeCode({
                objectName,
                objectType: sourceResult.objectType,
                title: sourceResult.title,
                sourceCode: fullCode,
                analysisType: analysisType || 'BRD'
            });

            // Return full structured analysis as JSON string
            return JSON.stringify(analysis);

        } catch (error) {
            LOG.error(`Code analysis failed for ${objectName}:`, error.message);
            throw new Error(`Code analysis failed: ${error.message}`);
        }
    }

    /**
     * Analyze uploaded code offline (no SAP connection needed)
     */
    async _analyzeOfflineCode(objectName, sourceCode, analysisType) {
        try {
            LOG.info(`Offline analysis for: ${objectName} (${sourceCode.length} chars)`);

            const claudeAnalyzer = new ClaudeAnalyzer();
            const analysis = await claudeAnalyzer.analyzeCode({
                objectName: objectName || 'UPLOADED_CODE',
                objectType: 'PROG',
                title: objectName || 'Uploaded ABAP Code',
                sourceCode: sourceCode,
                analysisType: analysisType || 'BRD'
            });

            return JSON.stringify(analysis);

        } catch (error) {
            LOG.error(`Offline code analysis failed: ${error.message}`);
            throw new Error(`Offline analysis failed: ${error.message}`);
        }
    }

    /**
     * Generate document from uploaded code (offline, no SAP connection)
     */
    async _generateOfflineDocument(data, user) {
        const { DocumentGenerationLog, DocumentTemplates } = this.entities;
        const startTime = Date.now();
        let logEntry;

        try {
            LOG.info(`Generating offline document for: ${data.objectName}`);

            // Get template if specified
            let template = null;
            if (data.options?.templateId) {
                template = await SELECT.one.from(DocumentTemplates)
                    .where({ ID: data.options.templateId });
            }

            // Send to AI for analysis
            LOG.info(`Sending uploaded code to AI for ${data.options?.analysisType || 'BRD'} analysis...`);
            const claudeAnalyzer = new ClaudeAnalyzer();
            const analysis = await claudeAnalyzer.generateBRD({
                objectName: data.objectName || 'UPLOADED_CODE',
                objectType: 'PROG',
                title: data.objectName || 'Uploaded ABAP Code',
                sourceCode: data.sourceCode,
                includes: [],
                analysisType: data.options?.analysisType || 'BRD',
                detailLevel: data.options?.detailLevel || 'DETAILED',
                customPrompt: data.options?.customPrompt,
                templatePrompt: template?.promptTemplate,
                templateSections: template?.sections,
                referenceContent: template?.referenceContent
            });

            // Generate document (PDF or DOCX)
            const docType = data.options?.documentType || 'DOCX';
            LOG.info(`Generating ${docType} document from offline code...`);
            const docGenerator = new DocumentGenerator();

            const sourceResult = {
                objectName: data.objectName || 'UPLOADED_CODE',
                objectType: 'PROG',
                title: data.objectName || 'Uploaded ABAP Code',
                totalLines: data.sourceCode.split('\n').length,
                sourceCode: data.sourceCode.split('\n').map((line, i) => ({
                    lineNumber: i + 1,
                    sourceLine: line,
                    includeName: 'MAIN',
                    section: 'MAIN'
                })),
                includes: []
            };

            let docResult;
            if (docType === 'PDF') {
                docResult = await docGenerator.generatePDF(analysis, sourceResult, data.options);
            } else {
                docResult = await docGenerator.generateDOCX(analysis, sourceResult, data.options);
            }

            // Log the generation
            const genTime = Date.now() - startTime;
            logEntry = {
                objectName: data.objectName || 'UPLOADED_CODE',
                objectType: 'OFFLINE',
                documentType: docType,
                templateUsed: template?.templateName || 'DEFAULT',
                claudeModel: analysis.modelUsed,
                tokensUsed: analysis.tokensUsed,
                generationTime: genTime,
                status: 'SUCCESS',
                generatedBy: user?.id || 'anonymous',
                generatedAt: new Date().toISOString()
            };
            await INSERT.into(DocumentGenerationLog).entries(logEntry);

            return {
                success: true,
                fileName: docResult.fileName,
                fileType: docType,
                fileContent: docResult.base64Content,
                fileSize: docResult.fileSize,
                generationId: logEntry.ID,
                message: `Document generated successfully in ${genTime}ms`
            };

        } catch (error) {
            LOG.error('Offline document generation failed:', error.message);

            logEntry = {
                objectName: data.objectName || 'UPLOADED_CODE',
                objectType: 'OFFLINE',
                documentType: data.options?.documentType || 'DOCX',
                status: 'FAILED',
                errorMessage: error.message?.substring(0, 500),
                generationTime: Date.now() - startTime,
                generatedBy: user?.id || 'anonymous',
                generatedAt: new Date().toISOString()
            };
            await INSERT.into(DocumentGenerationLog).entries(logEntry);

            return {
                success: false,
                message: `Document generation failed: ${error.message}`
            };
        }
    }

    /**
     * Build a single code string from source result
     */
    _buildCodeString(sourceResult) {
        const sections = {};

        // Group by section
        for (const line of sourceResult.sourceCode) {
            if (!sections[line.section]) {
                sections[line.section] = [];
            }
            sections[line.section].push(line.sourceLine);
        }

        // Build formatted string
        let fullCode = '';
        for (const [section, lines] of Object.entries(sections)) {
            fullCode += `\n${'='.repeat(70)}\n`;
            fullCode += `* SECTION: ${section}\n`;
            fullCode += `${'='.repeat(70)}\n`;
            fullCode += lines.join('\n');
            fullCode += '\n';
        }

        return fullCode;
    }
};

