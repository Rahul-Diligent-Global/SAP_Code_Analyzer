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
     * Generate BRD (Business Requirements Document) analysis from ABAP code
     */
    async generateBRD(params) {
        const {
            objectName, objectType, title, sourceCode,
            includes, detailLevel, customPrompt,
            templatePrompt, templateSections
        } = params;

        if (this.isMockMode) {
            LOG.info('Mock mode: returning sample BRD analysis');
            return this._getMockBRDAnalysis(objectName, objectType, title, sourceCode);
        }

        // Build the system prompt for BRD generation
        const systemPrompt = this._buildBRDSystemPrompt(detailLevel, templateSections);

        // Build the user message with code
        const userMessage = this._buildBRDUserMessage({
            objectName, objectType, title, sourceCode,
            includes, customPrompt, templatePrompt
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
     * Returns structured BRD-like analysis
     */
    async analyzeCode(params) {
        const { objectName, objectType, title, sourceCode, analysisType } = params;

        if (this.isMockMode) {
            LOG.info('Mock mode: returning sample code analysis');
            return this._getMockBRDAnalysis(objectName, objectType, title, sourceCode);
        }

        const systemPrompt = this._buildBRDSystemPrompt(
            'DETAILED',
            null
        );

        const userMessage = `Analyze this SAP ABAP object and generate a structured Business Requirements Document:

Object Name: ${objectName}
Object Type: ${objectType}
Title: ${title}
Analysis Type: ${analysisType || 'BRD'}

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
     * Build system prompt for BRD generation
     */
    _buildBRDSystemPrompt(detailLevel, templateSections) {
        const sections = templateSections ? JSON.parse(templateSections) : this._getDefaultSections();

        return `You are a Senior SAP Functional Consultant and Business Analyst with 20+ years of experience.
Your task is to analyze SAP ABAP source code and generate a comprehensive Business Requirements Document (BRD) / Functional Specification.

CRITICAL INSTRUCTIONS:
1. Analyze the ABAP code thoroughly - understand every SELECT statement, BAPI call, module, form, method
2. Identify the business process the code implements
3. Determine all database tables used and their business meaning
4. Map technical logic to business rules
5. Identify all input parameters, selection screens, and their business purpose
6. Document all output formats (ALV, reports, files, IDocs, etc.)
7. Identify integration points (BAPIs, RFCs, IDocs, APIs)
8. Note any authorization checks and their business context
9. Document error handling and business validations

DETAIL LEVEL: ${detailLevel || 'DETAILED'}
- SUMMARY: High-level overview, 2-3 pages
- DETAILED: Full BRD with all sections, 5-10 pages
- COMPREHENSIVE: Complete specification with data mappings, 10+ pages

OUTPUT FORMAT: You MUST return a valid JSON object with the following structure:
${JSON.stringify(sections, null, 2)}

IMPORTANT:
- Every field must contain substantive content derived from the actual code analysis
- Use professional business language, not technical jargon
- Include specific field names, table names mapped to business terminology
- For each business rule, reference the corresponding code section
- All text values should be properly escaped for JSON`;
    }

    /**
     * Build user message with code for BRD generation
     */
    _buildBRDUserMessage(params) {
        const {
            objectName, objectType, title, sourceCode,
            includes, customPrompt, templatePrompt
        } = params;

        let message = `Please analyze the following SAP ABAP object and generate a complete BRD document.

═══════════════════════════════════════════════════════════════
OBJECT DETAILS
═══════════════════════════════════════════════════════════════
Object Name: ${objectName}
Object Type: ${objectType}
Title/Description: ${title || 'Not specified'}
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
    _getMockBRDAnalysis(objectName, objectType, title, sourceCode) {
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
            documentTitle: `Business Requirements Document - ${objectName}`,
            documentVersion: '1.0',
            preparedDate: new Date().toLocaleDateString(),

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
            documentTitle: "string - Title of the BRD document",
            documentVersion: "string - Version number (e.g., 1.0)",
            preparedDate: "string - Current date",

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
            }
        };
    }
}

module.exports = ClaudeAnalyzer;
