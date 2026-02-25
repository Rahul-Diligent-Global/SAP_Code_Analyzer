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

        // Increase token limit for COMPREHENSIVE mode to allow much larger output
        const effectiveMaxTokens = (detailLevel === 'COMPREHENSIVE') ? Math.max(this.maxTokens, 16384) :
            (detailLevel === 'SUMMARY') ? Math.min(this.maxTokens, 4096) : this.maxTokens;

        LOG.info(`Sending ${sourceCode.length} chars to Claude API (model: ${this.model}, maxTokens: ${effectiveMaxTokens}, detail: ${detailLevel || 'DETAILED'})`);

        const response = await this._callClaudeAPI(systemPrompt, userMessage, effectiveMaxTokens);

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

        // Build the prompt differently based on whether a reference template is provided
        let prompt;

        if (referenceContent) {
            // --- REFERENCE TEMPLATE MODE: Use flexible sections-based schema ---
            const flexibleSchema = {
                documentTitle: "string - Title of the document",
                documentMetadata: [
                    {
                        label: "string - Field label (e.g., Client Name, Project Name, Module)",
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
                headerText: "string - text that should appear in the document header (e.g. 'Functional Specification Document')",
                sections: [
                    {
                        number: "string - section number (e.g. '1', '1.1', '2.3.1')",
                        title: "string - section title matching reference template",
                        level: "number - 1 for main heading, 2 for sub-heading, 3 for sub-sub",
                        content: "string - paragraph text content (can be multi-paragraph separated by \\n\\n)",
                        bulletPoints: ["string - bullet points if section has a list"],
                        tableData: {
                            headers: ["string - table column headers"],
                            rows: [["string - table data cells"]]
                        }
                    }
                ]
            };

            prompt = `${roleDescription}
${taskDescription}

*** HIGHEST PRIORITY - REFERENCE TEMPLATE ***
The user has provided a reference document below. You MUST:
1. Follow the reference document's EXACT section structure, naming, and ordering
2. Each section from the reference document should become a section in the "sections" array
3. Use the same section numbering scheme as the reference
4. Fill section content with analysis of the provided ABAP code
5. Include tables where the reference has tables (use tableData)
6. Set "headerText" to whatever text appears in the reference document's header (e.g. "Functional Specification Document")
7. MATCH the reference document's tone, language style, and level of formality
8. POPULATE the "documentMetadata" field with key-value pairs matching the reference's cover page metadata
9. POPULATE the "versionHistory" array matching the reference's document revision table format
10. Do NOT use the default schema fields (executiveSummary, businessOverview, functionalRequirements, etc.) - put ALL content in the "sections" array

---BEGIN REFERENCE DOCUMENT---
${referenceContent}
---END REFERENCE DOCUMENT---
*** END REFERENCE TEMPLATE ***

DOCUMENT TYPE: ${typeLabel}

CRITICAL INSTRUCTIONS:
1. Analyze the ABAP code thoroughly - understand every SELECT statement, BAPI call, module, form, method
2. Determine all database tables used and their business meaning
3. Identify integration points (BAPIs, RFCs, IDocs, APIs)
${focusInstructions}

DETAIL LEVEL: ${detailLevel || 'DETAILED'}
${this._getDetailLevelInstructions(detailLevel)}

OUTPUT FORMAT: You MUST return a valid JSON object with the following structure:
${JSON.stringify(flexibleSchema, null, 2)}

${(detailLevel === 'COMPREHENSIVE') ? `
ADDITIONAL COMPREHENSIVE FIELDS (add these as top-level fields alongside sections):
"processingLogic": [
  {
    "subroutineName": "string - FORM/METHOD/FUNCTION name or MAIN PROGRAM",
    "purpose": "string - What this routine does in business terms",
    "steps": [
      {
        "stepNumber": "number",
        "type": "string - one of: START, END, PROCESS, IF, ELSEIF, ELSE, ENDIF, LOOP, ENDLOOP, READ, SELECT, CALL, WRITE, MOVE, CALCULATE, CHECK, EXIT, RETURN",
        "condition": "string - The actual condition/expression (e.g., 'IF SY-SUBRC = 0', 'LOOP AT GT_DATA WHERE BUKRS = LV_BUKRS')",
        "description": "string - What this step does in business terms",
        "indentLevel": "number - nesting depth (0 for top level, 1 for inside first IF, 2 for nested IF, etc.)",
        "codeReference": "string - The approximate line or code snippet being referenced"
      }
    ]
  }
],
"flowchart": [
  {
    "id": "string - unique step id (e.g., S1, S2, D1, D2)",
    "type": "string - one of: start, end, process, decision, loop, io",
    "label": "string - Short label for the flowchart box",
    "description": "string - Detailed description",
    "yesTarget": "string - id of next step if YES (for decisions)",
    "noTarget": "string - id of next step if NO (for decisions)",
    "nextTarget": "string - id of next step (for non-decisions)"
  }
]
` : ''}
IMPORTANT:
- Every section must contain substantive content derived from the actual code analysis
- Use professional business language, not technical jargon
- Include specific field names, table names mapped to business terminology
- All text values should be properly escaped for JSON
- The "documentMetadata" field is an array of key-value pairs for the cover page (e.g., Client Name, Project Name, Module, WRICEF Number, Version, Date, Type of Development, Complexity)
- The "versionHistory" array captures document revision tracking (date, version, description, preparedBy, approvedBy)
- The "sections" array is the ONLY place for document content - do NOT include executiveSummary, businessOverview, functionalRequirements, or any other top-level content fields
- If a section in the reference contains a table, populate the "tableData" field for that section
- If a section contains bullet points, populate the "bulletPoints" array
- If a section is pure text, use the "content" field and leave bulletPoints and tableData empty/omitted`;
        } else {
            // --- DEFAULT MODE: Use the fixed schema ---
            prompt = `${roleDescription}
${taskDescription}

DOCUMENT TYPE: ${typeLabel}

CRITICAL INSTRUCTIONS:
1. Analyze the ABAP code thoroughly - understand every SELECT statement, BAPI call, module, form, method
2. Determine all database tables used and their business meaning
3. Identify integration points (BAPIs, RFCs, IDocs, APIs)
${focusInstructions}

IMPORTANT: The document title (documentTitle field) MUST reflect the correct document type.
- If generating a ${typeLabel}, the title should include "${typeLabel}" (NOT "Business Requirements Document" unless this IS a BRD)

DETAIL LEVEL: ${detailLevel || 'DETAILED'}
${this._getDetailLevelInstructions(detailLevel)}

OUTPUT FORMAT: You MUST return a valid JSON object with the following structure:
${JSON.stringify(sections, null, 2)}

${(detailLevel === 'COMPREHENSIVE') ? `
ADDITIONAL COMPREHENSIVE FIELDS (add these as top-level fields in the JSON):
"processingLogic": [
  {
    "subroutineName": "string - FORM/METHOD/FUNCTION name or MAIN PROGRAM",
    "purpose": "string - What this routine does in business terms",
    "steps": [
      {
        "stepNumber": "number",
        "type": "string - one of: START, END, PROCESS, IF, ELSEIF, ELSE, ENDIF, LOOP, ENDLOOP, READ, SELECT, CALL, WRITE, MOVE, CALCULATE, CHECK, EXIT, RETURN",
        "condition": "string - The actual condition/expression (e.g., 'IF SY-SUBRC = 0', 'LOOP AT GT_DATA WHERE BUKRS = LV_BUKRS')",
        "description": "string - What this step does in business terms",
        "indentLevel": "number - nesting depth (0 for top level, 1 for inside first IF, 2 for nested IF, etc.)",
        "codeReference": "string - The approximate line or code snippet being referenced"
      }
    ]
  }
],
"flowchart": [
  {
    "id": "string - unique step id (e.g., S1, S2, D1, D2)",
    "type": "string - one of: start, end, process, decision, loop, io",
    "label": "string - Short label for the flowchart box",
    "description": "string - Detailed description",
    "yesTarget": "string - id of next step if YES (for decisions)",
    "noTarget": "string - id of next step if NO (for decisions)",
    "nextTarget": "string - id of next step (for non-decisions)"
  }
]
` : ''}
IMPORTANT:
- Every field must contain substantive content derived from the actual code analysis
- Use professional business language, not technical jargon
- Include specific field names, table names mapped to business terminology
- For each business rule, reference the corresponding code section
- All text values should be properly escaped for JSON
- The "documentMetadata" field is an array of key-value pairs for the cover page
- The "versionHistory" array captures document revision tracking
- The "customSections" array allows you to add any additional sections`;
        }

        return prompt;
    }

    /**
     * Get detailed instructions per detail level
     */
    _getDetailLevelInstructions(detailLevel) {
        switch (detailLevel) {
            case 'SUMMARY':
                return `SUMMARY MODE (2-3 pages):
- Provide a high-level executive overview only
- Cover only the main purpose, key business rules, and critical integration points
- Keep each section brief (1-2 paragraphs max)
- Skip detailed data specifications, test scenarios, and code-level details
- Focus on WHAT the program does, not HOW it does it`;

            case 'COMPREHENSIVE':
                return `COMPREHENSIVE MODE (15-25+ pages) - MAXIMUM DETAIL:
- This is the most detailed analysis possible. Cover EVERYTHING.
- Write LONG, DETAILED paragraphs for every section (minimum 3-5 paragraphs per section)
- List EVERY database table, EVERY field, EVERY business rule found in the code
- Document ALL functional requirements with full traceability to code
- Include COMPLETE data specification with every input/output field
- Document ALL error handling paths and edge cases
- Write detailed test scenarios for every business path

CRITICAL - PROCESSING LOGIC DEEP DIVE:
- You MUST include a "processingLogic" array in your JSON response
- Walk through EVERY subroutine/form/method in the code step by step
- Document EVERY IF/ELSEIF/ELSE condition with the actual ABAP condition expression
- Document EVERY LOOP (LOOP AT, DO, WHILE) with its iteration logic
- Document EVERY READ TABLE, SELECT, CALL FUNCTION with its purpose
- Show nesting depth via "indentLevel" (0=top, 1=inside IF, 2=nested IF, etc.)
- Cover ALL the core processing logic, not just the happy path

CRITICAL - FLOWCHART:
- You MUST include a "flowchart" array in your JSON response
- Create a complete program flowchart with START, decision diamonds, process boxes
- Every IF condition becomes a "decision" node with yesTarget and noTarget
- Every LOOP becomes a "loop" node
- Every data operation (SELECT, READ TABLE) becomes a "process" node
- Every output (WRITE, ALV display) becomes an "io" node
- Connect all nodes with nextTarget/yesTarget/noTarget to form a complete flow
- The flowchart should cover the ENTIRE program flow from start to end`;

            default: // DETAILED
                return `DETAILED MODE (5-10 pages):
- Provide thorough coverage of all sections
- Include specific field names, table names, and business rules
- Document all functional requirements with business rule references
- Include data specifications with key fields
- Cover main processing logic at a moderate level of detail
- Include test scenarios for primary business paths`;
        }
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
     * Call Claude API with retry logic for transient errors (429, 529, 500, 502, 503)
     */
    async _callClaudeAPI(systemPrompt, userMessage, maxTokens) {
        if (!this.apiKey) {
            throw new Error('ANTHROPIC_API_KEY not configured. Set it in environment variables or BTP Credential Store.');
        }

        const requestBody = {
            model: this.model,
            max_tokens: maxTokens || this.maxTokens,
            system: systemPrompt,
            messages: [
                {
                    role: 'user',
                    content: userMessage
                }
            ]
        };

        const MAX_RETRIES = 3;
        const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 529];

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
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

                    // Retry on transient errors with exponential backoff
                    if (RETRYABLE_STATUS_CODES.includes(response.status) && attempt < MAX_RETRIES) {
                        const waitTime = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
                        LOG.warn(`Claude API returned ${response.status} (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying in ${waitTime / 1000}s...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                        continue;
                    }

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

                // Retry on network errors
                if (attempt < MAX_RETRIES) {
                    const waitTime = Math.pow(2, attempt + 1) * 1000;
                    LOG.warn(`Claude API call failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${error.message}. Retrying in ${waitTime / 1000}s...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                LOG.error('Claude API call failed after all retries:', error.message);
                throw new Error(`Failed to call Claude API: ${error.message}`);
            }
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
