using abap.analyzer from '../db/schema';

/**
 * Main service for ABAP Code Analyzer
 * Exposes entities and actions for the Fiori UI
 */
service CodeAnalyzerService @(path: '/api/analyzer') {

    // ═══════════════════════════════════════════════════════════════
    // Entities (Read-only projections for the UI)
    // ═══════════════════════════════════════════════════════════════

    @readonly
    entity CustomObjects as projection on analyzer.CustomObjects {
        *
    };

    @readonly
    entity DocumentGenerationLog as projection on analyzer.DocumentGenerationLog {
        *
    };

    entity DocumentTemplates as projection on analyzer.DocumentTemplates {
        *
    };

    // ═══════════════════════════════════════════════════════════════
    // Types for Action Parameters & Return Values
    // ═══════════════════════════════════════════════════════════════

    type SourceCodeLine {
        lineNumber  : Integer;
        sourceLine  : String(1000);
        includeName : String(120);
        section     : String(100);
    }

    type IncludeInfo {
        includeName  : String(120);
        includeType  : String(100);
        parentObject : String(120);
        lineCount    : Integer;
    }

    type SourceCodeResult {
        objectName   : String(120);
        title        : String(200);
        objectType   : String(30);
        package      : String(30);
        author       : String(12);
        createdOn    : Date;
        totalLines   : Integer;
        sourceCode   : array of SourceCodeLine;
        includes     : array of IncludeInfo;
    }

    type DocumentResult {
        success       : Boolean;
        fileName      : String(200);
        fileType      : String(10);
        fileContent   : LargeBinary;  // Base64 encoded
        fileSize      : Integer;
        generationId  : UUID;
        message       : String(500);
    }

    type ObjectFilter {
        objectType : String(20);
        namespace  : String(10);
        maxRows    : Integer;
    }

    type DocumentOptions {
        documentType   : String(10);   // PDF or DOCX
        templateId     : UUID;         // Template to use
        includeCode    : Boolean;      // Include source code in doc
        detailLevel    : String(20);   // SUMMARY, DETAILED, COMPREHENSIVE
        customPrompt   : String(2000); // Optional custom instructions
    }

    // ═══════════════════════════════════════════════════════════════
    // Actions (Business Logic)
    // ═══════════════════════════════════════════════════════════════

    /**
     * Fetch/Refresh custom objects from SAP On-Premise
     * Calls RFC Z_MCP_GET_CUSTOM_OBJECTS
     */
    action refreshObjects(filter: ObjectFilter) returns array of CustomObjects;

    /**
     * Get complete source code of an ABAP object
     * Calls RFC Z_MCP_GET_SOURCE_CODE
     */
    action getSourceCode(
        objectName : String(120),
        category   : String(30)
    ) returns SourceCodeResult;

    /**
     * Generate BRD/Functional document using Claude AI
     * Sends code to Claude API, generates formatted document
     */
    action generateDocument(
        objectName : String(120),
        category   : String(30),
        options    : DocumentOptions
    ) returns DocumentResult;

    /**
     * Analyze code with Claude AI (preview without document)
     * Returns structured analysis as JSON
     */
    action analyzeCode(
        objectName : String(120),
        category   : String(30),
        analysisType : String(30)  // BRD, FUNC_SPEC, TECH_SPEC, CODE_REVIEW
    ) returns String; // JSON string with analysis
}

