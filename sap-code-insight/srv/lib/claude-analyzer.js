/**
 * Claude AI Analyzer
 * Sends ABAP source code to Claude API (Anthropic)
 * Returns structured analysis for BRD/Functional Specification generation
 *
 * Prerequisites:
 * 1. Anthropic API key stored in BTP Credential Store or environment variable
 * 2. BTP Destination "CLAUDE_API" configured (or direct API key)
 */

const cds = require('@sap/cds');
const LOG = cds.log('claude-analyzer');

class ClaudeAnalyzer {

    constructor() {
        this.apiKey = process.env.ANTHROPIC_API_KEY;
        this.apiUrl = process.env.CLAUDE_API_URL || 'https://api.anthropic.com/v1/messages';
        this.model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';
        this.maxTokens = parseInt(process.env.CLAUDE_MAX_TOKENS || '8192');
    }

    /**
     * Check if running in mock mode (no API key configured)
     */
    get isMockMode() {
        return !this.apiKey && (
            process.env.MOCK_SAP_DATA === 'true' ||
            process.env.CDS_ENV === 'development' ||
            !process.env.ANTHROPIC_API_KEY
        );
    }

    /**
     * Get display label for analysis type
     */
    _getAnalysisTypeLabel(analysisType) {
        const labels = {
            'BRD': 'Business Requirements Document',
            'FUNC_SPEC': 'Functional Specification',
            'TECH_SPEC': 'Technical Specification',
            'CODE_REVIEW': 'Code Review Report'
        };
        return labels[analysisType] || labels['BRD'];
    }

    /**
     * Generate document analysis from ABAP code
     * Supports BRD, Functional Spec, Technical Spec, Code Review
     */
    async generateBRD(params) {
        const {
            objectName, objectType, title, sourceCode,
            includes, detailLevel, customPrompt,
            templatePrompt, templateSections, analysisType,
            referenceContent
        } = params;

        if (this.isMockMode) {
            LOG.info('Mock mode: returning sample analysis');
            return this._getMockBRDAnalysis(objectName, objectType, title, sourceCode, analysisType);
        }

        const effectiveType = analysisType || 'BRD';

        // Build the system prompt for the chosen analysis type
        const systemPrompt = this._buildSystemPrompt(effectiveType, detailLevel, templateSections, referenceContent);

        // Build the user message with code
        const userMessage = this._buildUserMessage({
            objectName, objectType, title, sourceCode,
            includes, customPrompt, templatePrompt, analysisType: effectiveType
        });

        LOG.info(`Sending ${sourceCode.length} chars to Claude API (model: ${this.model})`);

        const response = await this._callClaudeAPI(systemPrompt, userMessage);

        // Parse the structured response
        const analysis = this._parseBRDResponse(response.content);

        return {
            ...analysis,
            modelUsed: this.model,
            tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens || 0,
            inputTokens: response.usage?.input_tokens || 0,
            outputTokens: response.usage?.output_tokens || 0
        };
    }

    /**
     * General code analysis (without document generation)
     * Returns structured analysis
     */
    async analyzeCode(params) {
        const { objectName, objectType, title, sourceCode, analysisType } = params;

        if (this.isMockMode) {
            LOG.info('Mock mode: returning sample code analysis');
            return this._getMockBRDAnalysis(objectName, objectType, title, sourceCode, analysisType);
        }

        const effectiveType = analysisType || 'BRD';
        const typeLabel = this._getAnalysisTypeLabel(effectiveType);
        const systemPrompt = this._buildSystemPrompt(effectiveType, 'DETAILED', null, null);

        const userMessage = `Analyze this SAP ABAP object and generate a structured ${typeLabel}:

Object Name: ${objectName}
Object Type: ${objectType}
Title: ${title}
Analysis Type: ${effectiveType}

Source Code:
\`\`\`abap
${sourceCode}
\`\`\`

Return ONLY a valid JSON object following the structure defined in the system prompt.
Do not include any text before or after the JSON.`;

        const response = await this._callClaudeAPI(systemPrompt, userMessage);

        // Parse into structured format
        const analysis = this._parseBRDResponse(response.content);

        return {
            ...analysis,
            modelUsed: this.model,
            tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens || 0
        };
    }

    /**
     * Build system prompt based on analysis type
     */
    _buildSystemPrompt(analysisType, detailLevel, templateSections, referenceContent) {
        const sections = templateSections ? JSON.parse(templateSections) : this._getDefaultSections();
        const typeLabel = this._getAnalysisTypeLabel(analysisType);

        let roleDescription, taskDescription, focusInstructions;

        switch (analysisType) {
            case 'FUNC_SPEC':
                roleDescription = 'You are a Senior SAP Technical Consultant with 20+ years of experience in writing Functional Specifications.';
                taskDescription = `Your task is to analyze SAP ABAP source code and generate a comprehensive Functional Specification document.`;
                focusInstructions = `
FUNCTIONAL SPECIFICATION FOCUS:
- Document the complete functional design including process flows
- Map every technical component to its functional purpose
- Detail all data transformations and business logic
- Describe the user interface / selection screen design
- Document all integration interfaces (BAPIs, RFCs, IDocs, APIs)
- Include detailed input/output data specifications
- Describe how the solution fits into the overall SAP landscape`;
                break;

            case 'TECH_SPEC':
                roleDescription = 'You are a Senior SAP Technical Architect with 20+ years of experience in writing Technical Specifications.';
                taskDescription = `Your task is to analyze SAP ABAP source code and generate a comprehensive Technical Specification document.`;
                focusInstructions = `
TECHNICAL SPECIFICATION FOCUS:
- Document the complete technical architecture and design patterns
- Detail all classes, methods, function modules, forms
- Describe the data model including all database tables and structures
- Document the program flow, call hierarchy, and execution sequence
- Include performance considerations and optimization notes
- Detail all error handling mechanisms and exception classes
- Document authorization checks and security implementation
- Include database access patterns (SELECT, UPDATE, INSERT, DELETE)
- Note any custom developments vs standard SAP usage`;
                break;

            case 'CODE_REVIEW':
                roleDescription = 'You are a Senior SAP Code Quality Expert with 20+ years of ABAP development and code review experience.';
                taskDescription = `Your task is to analyze SAP ABAP source code and generate a comprehensive Code Review Report.`;
                focusInstructions = `
CODE REVIEW FOCUS:
- Evaluate code quality, readability, and maintainability
- Identify code smells, anti-patterns, and areas for refactoring
- Check for potential performance issues (N+1 queries, missing indexes, large internal tables)
- Review error handling completeness and quality
- Check authorization implementation
- Evaluate adherence to SAP ABAP best practices and naming conventions
- Identify potential security vulnerabilities
- Review hardcoded values and magic numbers
- Evaluate test coverage and testability
- Provide specific improvement recommendations with code examples`;
                break;

            default: // BRD
                roleDescription = 'You are a Senior SAP Functional Consultant and Business Analyst with 20+ years of experience.';
                taskDescription = `Your task is to analyze SAP ABAP source code and generate a comprehensive Business Requirements Document (BRD).`;
                focusInstructions = `
BRD FOCUS:
- Identify the business process the code implements
- Map technical logic to business rules
- Identify all input parameters, selection screens, and their business purpose
- Document all output formats (ALV, reports, files, IDocs, etc.)
- Note any authorization checks and their business context
- Document error handling and business validations`;
                break;
        }

        // Build reference template priority instructions
        let referenceInstructions = '';
        if (referenceContent) {
            referenceInstructions = `

*** HIGHEST PRIORITY - REFERENCE TEMPLATE ***
The user has provided a reference document below. You MUST:
1. ADOPT the reference document's structure, section organization, and flow
2. MATCH the reference document's tone, language style, and level of formality
3. INCLUDE similar metadata sections (e.g., client info table, version history, document control)
4. FOLLOW the same section naming conventions and ordering as the reference
5. POPULATE the "documentMetadata" field with key-value pairs matching the reference's cover page metadata
6. POPULATE the "versionHistory" array matching the reference's document revision table format

The reference document structure takes PRIORITY over the default JSON schema below.
Fill in the "documentMetadata" and "versionHistory" fields based on what you see in the reference document.
Also add any custom sections from the reference document into the "customSections" array.

---BEGIN REFERENCE DOCUMENT---
${referenceContent}
---END REFERENCE DOCUMENT---
*** END REFERENCE TEMPLATE ***
`;
        }

        let prompt = `${roleDescription}
${taskDescription}
${referenceInstructions}
DOCUMENT TYPE: ${typeLabel}

CRITICAL INSTRUCTIONS:
1. Analyze the ABAP code thoroughly - understand every SELECT statement, BAPI call, module, form, method
2. Determine all database tables used and their business meaning
3. Identify integration points (BAPIs, RFCs, IDocs, APIs)
${focusInstructions}

IMPORTANT: The document title (documentTitle field) MUST reflect the correct document type.
- If generating a ${typeLabel}, the title should include "${typeLabel}" (NOT "Business Requirements Document" unless this IS a BRD)

DETAIL LEVEL: ${detailLevel || 'DETAILED'}
- SUMMARY: High-level overview, 2-3 pages
- DETAILED: Full document with all sections, 5-10 pages
- COMPREHENSIVE: Complete specification with data mappings, 10+ pages

OUTPUT FORMAT: You MUST return a valid JSON object with the following structure:
${JSON.stringify(sections, null, 2)}

IMPORTANT:
- Every field must contain substantive content derived from the actual code analysis
- Use professional business language, not technical jargon
- Include specific field names, table names mapped to business terminology
- For each business rule, reference the corresponding code section
- All text values should be properly escaped for JSON
- The "documentMetadata" field is an array of key-value pairs for the cover page (e.g., Client Name, Project Name, Module, WRICEF Number, Version, Date, Type of Development, Complexity)
- The "versionHistory" array captures document revision tracking (date, version, description, preparedBy, approvedBy)
- The "customSections" array allows you to add any additional sections from the reference template that don't fit the standard schema`;

        return prompt;
    }

    /**
     * Build user message with code
     */
    _buildUserMessage(params) {
        const {
            objectName, objectType, title, sourceCode,
            includes, customPrompt, templatePrompt, analysisType
        } = params;

        const typeLabel = this._getAnalysisTypeLabel(analysisType || 'BRD');

        let message = `Please analyze the following SAP ABAP object and generate a complete ${typeLabel}.

═══════════════════════════════════════════════════════════════
OBJECT DETAILS
═══════════════════════════════════════════════════════════════
Object Name: ${objectName}
Object Type: ${objectType}
Title/Description: ${title || 'Not specified'}
Document Type Requested: ${typeLabel}
`;

        if (includes && includes.length > 0) {
            message += `\nIncludes/Components:\n`;
            for (const inc of includes) {
                message += `  - ${inc.includeName} (${inc.includeType}) - ${inc.lineCount} lines\n`;
            }
        }

        message += `\n═══════════════════════════════════════════════════════════════
COMPLETE SOURCE CODE
═══════════════════════════════════════════════════════════════
\`\`\`abap
${sourceCode}
\`\`\``;

        if (templatePrompt) {
            message += `\n\nADDITIONAL TEMPLATE INSTRUCTIONS:\n${templatePrompt}`;
        }

        if (customPrompt) {
            message += `\n\nCUSTOM INSTRUCTIONS FROM USER:\n${customPrompt}`;
        }

        message += `\n\nPlease return ONLY a valid JSON object following the structure defined in the system prompt.
Do not include any text before or after the JSON. Do not wrap in markdown code blocks.`;

        return message;
    }

    /**
     * Call Claude API
     */
    async _callClaudeAPI(systemPrompt, userMessage) {
        if (!this.apiKey) {
            throw new Error('ANTHROPIC_API_KEY not configured. Set it in environment variables or BTP Credential Store.');
        }

        const requestBody = {
            model: this.model,
            max_tokens: this.maxTokens,
            system: systemPrompt,
            messages: [
                {
                    role: 'user',
                    content: userMessage
                }
            ]
        };

        try {
            // Using native fetch (Node.js 18+) or node-fetch
            const response = await fetch(this.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorBody = await response.text();
                LOG.error(`Claude API error (${response.status}):`, errorBody);
                throw new Error(`Claude API returned ${response.status}: ${errorBody}`);
            }

            const result = await response.json();

            LOG.info(`Claude API response: ${result.usage?.input_tokens} input tokens, ${result.usage?.output_tokens} output tokens`);

            return result;

        } catch (error) {
            if (error.message.includes('Claude API returned')) {
                throw error;
            }
            LOG.error('Claude API call failed:', error.message);
            throw new Error(`Failed to call Claude API: ${error.message}`);
        }
    }

    /**
     * Parse BRD response from Claude
     */
    _parseBRDResponse(content) {
        const textContent = content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('');

        try {
            // Try direct JSON parse
            let parsed = JSON.parse(textContent.trim());
            return parsed;
        } catch (e) {
            // Try extracting JSON from markdown code block
            const jsonMatch = textContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (jsonMatch) {
                try {
                    return JSON.parse(jsonMatch[1].trim());
                } catch (e2) {
                    LOG.warn('Failed to parse extracted JSON, returning raw text');
                }
            }

            // Return as raw text with default structure
            LOG.warn('Claude response is not valid JSON, wrapping in default structure');
            return {
                documentTitle: 'Business Requirements Document',
                executiveSummary: textContent.substring(0, 500),
                rawAnalysis: textContent,
                sections: []
            };
        }
    }

    /**
     * Mock BRD analysis for local development without Claude API key
     */
    _getMockBRDAnalysis(objectName, objectType, title, sourceCode, analysisType) {
        const typeLabel = this._getAnalysisTypeLabel(analysisType || 'BRD');
        // Extract some info from source code for realistic mock
        const lines = (sourceCode || '').split('\n');
        const totalLines = lines.length;
        const tables = [];
        const forms = [];

        for (const line of lines) {
            const tableMatch = line.match(/FROM\s+(\w+)/i);
            if (tableMatch) tables.push(tableMatch[1]);
            const formMatch = line.match(/FORM\s+(\w+)/i);
            if (formMatch) forms.push(formMatch[1]);
        }

        return {
            documentTitle: `${typeLabel} - ${objectName}`,
            documentVersion: '1.0',
            preparedDate: new Date().toISOString().split('T')[0],

            documentMetadata: [
                { label: 'Client Name', value: 'Sample Client' },
                { label: 'Project Name', value: objectName },
                { label: 'Module', value: 'Custom Development' },
                { label: 'Version', value: '0.1' },
                { label: 'Date', value: new Date().toISOString().split('T')[0] },
                { label: 'Type of Development', value: 'Enhancement' },
                { label: 'Complexity', value: 'Medium' }
            ],

            versionHistory: [
                {
                    date: new Date().toISOString().split('T')[0],
                    version: '0.1',
                    description: 'Draft Version',
                    preparedBy: 'Diligent Code Insight',
                    approvedBy: ''
                }
            ],

            executiveSummary: `This document describes the business requirements for the SAP ABAP custom development "${objectName}" (${objectType || 'Program'}). ${title || 'This object'} implements custom business logic within the SAP system. The program contains ${totalLines} lines of code across ${forms.length || 1} functional sections. This analysis identifies the key business processes, data flows, and integration points.`,

            businessOverview: {
                purpose: `${objectName} is a custom ABAP development that ${title || 'implements specific business logic for the organization'}. It processes data from SAP database tables and produces output for business users.`,
                businessProcess: 'Custom Business Process - Data Processing & Reporting',
                module: 'Cross-Module (Custom Development)',
                stakeholders: ['Business Users', 'SAP Functional Team', 'IT Development Team'],
                businessBenefit: 'Automates manual business processes, improves data accuracy, and reduces processing time.'
            },

            functionalRequirements: [
                {
                    reqId: 'FR-001',
                    title: 'Data Selection & Retrieval',
                    description: `The program retrieves data from SAP database tables (${tables.join(', ') || 'various tables'}) based on user-specified selection criteria.`,
                    businessRule: 'Only records matching the selection criteria are processed',
                    priority: 'High',
                    codeReference: 'Main program / data retrieval section'
                },
                {
                    reqId: 'FR-002',
                    title: 'Data Processing Logic',
                    description: 'The retrieved data undergoes business-specific transformations and validations before output generation.',
                    businessRule: 'All data must pass validation checks before processing',
                    priority: 'High',
                    codeReference: forms.length > 0 ? `FORM ${forms[0]}` : 'Processing section'
                },
                {
                    reqId: 'FR-003',
                    title: 'Output Generation',
                    description: 'Processed results are displayed to the user via standard SAP output mechanisms (WRITE statements / ALV grid).',
                    businessRule: 'Output format must meet business reporting requirements',
                    priority: 'Medium',
                    codeReference: 'Output / display section'
                }
            ],

            dataSpecification: {
                inputData: [
                    {
                        fieldName: 'Selection Parameters',
                        sapTable: tables[0] || 'Various',
                        businessMeaning: 'User-specified filter criteria for data selection',
                        mandatory: true,
                        validationRules: 'Must be valid values in the respective SAP tables'
                    }
                ],
                outputData: [
                    {
                        fieldName: 'Processing Results',
                        description: 'Processed and validated business data',
                        format: 'List / ALV Report',
                        businessUse: 'Business reporting and decision making'
                    }
                ],
                tablesUsed: tables.map((t, i) => ({
                    tableName: t,
                    tableDescription: `SAP Table ${t}`,
                    usage: i === 0 ? 'Read' : 'Read',
                    businessEntity: `Business data entity from ${t}`
                }))
            },

            selectionScreen: {
                description: 'The program provides a selection screen for users to specify processing parameters and filter criteria.',
                parameters: [
                    {
                        paramName: 'Selection Range',
                        type: 'SELECT-OPTIONS / PARAMETERS',
                        description: 'Primary selection criteria for data filtering',
                        mandatory: false,
                        defaultValue: 'All records'
                    }
                ]
            },

            businessRules: [
                {
                    ruleId: 'BR-001',
                    ruleName: 'Data Validation',
                    description: 'All input data must be validated before processing to ensure data integrity.',
                    condition: 'When data is retrieved from database tables',
                    action: 'Validate fields and reject invalid records with appropriate error messages'
                },
                {
                    ruleId: 'BR-002',
                    ruleName: 'Processing Logic',
                    description: 'Business-specific transformation rules applied to the selected data.',
                    condition: 'After data passes validation',
                    action: 'Apply business transformations and generate output'
                }
            ],

            integrationPoints: [
                {
                    system: 'SAP Database',
                    type: 'Direct DB Access',
                    direction: 'Inbound',
                    description: `Reads from SAP tables: ${tables.join(', ') || 'database tables'}`,
                    dataExchanged: 'Business transaction data'
                }
            ],

            authorization: {
                description: 'Standard SAP authorization checks are applied based on the user\'s role and permissions.',
                checks: [
                    {
                        authObject: 'S_PROGRAM',
                        description: 'Program execution authorization',
                        fields: 'P_ACTION, P_GROUP'
                    }
                ]
            },

            errorHandling: [
                {
                    errorCode: 'E001',
                    description: 'No data found for given selection criteria',
                    businessImpact: 'User cannot process data - may need to adjust selection parameters',
                    resolution: 'Verify selection criteria and ensure data exists in the system'
                },
                {
                    errorCode: 'E002',
                    description: 'Authorization failure',
                    businessImpact: 'User cannot execute the program',
                    resolution: 'Contact SAP Basis team to assign appropriate role'
                }
            ],

            testScenarios: [
                {
                    scenarioId: 'TS-001',
                    title: 'Successful Data Processing',
                    precondition: 'Valid data exists in SAP tables',
                    steps: '1. Execute program\n2. Enter valid selection criteria\n3. Run report',
                    expectedResult: 'Program displays processed results correctly'
                },
                {
                    scenarioId: 'TS-002',
                    title: 'No Data Found',
                    precondition: 'No matching data for criteria',
                    steps: '1. Execute program\n2. Enter criteria with no matching data\n3. Run report',
                    expectedResult: 'Appropriate "No data found" message displayed'
                }
            ],

            appendix: {
                technicalNotes: `Object: ${objectName}, Type: ${objectType || 'Program'}, Total Lines: ${totalLines}. This is a mock analysis generated in development mode. Deploy with ANTHROPIC_API_KEY to get real Claude AI analysis.`,
                assumptions: [
                    'This is a MOCK analysis for development/testing purposes',
                    'Real analysis requires a valid Anthropic Claude API key',
                    'The actual Claude AI analysis will provide much more detailed and accurate results'
                ],
                openQuestions: [
                    'What specific business KPIs does this report support?',
                    'Are there any downstream systems that consume this output?',
                    'What is the expected data volume and performance requirement?'
                ]
            },

            modelUsed: 'mock-development-mode',
            tokensUsed: 0
        };
    }

    /**
     * Default BRD sections structure
     */
    _getDefaultSections() {
        return {
            documentTitle: "string - Title of the document (must match the requested document type)",
            documentVersion: "string - Version number (e.g., 1.0)",
            preparedDate: "string - Current date",

            documentMetadata: [
                {
                    label: "string - Field label (e.g., Client Name, Project Name, Module, WRICEF Number, Version, Date, Type of Development, Complexity)",
                    value: "string - Field value"
                }
            ],

            versionHistory: [
                {
                    date: "string - Date of revision",
                    version: "string - Version number",
                    description: "string - Description of changes",
                    preparedBy: "string - Author name",
                    approvedBy: "string - Approver name (if known, else empty)"
                }
            ],

            executiveSummary: "string - 2-3 paragraph summary of the business functionality",

            businessOverview: {
                purpose: "string - Business purpose of this development",
                businessProcess: "string - Which SAP business process this belongs to (e.g., Order-to-Cash, Procure-to-Pay)",
                module: "string - SAP Module (MM, SD, FI, etc.)",
                stakeholders: "array of strings - Business stakeholders/departments affected",
                businessBenefit: "string - Business value delivered"
            },

            functionalRequirements: [
                {
                    reqId: "string - FR-001, FR-002, etc.",
                    title: "string - Requirement title",
                    description: "string - Detailed description",
                    businessRule: "string - Business rule implemented",
                    priority: "string - High/Medium/Low",
                    codeReference: "string - Which section/method implements this"
                }
            ],

            dataSpecification: {
                inputData: [
                    {
                        fieldName: "string",
                        sapTable: "string - SAP table name",
                        businessMeaning: "string",
                        mandatory: "boolean",
                        validationRules: "string"
                    }
                ],
                outputData: [
                    {
                        fieldName: "string",
                        description: "string",
                        format: "string",
                        businessUse: "string"
                    }
                ],
                tablesUsed: [
                    {
                        tableName: "string",
                        tableDescription: "string",
                        usage: "string - Read/Write/Both",
                        businessEntity: "string - What business entity this represents"
                    }
                ]
            },

            selectionScreen: {
                description: "string - Overall description of user inputs",
                parameters: [
                    {
                        paramName: "string",
                        type: "string",
                        description: "string",
                        mandatory: "boolean",
                        defaultValue: "string"
                    }
                ]
            },

            businessRules: [
                {
                    ruleId: "string - BR-001",
                    ruleName: "string",
                    description: "string - Detailed business rule",
                    condition: "string - When this rule applies",
                    action: "string - What happens when rule is triggered"
                }
            ],

            integrationPoints: [
                {
                    system: "string - Integration target",
                    type: "string - RFC/BAPI/IDoc/API/File",
                    direction: "string - Inbound/Outbound",
                    description: "string - Purpose of integration",
                    dataExchanged: "string - What data flows"
                }
            ],

            authorization: {
                description: "string - Authorization concept",
                checks: [
                    {
                        authObject: "string - Authorization object",
                        description: "string - What it controls",
                        fields: "string - Auth fields checked"
                    }
                ]
            },

            errorHandling: [
                {
                    errorCode: "string",
                    description: "string",
                    businessImpact: "string",
                    resolution: "string"
                }
            ],

            testScenarios: [
                {
                    scenarioId: "string - TS-001",
                    title: "string",
                    precondition: "string",
                    steps: "string",
                    expectedResult: "string"
                }
            ],

            appendix: {
                technicalNotes: "string - Additional technical notes",
                assumptions: "array of strings - Assumptions made during analysis",
                openQuestions: "array of strings - Questions that need business clarification"
            },

            customSections: [
                {
                    title: "string - Section title (from reference template)",
                    content: "string - Section content as paragraph text",
                    tableData: {
                        headers: "array of strings - Table column headers (if section contains a table)",
                        rows: "array of arrays of strings - Table data rows (if section contains a table)"
                    }
                }
            ]
        };
    }
}

module.exports = ClaudeAnalyzer;
