/**
 * Document Generator
 * Creates professionally formatted DOCX and PDF documents
 * from Claude AI analysis results
 *
 * Dependencies: docx (npm), pdfkit (npm)
 */

const cds = require('@sap/cds');
const LOG = cds.log('doc-generator');

class DocumentGenerator {

    /**
     * Generate a Word document (DOCX) from BRD analysis
     */
    /**
     * Get display label for analysis type
     */
    _getDocTypeLabel(analysisType) {
        const labels = {
            'BRD': 'Business Requirements Document',
            'FUNC_SPEC': 'Functional Specification',
            'TECH_SPEC': 'Technical Specification',
            'CODE_REVIEW': 'Code Review Report'
        };
        return labels[analysisType] || labels['BRD'];
    }

    /**
     * Get short prefix for filenames
     */
    _getDocTypePrefix(analysisType) {
        const prefixes = {
            'BRD': 'BRD',
            'FUNC_SPEC': 'FUNC_SPEC',
            'TECH_SPEC': 'TECH_SPEC',
            'CODE_REVIEW': 'CODE_REVIEW'
        };
        return prefixes[analysisType] || 'BRD';
    }

    async generateDOCX(analysis, sourceResult, options) {
        const {
            Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
            Header, Footer, AlignmentType, HeadingLevel, BorderStyle,
            WidthType, ShadingType, PageNumber, PageBreak, LevelFormat,
            TableOfContents, ImageRun
        } = require('docx');

        const analysisType = options?.analysisType || 'BRD';
        const docTypePrefix = this._getDocTypePrefix(analysisType);
        const docTypeLabel = this._getDocTypeLabel(analysisType);
        const fileName = `${docTypePrefix}_${sourceResult.objectName}_${Date.now()}.docx`;
        const includeCode = options?.includeCode !== false;
        const todayDate = new Date().toISOString().split('T')[0];

        // ─── Styles ───
        const doc = new Document({
            styles: {
                default: {
                    document: {
                        run: { font: 'Calibri', size: 22 } // 11pt
                    }
                },
                paragraphStyles: [
                    {
                        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal',
                        quickFormat: true,
                        run: { size: 36, bold: true, font: 'Calibri', color: '1F4E79' },
                        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 }
                    },
                    {
                        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal',
                        quickFormat: true,
                        run: { size: 28, bold: true, font: 'Calibri', color: '2E75B6' },
                        paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 }
                    },
                    {
                        id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal',
                        quickFormat: true,
                        run: { size: 24, bold: true, font: 'Calibri', color: '404040' },
                        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 }
                    }
                ]
            },
            numbering: {
                config: [
                    {
                        reference: 'bullets',
                        levels: [{
                            level: 0,
                            format: LevelFormat.BULLET,
                            text: '\u2022',
                            alignment: AlignmentType.LEFT,
                            style: { paragraph: { indent: { left: 720, hanging: 360 } } }
                        }]
                    },
                    {
                        reference: 'numbers',
                        levels: [{
                            level: 0,
                            format: LevelFormat.DECIMAL,
                            text: '%1.',
                            alignment: AlignmentType.LEFT,
                            style: { paragraph: { indent: { left: 720, hanging: 360 } } }
                        }]
                    }
                ]
            },
            sections: []
        });

        const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
        const borders = { top: border, bottom: border, left: border, right: border };
        const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };
        const headerShading = { fill: '1F4E79', type: ShadingType.CLEAR };
        const altRowShading = { fill: 'F2F7FB', type: ShadingType.CLEAR };

        const children = [];

        // ═══════════════════════════════════════════════════════════
        // COVER PAGE
        // ═══════════════════════════════════════════════════════════
        children.push(
            new Paragraph({ spacing: { before: 2000 } }),
            new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({
                    text: analysis.documentTitle || `${sourceResult.objectName} - ${docTypeLabel}`,
                    bold: true, size: 56, font: 'Calibri', color: '1F4E79'
                })]
            }),
            new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER,
                children: [new TextRun({
                    text: `SAP ABAP Object: ${sourceResult.objectName}`,
                    size: 28, color: '666666'
                })]
            })
        );

        // Document Metadata Table (from reference template - client info, project name, etc.)
        if (analysis.documentMetadata && Array.isArray(analysis.documentMetadata) && analysis.documentMetadata.length > 0) {
            children.push(new Paragraph({ spacing: { before: 600 } }));

            const metaBorder = { style: BorderStyle.SINGLE, size: 1, color: '999999' };
            const metaBorders = { top: metaBorder, bottom: metaBorder, left: metaBorder, right: metaBorder };
            const metaLabelShading = { fill: 'F2F2F2', type: ShadingType.CLEAR };

            const metaRows = analysis.documentMetadata
                .filter(item => item && (item.label || item.value))
                .map(item => new TableRow({
                children: [
                    new TableCell({
                        borders: metaBorders,
                        width: { size: 3600, type: WidthType.DXA },
                        shading: metaLabelShading,
                        margins: cellMargins,
                        children: [new Paragraph({
                            children: [new TextRun({ text: String(item.label || ''), bold: true, size: 20, font: 'Calibri' })]
                        })]
                    }),
                    new TableCell({
                        borders: metaBorders,
                        width: { size: 5760, type: WidthType.DXA },
                        margins: cellMargins,
                        children: [new Paragraph({
                            children: [new TextRun({ text: String(item.value || ''), size: 20, font: 'Calibri' })]
                        })]
                    })
                ]
            }));

            children.push(new Table({
                width: { size: 9360, type: WidthType.DXA },
                columnWidths: [3600, 5760],
                rows: metaRows
            }));
        }

        // Version History Table (from reference template)
        if (analysis.versionHistory && Array.isArray(analysis.versionHistory) && analysis.versionHistory.length > 0) {
            children.push(
                new Paragraph({ spacing: { before: 400 } }),
                new Paragraph({ spacing: { after: 100 },
                    children: [new TextRun({ text: 'Document Version History', bold: true, size: 22, color: '1F4E79' })]
                })
            );

            children.push(this._createTable(
                ['Date', 'Version', 'Description', 'Prepared By', 'Approved By'],
                analysis.versionHistory.map(v => [
                    v.date || '', v.version || '', v.description || '',
                    v.preparedBy || '', v.approvedBy || ''
                ]),
                [1600, 1000, 3160, 2000, 1600],
                { borders, cellMargins, headerShading, altRowShading, TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType }
            ));
        } else {
            // Fallback: simple cover info when no metadata tables
            children.push(
                new Paragraph({ spacing: { before: 200 }, alignment: AlignmentType.CENTER,
                    children: [new TextRun({
                        text: sourceResult.title || '',
                        size: 24, italics: true, color: '888888'
                    })]
                }),
                new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.CENTER,
                    children: [new TextRun({
                        text: `Version: ${analysis.documentVersion || '1.0'}`,
                        size: 22, color: '666666'
                    })]
                }),
                new Paragraph({ alignment: AlignmentType.CENTER,
                    children: [new TextRun({
                        text: `Date: ${todayDate}`,
                        size: 22, color: '666666'
                    })]
                })
            );
        }

        children.push(
            new Paragraph({ spacing: { before: 300 }, alignment: AlignmentType.CENTER,
                children: [new TextRun({
                    text: `Generated by Diligent Code Insight`,
                    size: 20, italics: true, color: '999999'
                })]
            }),
            new Paragraph({ children: [new PageBreak()] })
        );

        // ═══════════════════════════════════════════════════════════
        // TABLE OF CONTENTS
        // ═══════════════════════════════════════════════════════════
        children.push(
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Table of Contents')] }),
            new TableOfContents('Table of Contents', {
                hyperlink: true, headingStyleRange: '1-3'
            }),
            new Paragraph({ children: [new PageBreak()] })
        );

        // ═══════════════════════════════════════════════════════════
        // DOCUMENT BODY SECTIONS
        // ═══════════════════════════════════════════════════════════
        // Check if AI returned dynamic sections (reference template mode)
        if (analysis.sections && Array.isArray(analysis.sections) && analysis.sections.length > 0) {
            // ─── DYNAMIC SECTIONS MODE ───
            // Render sections from AI response (reference template was used)
            for (const section of analysis.sections) {
                if (!section || !section.title) continue;

                const level = section.level || 1;
                const heading = level === 1 ? HeadingLevel.HEADING_1 :
                               level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;

                const sectionTitle = section.number ? `${section.number} ${section.title}` : section.title;
                children.push(new Paragraph({ heading, children: [new TextRun(sectionTitle)] }));

                // Content paragraphs
                if (section.content) {
                    const paragraphs = String(section.content).split('\n\n');
                    for (const para of paragraphs) {
                        if (para.trim()) {
                            children.push(new Paragraph({ spacing: { after: 150 },
                                children: [new TextRun({ text: para.trim() })]
                            }));
                        }
                    }
                }

                // Bullet points
                if (section.bulletPoints && Array.isArray(section.bulletPoints)) {
                    for (const bp of section.bulletPoints) {
                        children.push(new Paragraph({
                            numbering: { reference: 'bullets', level: 0 },
                            children: [new TextRun(String(bp || ''))]
                        }));
                    }
                }

                // Table data
                if (section.tableData && Array.isArray(section.tableData.headers) && section.tableData.headers.length > 0
                    && Array.isArray(section.tableData.rows) && section.tableData.rows.length > 0) {
                    const numCols = section.tableData.headers.length;
                    const colWidth = Math.floor(9360 / numCols);
                    const colWidths = section.tableData.headers.map(() => colWidth);
                    children.push(this._createTable(
                        section.tableData.headers,
                        section.tableData.rows,
                        colWidths,
                        { borders, cellMargins, headerShading, altRowShading, TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType }
                    ));
                }
            }
        } else {
            // ─── FIXED SECTIONS MODE ───
            // Original hardcoded sections (no reference template)

            // ═══════════════════════════════════════════════════════════
            // 1. EXECUTIVE SUMMARY
            // ═══════════════════════════════════════════════════════════
            children.push(
                new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('1. Executive Summary')] }),
                new Paragraph({ spacing: { after: 200 },
                    children: [new TextRun({ text: analysis.executiveSummary || 'No executive summary available.' })]
                })
            );

            // ═══════════════════════════════════════════════════════════
            // 2. BUSINESS OVERVIEW
            // ═══════════════════════════════════════════════════════════
            if (analysis.businessOverview) {
                const bo = analysis.businessOverview;
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('2. Business Overview')] }),
                    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.1 Purpose')] }),
                    new Paragraph({ children: [new TextRun(bo.purpose || '')] }),
                    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.2 Business Process')] }),
                    new Paragraph({ children: [new TextRun(bo.businessProcess || '')] }),
                    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.3 SAP Module')] }),
                    new Paragraph({ children: [new TextRun(bo.module || '')] }),
                    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.4 Business Benefit')] }),
                    new Paragraph({ children: [new TextRun(bo.businessBenefit || '')] })
                );

                if (bo.stakeholders?.length > 0) {
                    children.push(
                        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('2.5 Stakeholders')] })
                    );
                    for (const sh of bo.stakeholders) {
                        children.push(new Paragraph({
                            numbering: { reference: 'bullets', level: 0 },
                            children: [new TextRun(sh)]
                        }));
                    }
                }
            }

            // ═══════════════════════════════════════════════════════════
            // 3. FUNCTIONAL REQUIREMENTS
            // ═══════════════════════════════════════════════════════════
            if (analysis.functionalRequirements?.length > 0) {
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('3. Functional Requirements')] })
                );

                children.push(this._createTable(
                    ['Req ID', 'Title', 'Description', 'Business Rule', 'Priority'],
                    analysis.functionalRequirements.map(req => [
                        req.reqId || '', req.title || '', req.description || '',
                        req.businessRule || '', req.priority || ''
                    ]),
                    [1200, 1800, 2800, 2400, 1160],
                    { borders, cellMargins, headerShading, altRowShading, TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType }
                ));
            }

            // ═══════════════════════════════════════════════════════════
            // 4. DATA SPECIFICATION
            // ═══════════════════════════════════════════════════════════
            if (analysis.dataSpecification) {
                const ds = analysis.dataSpecification;
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('4. Data Specification')] })
                );

                // 4.1 Input Data
                if (ds.inputData?.length > 0) {
                    children.push(
                        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('4.1 Input Data')] })
                    );
                    children.push(this._createTable(
                        ['Field', 'SAP Table', 'Business Meaning', 'Mandatory', 'Validation'],
                        ds.inputData.map(d => [
                            d.fieldName || '', d.sapTable || '', d.businessMeaning || '',
                            d.mandatory ? 'Yes' : 'No', d.validationRules || ''
                        ]),
                        [1600, 1600, 2400, 1000, 2760],
                        { borders, cellMargins, headerShading, altRowShading, TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType }
                    ));
                }

                // 4.2 Output Data
                if (ds.outputData?.length > 0) {
                    children.push(
                        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('4.2 Output Data')] })
                    );
                    children.push(this._createTable(
                        ['Field', 'Description', 'Format', 'Business Use'],
                        ds.outputData.map(d => [
                            d.fieldName || '', d.description || '', d.format || '', d.businessUse || ''
                        ]),
                        [2000, 2800, 1560, 3000],
                        { borders, cellMargins, headerShading, altRowShading, TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType }
                    ));
                }

                // 4.3 Tables Used
                if (ds.tablesUsed?.length > 0) {
                    children.push(
                        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('4.3 SAP Tables Used')] })
                    );
                    children.push(this._createTable(
                        ['Table', 'Description', 'Usage', 'Business Entity'],
                        ds.tablesUsed.map(t => [
                            t.tableName || '', t.tableDescription || '', t.usage || '', t.businessEntity || ''
                        ]),
                        [1800, 2800, 1200, 3560],
                        { borders, cellMargins, headerShading, altRowShading, TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType }
                    ));
                }
            }

            // ═══════════════════════════════════════════════════════════
            // 5. SELECTION SCREEN
            // ═══════════════════════════════════════════════════════════
            if (analysis.selectionScreen) {
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('5. Selection Screen / User Interface')] }),
                    new Paragraph({ children: [new TextRun(analysis.selectionScreen.description || '')] })
                );

                if (analysis.selectionScreen.parameters?.length > 0) {
                    children.push(this._createTable(
                        ['Parameter', 'Type', 'Description', 'Mandatory', 'Default'],
                        analysis.selectionScreen.parameters.map(p => [
                            p.paramName || '', p.type || '', p.description || '',
                            p.mandatory ? 'Yes' : 'No', p.defaultValue || ''
                        ]),
                        [1800, 1200, 3160, 1000, 2200],
                        { borders, cellMargins, headerShading, altRowShading, TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType }
                    ));
                }
            }

            // ═══════════════════════════════════════════════════════════
            // 6. BUSINESS RULES
            // ═══════════════════════════════════════════════════════════
            if (analysis.businessRules?.length > 0) {
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('6. Business Rules')] })
                );
                children.push(this._createTable(
                    ['Rule ID', 'Rule Name', 'Description', 'Condition', 'Action'],
                    analysis.businessRules.map(r => [
                        r.ruleId || '', r.ruleName || '', r.description || '',
                        r.condition || '', r.action || ''
                    ]),
                    [1000, 1600, 2760, 2000, 2000],
                    { borders, cellMargins, headerShading, altRowShading, TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType }
                ));
            }

            // ═══════════════════════════════════════════════════════════
            // 7. INTEGRATION POINTS
            // ═══════════════════════════════════════════════════════════
            if (analysis.integrationPoints?.length > 0) {
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('7. Integration Points')] })
                );
                children.push(this._createTable(
                    ['System', 'Type', 'Direction', 'Description', 'Data Exchanged'],
                    analysis.integrationPoints.map(i => [
                        i.system || '', i.type || '', i.direction || '',
                        i.description || '', i.dataExchanged || ''
                    ]),
                    [1600, 1200, 1200, 2760, 2600],
                    { borders, cellMargins, headerShading, altRowShading, TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType }
                ));
            }

            // ═══════════════════════════════════════════════════════════
            // 8. AUTHORIZATION
            // ═══════════════════════════════════════════════════════════
            if (analysis.authorization) {
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('8. Authorization & Security')] }),
                    new Paragraph({ children: [new TextRun(analysis.authorization.description || '')] })
                );

                if (analysis.authorization.checks?.length > 0) {
                    children.push(this._createTable(
                        ['Auth Object', 'Description', 'Fields Checked'],
                        analysis.authorization.checks.map(a => [
                            a.authObject || '', a.description || '', a.fields || ''
                        ]),
                        [2400, 3960, 3000],
                        { borders, cellMargins, headerShading, altRowShading, TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType }
                    ));
                }
            }

            // ═══════════════════════════════════════════════════════════
            // 9. ERROR HANDLING
            // ═══════════════════════════════════════════════════════════
            if (analysis.errorHandling?.length > 0) {
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('9. Error Handling')] })
                );
                children.push(this._createTable(
                    ['Error Code', 'Description', 'Business Impact', 'Resolution'],
                    analysis.errorHandling.map(e => [
                        e.errorCode || '', e.description || '', e.businessImpact || '', e.resolution || ''
                    ]),
                    [1600, 2800, 2560, 2400],
                    { borders, cellMargins, headerShading, altRowShading, TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType }
                ));
            }

            // ═══════════════════════════════════════════════════════════
            // 10. TEST SCENARIOS
            // ═══════════════════════════════════════════════════════════
            if (analysis.testScenarios?.length > 0) {
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('10. Test Scenarios')] })
                );
                children.push(this._createTable(
                    ['ID', 'Title', 'Precondition', 'Steps', 'Expected Result'],
                    analysis.testScenarios.map(t => [
                        t.scenarioId || '', t.title || '', t.precondition || '',
                        t.steps || '', t.expectedResult || ''
                    ]),
                    [800, 1600, 2000, 2560, 2400],
                    { borders, cellMargins, headerShading, altRowShading, TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType }
                ));
            }

            // ═══════════════════════════════════════════════════════════
            // CUSTOM SECTIONS (from reference template)
            // ═══════════════════════════════════════════════════════════
            if (analysis.customSections && Array.isArray(analysis.customSections) && analysis.customSections.length > 0) {
                let customIdx = 11;
                for (const section of analysis.customSections) {
                    if (!section || !section.title) continue;

                    children.push(
                        new Paragraph({ heading: HeadingLevel.HEADING_1,
                            children: [new TextRun(`${customIdx}. ${String(section.title)}`)]
                        })
                    );

                    if (section.content) {
                        children.push(
                            new Paragraph({ spacing: { after: 200 },
                                children: [new TextRun({ text: String(section.content) })]
                            })
                        );
                    }

                    // Only create table if headers and rows are valid non-empty arrays
                    if (section.tableData
                        && Array.isArray(section.tableData.headers) && section.tableData.headers.length > 0
                        && Array.isArray(section.tableData.rows) && section.tableData.rows.length > 0) {

                        const numCols = section.tableData.headers.length;
                        const colWidth = Math.floor(9360 / numCols);
                        const colWidths = section.tableData.headers.map(() => colWidth);

                        children.push(this._createTable(
                            section.tableData.headers,
                            section.tableData.rows,
                            colWidths,
                            { borders, cellMargins, headerShading, altRowShading, TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType }
                        ));
                    }

                    customIdx++;
                }
            }
        }

        // ═══════════════════════════════════════════════════════════
        // PROCESSING LOGIC (COMPREHENSIVE mode)
        // ═══════════════════════════════════════════════════════════
        if (analysis.processingLogic && Array.isArray(analysis.processingLogic) && analysis.processingLogic.length > 0) {
            children.push(
                new Paragraph({ children: [new PageBreak()] }),
                new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Processing Logic - Detailed Flow')] })
            );
            children.push(new Paragraph({
                children: [new TextRun({ text: 'This section provides a step-by-step walkthrough of all core processing logic including every IF/ELSE condition, LOOP, and data operation.', italics: true })]
            }));

            for (const routine of analysis.processingLogic) {
                if (!routine || !routine.subroutineName) continue;
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(routine.subroutineName)] })
                );
                if (routine.purpose) {
                    children.push(new Paragraph({ children: [new TextRun({ text: 'Purpose: ', bold: true }), new TextRun(routine.purpose)] }));
                }
                if (routine.steps && Array.isArray(routine.steps) && routine.steps.length > 0) {
                    // Render steps as a table with indentation shown via prefix
                    const stepHeaders = ['Step', 'Type', 'Condition / Code', 'Description'];
                    const stepRows = routine.steps.map(step => {
                        const indent = step.indentLevel ? '  '.repeat(step.indentLevel) : '';
                        return [
                            String(step.stepNumber || ''),
                            indent + (step.type || ''),
                            step.condition || step.codeReference || '',
                            step.description || ''
                        ];
                    });
                    children.push(...this._createTable(stepHeaders, stepRows));
                }
            }
        }

        // ═══════════════════════════════════════════════════════════
        // FLOWCHART (COMPREHENSIVE mode)
        // ═══════════════════════════════════════════════════════════
        if (analysis.flowchart && Array.isArray(analysis.flowchart) && analysis.flowchart.length > 0) {
            children.push(
                new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Program Flowchart')] })
            );
            children.push(new Paragraph({
                children: [new TextRun({ text: 'This section shows the complete program flow with decision points, loops, and processing steps.', italics: true })]
            }));

            // Render flowchart as a visual table: ID | Shape | Label | Next
            const fcHeaders = ['ID', 'Type', 'Description', 'Flow'];
            const fcRows = analysis.flowchart.map(node => {
                const shapeMap = { start: '[START]', end: '[END]', process: '[PROCESS]', decision: '<DECISION>', loop: '((LOOP))', io: '[/IO/]' };
                const shape = shapeMap[node.type] || '[' + (node.type || '?').toUpperCase() + ']';
                let flow = '';
                if (node.type === 'decision') {
                    flow = 'YES → ' + (node.yesTarget || '?') + ' | NO → ' + (node.noTarget || '?');
                } else {
                    flow = '→ ' + (node.nextTarget || 'END');
                }
                return [
                    node.id || '',
                    shape,
                    (node.label || '') + (node.description ? '\n' + node.description : ''),
                    flow
                ];
            });
            children.push(...this._createTable(fcHeaders, fcRows));
        }

        // ═══════════════════════════════════════════════════════════
        // APPENDIX
        // ═══════════════════════════════════════════════════════════
        if (analysis.appendix) {
            children.push(
                new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Appendix')] })
            );

            if (analysis.appendix.technicalNotes) {
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Technical Notes')] }),
                    new Paragraph({ children: [new TextRun(analysis.appendix.technicalNotes)] })
                );
            }

            if (analysis.appendix.assumptions?.length > 0) {
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Assumptions')] })
                );
                for (const a of analysis.appendix.assumptions) {
                    children.push(new Paragraph({
                        numbering: { reference: 'bullets', level: 0 },
                        children: [new TextRun(a)]
                    }));
                }
            }

            if (analysis.appendix.openQuestions?.length > 0) {
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Open Questions')] })
                );
                for (const q of analysis.appendix.openQuestions) {
                    children.push(new Paragraph({
                        numbering: { reference: 'numbers', level: 0 },
                        children: [new TextRun(q)]
                    }));
                }
            }
        }

        // ═══════════════════════════════════════════════════════════
        // OPTIONAL: SOURCE CODE APPENDIX
        // ═══════════════════════════════════════════════════════════
        if (includeCode && sourceResult.sourceCode?.length > 0) {
            children.push(
                new Paragraph({ children: [new PageBreak()] }),
                new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Appendix: Source Code')] })
            );

            // Group by section
            const sections = {};
            for (const line of sourceResult.sourceCode) {
                if (!sections[line.section]) sections[line.section] = [];
                sections[line.section].push(line);
            }

            for (const [section, lines] of Object.entries(sections)) {
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(`Section: ${section}`)] })
                );

                // Add code lines with monospace font
                for (const line of lines) {
                    children.push(new Paragraph({
                        spacing: { line: 240 },
                        children: [
                            new TextRun({
                                text: `${String(line.lineNumber).padStart(5, ' ')}: ${line.sourceLine}`,
                                font: 'Courier New', size: 16 // 8pt for code
                            })
                        ]
                    }));
                }
            }
        }

        // ─── Build Header ───
        const headerText = analysis.headerText || `${docTypePrefix} - ${sourceResult.objectName}`;
        let docHeader;

        if (analysis.headerImages && Array.isArray(analysis.headerImages) && analysis.headerImages.length > 0) {
            // Header with logo images using a 3-column table
            const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
            const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
            const noMargins = { top: 0, bottom: 0, left: 0, right: 0 };

            // Left cell: first logo or empty
            const leftCellChildren = [];
            try {
                if (analysis.headerImages[0]) {
                    leftCellChildren.push(new Paragraph({
                        children: [new ImageRun({
                            data: Buffer.from(analysis.headerImages[0], 'base64'),
                            transformation: { width: 120, height: 50 }
                        })]
                    }));
                }
            } catch (imgErr) {
                LOG.warn('Failed to load left header image:', imgErr.message);
            }
            if (leftCellChildren.length === 0) {
                leftCellChildren.push(new Paragraph({ children: [] }));
            }

            // Center cell: header text
            const centerCellChildren = [new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({
                    text: headerText,
                    size: 18, color: '999999', italics: true
                })]
            })];

            // Right cell: second logo or empty
            const rightCellChildren = [];
            try {
                if (analysis.headerImages.length > 1 && analysis.headerImages[1]) {
                    rightCellChildren.push(new Paragraph({
                        alignment: AlignmentType.RIGHT,
                        children: [new ImageRun({
                            data: Buffer.from(analysis.headerImages[1], 'base64'),
                            transformation: { width: 120, height: 50 }
                        })]
                    }));
                }
            } catch (imgErr) {
                LOG.warn('Failed to load right header image:', imgErr.message);
            }
            if (rightCellChildren.length === 0) {
                rightCellChildren.push(new Paragraph({ children: [] }));
            }

            const headerTable = new Table({
                width: { size: 9360, type: WidthType.DXA },
                columnWidths: [2000, 5360, 2000],
                rows: [new TableRow({
                    children: [
                        new TableCell({ borders: noBorders, margins: noMargins, width: { size: 2000, type: WidthType.DXA }, children: leftCellChildren }),
                        new TableCell({ borders: noBorders, margins: noMargins, width: { size: 5360, type: WidthType.DXA }, children: centerCellChildren }),
                        new TableCell({ borders: noBorders, margins: noMargins, width: { size: 2000, type: WidthType.DXA }, children: rightCellChildren })
                    ]
                })]
            });

            docHeader = new Header({ children: [headerTable] });
        } else {
            // Simple text header (no images)
            docHeader = new Header({
                children: [new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [new TextRun({
                        text: headerText,
                        size: 18, color: '999999', italics: true
                    })]
                })]
            });
        }

        // ─── Assemble Document ───
        doc.addSection({
            properties: {
                page: {
                    size: { width: 12240, height: 15840 },
                    margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
                }
            },
            headers: {
                default: docHeader,
                first: docHeader
            },
            footers: {
                default: new Footer({
                    children: [new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [
                            new TextRun({ text: 'Page ', size: 18 }),
                            new TextRun({ children: [PageNumber.CURRENT], size: 18 })
                        ]
                    })]
                })
            },
            children
        });

        // Pack to buffer
        const buffer = await Packer.toBuffer(doc);
        const base64 = buffer.toString('base64');

        return {
            fileName,
            base64Content: base64,
            fileSize: buffer.length
        };
    }

    /**
     * Generate PDF document from BRD analysis
     */
    async generatePDF(analysis, sourceResult, options) {
        const PDFDocument = require('pdfkit');
        const analysisType = options?.analysisType || 'BRD';
        const docTypePrefix = this._getDocTypePrefix(analysisType);
        const docTypeLabel = this._getDocTypeLabel(analysisType);
        const fileName = `${docTypePrefix}_${sourceResult.objectName}_${Date.now()}.pdf`;
        const todayDate = new Date().toISOString().split('T')[0];

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({
                size: 'A4',
                margins: { top: 72, bottom: 72, left: 72, right: 72 },
                info: {
                    Title: analysis.documentTitle || `${sourceResult.objectName} - ${docTypeLabel}`,
                    Author: 'Diligent Code Insight',
                    Subject: `${docTypeLabel} for ${sourceResult.objectName}`
                }
            });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => {
                const buffer = Buffer.concat(chunks);
                resolve({
                    fileName,
                    base64Content: buffer.toString('base64'),
                    fileSize: buffer.length
                });
            });
            doc.on('error', reject);

            const pageWidth = doc.page.width - 144; // Content width

            // ─── Cover Page ───
            doc.moveDown(4);
            doc.fontSize(28).fillColor('#1F4E79')
               .text(analysis.documentTitle || `${sourceResult.objectName} - ${docTypeLabel}`, { align: 'center' });
            doc.moveDown(1);
            doc.fontSize(14).fillColor('#666666')
               .text(`SAP ABAP Object: ${sourceResult.objectName}`, { align: 'center' });

            // Document Metadata Table
            if (analysis.documentMetadata && analysis.documentMetadata.length > 0) {
                doc.moveDown(1.5);
                const tableLeft = 120;
                const labelWidth = 180;
                const valueWidth = 280;
                let tableY = doc.y;
                const rowHeight = 22;

                for (const item of analysis.documentMetadata) {
                    doc.fontSize(10).fillColor('#333333');
                    doc.rect(tableLeft, tableY, labelWidth, rowHeight).stroke('#999999');
                    doc.rect(tableLeft + labelWidth, tableY, valueWidth, rowHeight).stroke('#999999');
                    doc.font('Helvetica-Bold').text(String(item.label || ''), tableLeft + 5, tableY + 6, { width: labelWidth - 10 });
                    doc.font('Helvetica').text(String(item.value || ''), tableLeft + labelWidth + 5, tableY + 6, { width: valueWidth - 10 });
                    tableY += rowHeight;
                }

                doc.y = tableY + 10;
            }

            doc.moveDown(1);
            doc.fontSize(11).fillColor('#888888')
               .text('Generated by Diligent Code Insight', { align: 'center' });

            doc.addPage();

            // ─── Helper functions ───
            const addHeading1 = (text) => {
                doc.moveDown(0.5);
                doc.fontSize(18).fillColor('#1F4E79').text(text);
                doc.moveDown(0.3);
            };
            const addHeading2 = (text) => {
                doc.moveDown(0.3);
                doc.fontSize(14).fillColor('#2E75B6').text(text);
                doc.moveDown(0.2);
            };
            const addBody = (text) => {
                doc.fontSize(10).fillColor('#333333').text(text || '', { lineGap: 3 });
                doc.moveDown(0.3);
            };

            // ─── 1. Executive Summary ───
            addHeading1('1. Executive Summary');
            addBody(analysis.executiveSummary);

            // ─── 2. Business Overview ───
            if (analysis.businessOverview) {
                addHeading1('2. Business Overview');
                addHeading2('Purpose');
                addBody(analysis.businessOverview.purpose);
                addHeading2('Business Process');
                addBody(analysis.businessOverview.businessProcess);
                addHeading2('SAP Module');
                addBody(analysis.businessOverview.module);
                addHeading2('Business Benefit');
                addBody(analysis.businessOverview.businessBenefit);
            }

            // ─── 3. Functional Requirements ───
            if (analysis.functionalRequirements?.length > 0) {
                doc.addPage();
                addHeading1('3. Functional Requirements');
                for (const req of analysis.functionalRequirements) {
                    addHeading2(`${req.reqId}: ${req.title}`);
                    addBody(req.description);
                    if (req.businessRule) {
                        doc.fontSize(10).fillColor('#555555')
                           .text(`Business Rule: ${req.businessRule}`, { indent: 20 });
                    }
                    doc.fontSize(10).fillColor('#888888')
                       .text(`Priority: ${req.priority || 'Medium'}`, { indent: 20 });
                    doc.moveDown(0.3);
                }
            }

            // ─── 4. Business Rules ───
            if (analysis.businessRules?.length > 0) {
                doc.addPage();
                addHeading1('4. Business Rules');
                for (const rule of analysis.businessRules) {
                    addHeading2(`${rule.ruleId}: ${rule.ruleName}`);
                    addBody(rule.description);
                    if (rule.condition) addBody(`Condition: ${rule.condition}`);
                    if (rule.action) addBody(`Action: ${rule.action}`);
                }
            }

            // ─── 5. Integration Points ───
            if (analysis.integrationPoints?.length > 0) {
                addHeading1('5. Integration Points');
                for (const ip of analysis.integrationPoints) {
                    doc.fontSize(10).fillColor('#333333')
                       .text(`${ip.system} (${ip.type} - ${ip.direction}): ${ip.description}`);
                    doc.moveDown(0.2);
                }
            }

            // ─── 6. Test Scenarios ───
            if (analysis.testScenarios?.length > 0) {
                doc.addPage();
                addHeading1('6. Test Scenarios');
                for (const ts of analysis.testScenarios) {
                    addHeading2(`${ts.scenarioId}: ${ts.title}`);
                    if (ts.precondition) addBody(`Precondition: ${ts.precondition}`);
                    if (ts.steps) addBody(`Steps: ${ts.steps}`);
                    if (ts.expectedResult) addBody(`Expected: ${ts.expectedResult}`);
                }
            }

            doc.end();
        });
    }

    /**
     * Helper: Create a formatted table for DOCX
     * Robust against mismatched row/header lengths from AI response
     */
    _createTable(headers, rows, colWidths, ctx) {
        const { borders, cellMargins, headerShading, altRowShading,
                TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType } = ctx;

        // Ensure headers is a valid array
        if (!Array.isArray(headers) || headers.length === 0) {
            return new Paragraph({ children: [new TextRun('[Empty table]')] });
        }

        const numCols = headers.length;
        const tableWidth = colWidths.reduce((sum, w) => sum + w, 0);

        // Header row
        const headerRow = new TableRow({
            children: headers.map((h, i) => new TableCell({
                borders,
                width: { size: colWidths[i] || Math.floor(9360 / numCols), type: WidthType.DXA },
                shading: headerShading,
                margins: cellMargins,
                children: [new Paragraph({
                    children: [new TextRun({ text: String(h || ''), bold: true, color: 'FFFFFF', size: 20, font: 'Calibri' })]
                })]
            }))
        });

        // Data rows - normalize each row to have exactly numCols cells
        const safeRows = (Array.isArray(rows) ? rows : []).filter(row => Array.isArray(row));
        const dataRows = safeRows.map((row, rowIdx) => {
            // Pad or truncate row to match header column count
            const normalizedRow = [];
            for (let i = 0; i < numCols; i++) {
                normalizedRow.push(String(row[i] != null ? row[i] : ''));
            }

            return new TableRow({
                children: normalizedRow.map((cell, i) => new TableCell({
                    borders,
                    width: { size: colWidths[i] || Math.floor(9360 / numCols), type: WidthType.DXA },
                    shading: rowIdx % 2 === 1 ? altRowShading : undefined,
                    margins: cellMargins,
                    children: [new Paragraph({
                        children: [new TextRun({ text: cell, size: 18, font: 'Calibri' })]
                    })]
                }))
            });
        });

        return new Table({
            width: { size: tableWidth, type: WidthType.DXA },
            columnWidths: colWidths,
            rows: [headerRow, ...dataRows]
        });
    }
}

module.exports = DocumentGenerator;

