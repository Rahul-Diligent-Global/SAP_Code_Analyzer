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
    async generateDOCX(analysis, sourceResult, options) {
        const {
            Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
            Header, Footer, AlignmentType, HeadingLevel, BorderStyle,
            WidthType, ShadingType, PageNumber, PageBreak, LevelFormat,
            TableOfContents
        } = require('docx');

        const fileName = `BRD_${sourceResult.objectName}_${Date.now()}.docx`;
        const includeCode = options?.includeCode !== false;

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
            new Paragraph({ spacing: { before: 3000 } }),
            new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({
                    text: analysis.documentTitle || 'Business Requirements Document',
                    bold: true, size: 56, font: 'Calibri', color: '1F4E79'
                })]
            }),
            new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER,
                children: [new TextRun({
                    text: `SAP ABAP Object: ${sourceResult.objectName}`,
                    size: 28, color: '666666'
                })]
            }),
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
                    text: `Date: ${analysis.preparedDate || new Date().toLocaleDateString()}`,
                    size: 22, color: '666666'
                })]
            }),
            new Paragraph({ alignment: AlignmentType.CENTER,
                children: [new TextRun({
                    text: `Generated by AI Code Analyzer (Claude)`,
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
        // 11. APPENDIX
        // ═══════════════════════════════════════════════════════════
        if (analysis.appendix) {
            children.push(
                new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('11. Appendix')] })
            );

            if (analysis.appendix.technicalNotes) {
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('11.1 Technical Notes')] }),
                    new Paragraph({ children: [new TextRun(analysis.appendix.technicalNotes)] })
                );
            }

            if (analysis.appendix.assumptions?.length > 0) {
                children.push(
                    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('11.2 Assumptions')] })
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
                    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('11.3 Open Questions')] })
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

        // ─── Assemble Document ───
        doc.addSection({
            properties: {
                page: {
                    size: { width: 12240, height: 15840 },
                    margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
                }
            },
            headers: {
                default: new Header({
                    children: [new Paragraph({
                        alignment: AlignmentType.RIGHT,
                        children: [new TextRun({
                            text: `BRD - ${sourceResult.objectName}`,
                            size: 18, color: '999999', italics: true
                        })]
                    })]
                })
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
        const fileName = `BRD_${sourceResult.objectName}_${Date.now()}.pdf`;

        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({
                size: 'A4',
                margins: { top: 72, bottom: 72, left: 72, right: 72 },
                info: {
                    Title: analysis.documentTitle || 'Business Requirements Document',
                    Author: 'AI Code Analyzer',
                    Subject: `BRD for ${sourceResult.objectName}`
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
            doc.moveDown(6);
            doc.fontSize(28).fillColor('#1F4E79')
               .text(analysis.documentTitle || 'Business Requirements Document', { align: 'center' });
            doc.moveDown(1);
            doc.fontSize(14).fillColor('#666666')
               .text(`SAP ABAP Object: ${sourceResult.objectName}`, { align: 'center' });
            doc.fontSize(12)
               .text(sourceResult.title || '', { align: 'center' });
            doc.moveDown(2);
            doc.fontSize(11).fillColor('#888888')
               .text(`Version: ${analysis.documentVersion || '1.0'}`, { align: 'center' })
               .text(`Date: ${analysis.preparedDate || new Date().toLocaleDateString()}`, { align: 'center' })
               .text('Generated by AI Code Analyzer (Claude)', { align: 'center' });

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
     */
    _createTable(headers, rows, colWidths, ctx) {
        const { borders, cellMargins, headerShading, altRowShading,
                TableRow, TableCell, Table, Paragraph, TextRun, WidthType, ShadingType, AlignmentType } = ctx;

        const tableWidth = colWidths.reduce((sum, w) => sum + w, 0);

        // Header row
        const headerRow = new TableRow({
            children: headers.map((h, i) => new TableCell({
                borders,
                width: { size: colWidths[i], type: WidthType.DXA },
                shading: headerShading,
                margins: cellMargins,
                children: [new Paragraph({
                    children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 20, font: 'Calibri' })]
                })]
            }))
        });

        // Data rows
        const dataRows = rows.map((row, rowIdx) => new TableRow({
            children: row.map((cell, i) => new TableCell({
                borders,
                width: { size: colWidths[i], type: WidthType.DXA },
                shading: rowIdx % 2 === 1 ? altRowShading : undefined,
                margins: cellMargins,
                children: [new Paragraph({
                    children: [new TextRun({ text: String(cell || ''), size: 18, font: 'Calibri' })]
                })]
            }))
        }));

        return new Table({
            width: { size: tableWidth, type: WidthType.DXA },
            columnWidths: colWidths,
            rows: [headerRow, ...dataRows]
        });
    }
}

module.exports = DocumentGenerator;

