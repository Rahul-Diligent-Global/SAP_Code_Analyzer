sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/BusyDialog",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Label",
    "sap/m/Input",
    "sap/m/Select",
    "sap/m/TextArea",
    "sap/m/CheckBox",
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/Text",
    "sap/m/Title",
    "sap/m/Table",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/m/Toolbar",
    "sap/m/ToolbarSpacer",
    "sap/m/ObjectStatus",
    "sap/m/Switch",
    "sap/ui/core/Item",
    "sap/ui/layout/form/SimpleForm"
], function (Controller, JSONModel, MessageBox, MessageToast, BusyDialog,
             Dialog, Button, Label, Input, Select, TextArea, CheckBox, VBox, HBox, Text, Title,
             Table, Column, ColumnListItem, Toolbar, ToolbarSpacer, ObjectStatus, Switch,
             Item, SimpleForm) {
    "use strict";

    return Controller.extend("com.sap.codeinsight.controller.ObjectDetail", {

        onInit: function () {
            this._oViewModel = this.getOwnerComponent().getModel("viewModel");
            this._oBusyDialog = new BusyDialog({ title: "Processing..." });

            // Template model for managing document templates
            this._oTemplateModel = new JSONModel({
                templates: [],
                newTemplate: {}
            });

            // Register route matched handler
            this.getOwnerComponent().getRouter()
                .getRoute("ObjectDetail")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        /**
         * Route matched - load source code
         */
        _onRouteMatched: function (oEvent) {
            var sObjectName = decodeURIComponent(oEvent.getParameter("arguments").objectName);
            var sCategory = oEvent.getParameter("arguments").category;

            // Reset state
            this._oViewModel.setProperty("/analysis", null);
            this._oViewModel.setProperty("/analysisHtml", "");
            this._oViewModel.setProperty("/formattedCode", "// Loading source code...");

            // Store current object info
            this._sObjectName = sObjectName;
            this._sCategory = sCategory;

            // Fetch source code
            this._loadSourceCode(sObjectName, sCategory);
        },

        /**
         * Load source code from SAP via CAP action
         * Includes CSRF token retry logic for Application Router protection
         */
        _loadSourceCode: function (sObjectName, sCategory, bRetry) {
            var that = this;
            var oModel = this.getOwnerComponent().getModel();

            this._oViewModel.setProperty("/busy", true);

            var oContext = oModel.bindContext("/getSourceCode(...)");
            oContext.setParameter("objectName", sObjectName);
            oContext.setParameter("category", sCategory);

            oContext.execute().then(function () {
                var oResult = oContext.getBoundContext().getObject();

                that._oViewModel.setProperty("/objectDetail", {
                    objectName: oResult.objectName,
                    title: oResult.title,
                    objectType: oResult.objectType,
                    package: oResult.package || "",
                    author: oResult.author || "",
                    createdOn: oResult.createdOn,
                    totalLines: oResult.totalLines
                });

                that._oViewModel.setProperty("/sourceCode", oResult.sourceCode || []);
                that._oViewModel.setProperty("/includes", oResult.includes || []);

                that._formatCodeForEditor(oResult.sourceCode);
                that._populateSectionFilter(oResult.sourceCode);
                that._oViewModel.setProperty("/busy", false);

            }).catch(function (oError) {
                // Handle CSRF token expiry (403) - refresh token and retry once
                if (!bRetry && oError.statusCode === 403) {
                    that._refreshCSRFTokenAndRetry(function () {
                        that._loadSourceCode(sObjectName, sCategory, true);
                    });
                    return;
                }
                that._oViewModel.setProperty("/busy", false);
                MessageBox.error("Failed to load source code: " + (oError.message || "Unknown error"));
            });
        },

        _formatCodeForEditor: function (aSourceCode, sSectionFilter) {
            if (!aSourceCode || aSourceCode.length === 0) {
                this._oViewModel.setProperty("/formattedCode", "* No source code available");
                return;
            }

            var aLines = [];
            var sCurrentSection = "";

            for (var i = 0; i < aSourceCode.length; i++) {
                var oLine = aSourceCode[i];

                if (sSectionFilter && sSectionFilter !== "ALL" && oLine.section !== sSectionFilter) {
                    continue;
                }

                if (oLine.section !== sCurrentSection) {
                    sCurrentSection = oLine.section;
                    aLines.push("*" + "=".repeat(68));
                    aLines.push("* SECTION: " + sCurrentSection);
                    aLines.push("* Include: " + oLine.includeName);
                    aLines.push("*" + "=".repeat(68));
                }

                aLines.push(oLine.sourceLine);
            }

            this._oViewModel.setProperty("/formattedCode", aLines.join("\n"));
        },

        _populateSectionFilter: function (aSourceCode) {
            var oSelect = this.byId("sectionFilter");
            if (!oSelect) return;

            var aSections = [];
            var oSeen = {};
            for (var i = 0; i < aSourceCode.length; i++) {
                if (!oSeen[aSourceCode[i].section]) {
                    oSeen[aSourceCode[i].section] = true;
                    aSections.push(aSourceCode[i].section);
                }
            }

            oSelect.removeAllItems();
            oSelect.addItem(new Item({ key: "ALL", text: "All Sections" }));
            aSections.forEach(function (s) {
                oSelect.addItem(new Item({ key: s, text: s }));
            });
        },

        onSectionFilter: function (oEvent) {
            var sKey = oEvent.getParameter("selectedItem").getKey();
            var aSourceCode = this._oViewModel.getProperty("/sourceCode");
            this._formatCodeForEditor(aSourceCode, sKey);
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("ObjectList");
        },

        onCopyCode: function () {
            var sCode = this._oViewModel.getProperty("/formattedCode");
            if (navigator.clipboard) {
                navigator.clipboard.writeText(sCode).then(function () {
                    MessageToast.show("Code copied to clipboard!");
                });
            }
        },

        onToggleLineNumbers: function (oEvent) {
            var bPressed = oEvent.getParameter("pressed");
            this.byId("codeEditor").setLineNumbers(bPressed);
        },

        onIncludePress: function (oEvent) {
            var oItem = oEvent.getSource();
            var oContext = oItem.getBindingContext("viewModel");
            var sSection = oContext.getProperty("includeType");

            var oSelect = this.byId("sectionFilter");
            oSelect.setSelectedKey(sSection);
            var aSourceCode = this._oViewModel.getProperty("/sourceCode");
            this._formatCodeForEditor(aSourceCode, sSection);
            MessageToast.show("Showing section: " + sSection);
        },

        // ═══════════════════════════════════════════════════════════
        // CLAUDE AI ANALYSIS
        // ═══════════════════════════════════════════════════════════

        onAnalyzeCode: function (bRetry) {
            var that = this;
            this._oBusyDialog.setText("Analyzing code with Diligent AI...\n\nThis may take a moment...");
            this._oBusyDialog.open();

            var oModel = this.getOwnerComponent().getModel();
            var oContext = oModel.bindContext("/analyzeCode(...)");
            oContext.setParameter("objectName", this._sObjectName);
            oContext.setParameter("category", this._sCategory);
            oContext.setParameter("analysisType", "BRD");

            oContext.execute().then(function () {
                var oResult = oContext.getBoundContext().getObject();
                that._oBusyDialog.close();

                // The CDS action returns a String (JSON-encoded)
                var sResult = oResult.value || oResult;
                var sJsonText = (typeof sResult === "string") ? sResult : JSON.stringify(sResult);

                try {
                    var oAnalysis = JSON.parse(sJsonText);
                    that._oViewModel.setProperty("/analysis", oAnalysis);
                    that._displayAnalysis(oAnalysis);
                } catch (e) {
                    that._oViewModel.setProperty("/analysis", { raw: sJsonText });
                    that._oViewModel.setProperty("/analysisHtml",
                        "<pre style='white-space:pre-wrap;font-size:13px;'>" + that._escapeHtml(sJsonText) + "</pre>");
                }

            }).catch(function (oError) {
                // Handle CSRF token expiry (403) - refresh and retry once
                if (!bRetry && oError.statusCode === 403) {
                    that._oBusyDialog.close();
                    that._refreshCSRFTokenAndRetry(function () {
                        that.onAnalyzeCode(true);
                    });
                    return;
                }
                that._oBusyDialog.close();
                MessageBox.error("Analysis failed: " + (oError.message || "Unknown error"));
            });
        },

        /**
         * Display structured analysis as rich HTML
         */
        _displayAnalysis: function (oAnalysis) {
            var aHtml = [];

            // Document Title
            if (oAnalysis.documentTitle) {
                aHtml.push("<div style='text-align:center;margin-bottom:20px;'>");
                aHtml.push("<h2 style='color:#1F4E79;margin-bottom:4px;'>" + this._escapeHtml(oAnalysis.documentTitle) + "</h2>");
                if (oAnalysis.documentVersion) {
                    aHtml.push("<span style='color:#888;'>Version " + this._escapeHtml(oAnalysis.documentVersion) + "</span>");
                }
                if (oAnalysis.modelUsed) {
                    aHtml.push(" &middot; <span style='color:#888;'>Model: " + this._escapeHtml(oAnalysis.modelUsed) + "</span>");
                }
                aHtml.push("</div>");
            }

            // Executive Summary
            if (oAnalysis.executiveSummary) {
                aHtml.push(this._sectionHeader("Executive Summary"));
                aHtml.push("<p style='line-height:1.6;'>" + this._escapeHtml(oAnalysis.executiveSummary) + "</p>");
            }

            // Business Overview
            if (oAnalysis.businessOverview) {
                var bo = oAnalysis.businessOverview;
                aHtml.push(this._sectionHeader("Business Overview"));
                if (bo.purpose) aHtml.push("<p><strong style='color:#2E75B6;'>Purpose:</strong> " + this._escapeHtml(bo.purpose) + "</p>");
                if (bo.businessProcess) aHtml.push("<p><strong style='color:#2E75B6;'>Business Process:</strong> " + this._escapeHtml(bo.businessProcess) + "</p>");
                if (bo.module) aHtml.push("<p><strong style='color:#2E75B6;'>SAP Module:</strong> " + this._escapeHtml(bo.module) + "</p>");
                if (bo.businessBenefit) aHtml.push("<p><strong style='color:#2E75B6;'>Business Benefit:</strong> " + this._escapeHtml(bo.businessBenefit) + "</p>");
                if (bo.stakeholders && bo.stakeholders.length > 0) {
                    aHtml.push("<p><strong style='color:#2E75B6;'>Stakeholders:</strong> " + bo.stakeholders.map(this._escapeHtml).join(", ") + "</p>");
                }
            }

            // Functional Requirements
            if (oAnalysis.functionalRequirements && oAnalysis.functionalRequirements.length > 0) {
                aHtml.push(this._sectionHeader("Functional Requirements"));
                aHtml.push(this._htmlTable(
                    ["ID", "Title", "Description", "Business Rule", "Priority"],
                    oAnalysis.functionalRequirements.map(function (r) { return [r.reqId, r.title, r.description, r.businessRule, r.priority]; }),
                    ["8%", "15%", "32%", "30%", "10%"]
                ));
            }

            // Data Specification
            if (oAnalysis.dataSpecification) {
                var ds = oAnalysis.dataSpecification;
                aHtml.push(this._sectionHeader("Data Specification"));

                if (ds.tablesUsed && ds.tablesUsed.length > 0) {
                    aHtml.push("<h4 style='color:#404040;margin:12px 0 6px 0;'>SAP Tables Used</h4>");
                    aHtml.push(this._htmlTable(
                        ["Table", "Description", "Usage", "Business Entity"],
                        ds.tablesUsed.map(function (t) { return [t.tableName, t.tableDescription, t.usage, t.businessEntity]; }),
                        ["15%", "30%", "15%", "40%"]
                    ));
                }
                if (ds.inputData && ds.inputData.length > 0) {
                    aHtml.push("<h4 style='color:#404040;margin:12px 0 6px 0;'>Input Data</h4>");
                    aHtml.push(this._htmlTable(
                        ["Field", "SAP Table", "Business Meaning", "Mandatory", "Validation"],
                        ds.inputData.map(function (d) { return [d.fieldName, d.sapTable, d.businessMeaning, d.mandatory ? "Yes" : "No", d.validationRules]; }),
                        ["15%", "15%", "30%", "10%", "30%"]
                    ));
                }
                if (ds.outputData && ds.outputData.length > 0) {
                    aHtml.push("<h4 style='color:#404040;margin:12px 0 6px 0;'>Output Data</h4>");
                    aHtml.push(this._htmlTable(
                        ["Field", "Description", "Format", "Business Use"],
                        ds.outputData.map(function (d) { return [d.fieldName, d.description, d.format, d.businessUse]; }),
                        ["15%", "30%", "15%", "40%"]
                    ));
                }
            }

            // Selection Screen
            if (oAnalysis.selectionScreen) {
                aHtml.push(this._sectionHeader("Selection Screen"));
                if (oAnalysis.selectionScreen.description) aHtml.push("<p>" + this._escapeHtml(oAnalysis.selectionScreen.description) + "</p>");
                if (oAnalysis.selectionScreen.parameters && oAnalysis.selectionScreen.parameters.length > 0) {
                    aHtml.push(this._htmlTable(
                        ["Parameter", "Type", "Description", "Mandatory", "Default"],
                        oAnalysis.selectionScreen.parameters.map(function (p) { return [p.paramName, p.type, p.description, p.mandatory ? "Yes" : "No", p.defaultValue]; }),
                        ["15%", "12%", "38%", "10%", "20%"]
                    ));
                }
            }

            // Business Rules
            if (oAnalysis.businessRules && oAnalysis.businessRules.length > 0) {
                aHtml.push(this._sectionHeader("Business Rules"));
                aHtml.push(this._htmlTable(
                    ["Rule ID", "Rule Name", "Description", "Condition", "Action"],
                    oAnalysis.businessRules.map(function (r) { return [r.ruleId, r.ruleName, r.description, r.condition, r.action]; }),
                    ["10%", "15%", "30%", "20%", "25%"]
                ));
            }

            // Integration Points
            if (oAnalysis.integrationPoints && oAnalysis.integrationPoints.length > 0) {
                aHtml.push(this._sectionHeader("Integration Points"));
                aHtml.push(this._htmlTable(
                    ["System", "Type", "Direction", "Description", "Data Exchanged"],
                    oAnalysis.integrationPoints.map(function (ip) { return [ip.system, ip.type, ip.direction, ip.description, ip.dataExchanged]; }),
                    ["15%", "12%", "12%", "33%", "28%"]
                ));
            }

            // Authorization
            if (oAnalysis.authorization) {
                aHtml.push(this._sectionHeader("Authorization & Security"));
                if (oAnalysis.authorization.description) aHtml.push("<p>" + this._escapeHtml(oAnalysis.authorization.description) + "</p>");
                if (oAnalysis.authorization.checks && oAnalysis.authorization.checks.length > 0) {
                    aHtml.push(this._htmlTable(
                        ["Auth Object", "Description", "Fields Checked"],
                        oAnalysis.authorization.checks.map(function (a) { return [a.authObject, a.description, a.fields]; }),
                        ["25%", "40%", "35%"]
                    ));
                }
            }

            // Error Handling
            if (oAnalysis.errorHandling && oAnalysis.errorHandling.length > 0) {
                aHtml.push(this._sectionHeader("Error Handling"));
                aHtml.push(this._htmlTable(
                    ["Error Code", "Description", "Business Impact", "Resolution"],
                    oAnalysis.errorHandling.map(function (e) { return [e.errorCode, e.description, e.businessImpact, e.resolution]; }),
                    ["12%", "28%", "30%", "30%"]
                ));
            }

            // Test Scenarios
            if (oAnalysis.testScenarios && oAnalysis.testScenarios.length > 0) {
                aHtml.push(this._sectionHeader("Test Scenarios"));
                aHtml.push(this._htmlTable(
                    ["ID", "Title", "Precondition", "Steps", "Expected Result"],
                    oAnalysis.testScenarios.map(function (t) { return [t.scenarioId, t.title, t.precondition, t.steps, t.expectedResult]; }),
                    ["8%", "15%", "22%", "28%", "27%"]
                ));
            }

            // Appendix
            if (oAnalysis.appendix) {
                aHtml.push(this._sectionHeader("Appendix"));
                if (oAnalysis.appendix.technicalNotes) {
                    aHtml.push("<h4 style='color:#404040;margin:8px 0 4px;'>Technical Notes</h4>");
                    aHtml.push("<p style='color:#555;'>" + this._escapeHtml(oAnalysis.appendix.technicalNotes) + "</p>");
                }
                if (oAnalysis.appendix.assumptions && oAnalysis.appendix.assumptions.length > 0) {
                    aHtml.push("<h4 style='color:#404040;margin:8px 0 4px;'>Assumptions</h4><ul>");
                    oAnalysis.appendix.assumptions.forEach(function (a) { aHtml.push("<li>" + this._escapeHtml(a) + "</li>"); }.bind(this));
                    aHtml.push("</ul>");
                }
                if (oAnalysis.appendix.openQuestions && oAnalysis.appendix.openQuestions.length > 0) {
                    aHtml.push("<h4 style='color:#404040;margin:8px 0 4px;'>Open Questions</h4><ol>");
                    oAnalysis.appendix.openQuestions.forEach(function (q) { aHtml.push("<li>" + this._escapeHtml(q) + "</li>"); }.bind(this));
                    aHtml.push("</ol>");
                }
            }

            // Fallback: raw analysis
            if (oAnalysis.rawAnalysis) {
                aHtml.push(this._sectionHeader("Raw Analysis"));
                aHtml.push("<pre style='white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:4px;font-size:13px;'>" +
                    this._escapeHtml(oAnalysis.rawAnalysis) + "</pre>");
            }

            this._oViewModel.setProperty("/analysisHtml", aHtml.join(""));
        },

        _sectionHeader: function (sTitle) {
            return "<h3 style='color:#1F4E79;border-bottom:2px solid #0a6ed1;padding-bottom:6px;margin:20px 0 10px;'>" +
                this._escapeHtml(sTitle) + "</h3>";
        },

        _htmlTable: function (aHeaders, aRows, aWidths) {
            var that = this;
            var a = ["<table style='width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:13px;'>"];
            a.push("<tr>");
            aHeaders.forEach(function (h, i) {
                var w = aWidths && aWidths[i] ? "width:" + aWidths[i] + ";" : "";
                a.push("<th style='" + w + "background:#1F4E79;color:#fff;padding:8px 10px;text-align:left;font-weight:600;'>" + that._escapeHtml(h) + "</th>");
            });
            a.push("</tr>");
            aRows.forEach(function (row, ri) {
                var bg = ri % 2 === 1 ? "background:#F2F7FB;" : "";
                a.push("<tr style='" + bg + "'>");
                row.forEach(function (cell, ci) {
                    var w = aWidths && aWidths[ci] ? "width:" + aWidths[ci] + ";" : "";
                    a.push("<td style='" + w + "padding:6px 10px;border-bottom:1px solid #e0e0e0;vertical-align:top;'>" + that._escapeHtml(cell || "") + "</td>");
                });
                a.push("</tr>");
            });
            a.push("</table>");
            return a.join("");
        },

        // ═══════════════════════════════════════════════════════════
        // DOCUMENT GENERATION
        // ═══════════════════════════════════════════════════════════

        onGenerateDocx: function () { this._showGenerateDialog("DOCX", "BRD"); },
        onGeneratePdf: function () { this._showGenerateDialog("PDF", "BRD"); },
        onGenerateFuncSpec: function () { this._showGenerateDialog("DOCX", "FUNC_SPEC"); },
        onGenerateTechSpec: function () { this._showGenerateDialog("DOCX", "TECH_SPEC"); },
        onGenerateCodeReview: function () { this._showGenerateDialog("DOCX", "CODE_REVIEW"); },

        _showGenerateDialog: function (sDocType, sTemplate) {
            var that = this;

            var aTemplateItems = [
                new Item({ key: "", text: "Default Template" })
            ];

            // Load templates from backend
            var oModel = this.getOwnerComponent().getModel();
            try {
                var oListBinding = oModel.bindList("/DocumentTemplates", null, null, [
                    new sap.ui.model.Filter("isActive", "EQ", true)
                ]);
                oListBinding.requestContexts(0, 50).then(function (aContexts) {
                    aContexts.forEach(function (oCtx) {
                        var oTpl = oCtx.getObject();
                        var oSel = sap.ui.getCore().byId("templateSelect");
                        if (oSel) {
                            oSel.addItem(new Item({
                                key: oTpl.ID,
                                text: oTpl.templateName + " (" + oTpl.templateType + ")"
                            }));
                        }
                    });
                });
            } catch (e) { /* templates not available */ }

            var sDialogTitle = "Generate ";
            switch (sTemplate) {
                case "FUNC_SPEC": sDialogTitle += "Functional Specification"; break;
                case "TECH_SPEC": sDialogTitle += "Technical Specification"; break;
                case "CODE_REVIEW": sDialogTitle += "Code Review Report"; break;
                default: sDialogTitle += "BRD Document"; break;
            }

            var oDialog = new Dialog({
                title: sDialogTitle,
                type: "Message",
                contentWidth: "520px",
                content: [
                    new VBox({
                        class: "sapUiSmallMargin",
                        items: [
                            new Label({ text: "Document Template:", design: "Bold" }),
                            new Select("templateSelect", { selectedKey: "", width: "100%", items: aTemplateItems }),

                            new Label({ text: "Document Type:", design: "Bold", class: "sapUiSmallMarginTop" }),
                            new Select("docTypeSelect", {
                                selectedKey: sTemplate || "BRD", width: "100%",
                                items: [
                                    new Item({ key: "BRD", text: "Business Requirements Document" }),
                                    new Item({ key: "FUNC_SPEC", text: "Functional Specification" }),
                                    new Item({ key: "TECH_SPEC", text: "Technical Specification" }),
                                    new Item({ key: "CODE_REVIEW", text: "Code Review Report" })
                                ]
                            }),

                            new Label({ text: "Document Format:", design: "Bold", class: "sapUiSmallMarginTop" }),
                            new Select("docFormatSelect", {
                                selectedKey: sDocType, width: "100%",
                                items: [
                                    new Item({ key: "DOCX", text: "Word Document (.docx)" }),
                                    new Item({ key: "PDF", text: "PDF Document (.pdf)" })
                                ]
                            }),

                            new Label({ text: "Detail Level:", design: "Bold", class: "sapUiSmallMarginTop" }),
                            new Select("detailLevelSelect", {
                                selectedKey: "DETAILED", width: "100%",
                                items: [
                                    new Item({ key: "SUMMARY", text: "Summary (2-3 pages)" }),
                                    new Item({ key: "DETAILED", text: "Detailed (5-10 pages)" }),
                                    new Item({ key: "COMPREHENSIVE", text: "Comprehensive (10+ pages)" })
                                ]
                            }),

                            new CheckBox("includeCodeCheck", { text: "Include Source Code in Appendix", selected: true, class: "sapUiSmallMarginTop" }),

                            new Label({ text: "Custom Instructions (Optional):", design: "Bold", class: "sapUiSmallMarginTop" }),
                            new TextArea("customPromptArea", {
                                placeholder: "Add any specific instructions for the AI...\nE.g., 'Focus on the MM module integration'",
                                width: "100%", rows: 3
                            })
                        ]
                    })
                ],
                beginButton: new Button({
                    text: "Generate", type: "Emphasized", icon: "sap-icon://create",
                    press: function () {
                        var sFormat = sap.ui.getCore().byId("docFormatSelect").getSelectedKey();
                        var sDetailLevel = sap.ui.getCore().byId("detailLevelSelect").getSelectedKey();
                        var bIncludeCode = sap.ui.getCore().byId("includeCodeCheck").getSelected();
                        var sCustomPrompt = sap.ui.getCore().byId("customPromptArea").getValue();
                        var sTemplateId = sap.ui.getCore().byId("templateSelect").getSelectedKey();
                        var sDocTypeKey = sap.ui.getCore().byId("docTypeSelect").getSelectedKey();
                        oDialog.close();
                        that._executeDocumentGeneration(sFormat, sDetailLevel, bIncludeCode, sCustomPrompt, sTemplateId, sDocTypeKey);
                    }
                }),
                endButton: new Button({ text: "Cancel", press: function () { oDialog.close(); } }),
                afterClose: function () { oDialog.destroy(); }
            });

            oDialog.open();
        },

        _executeDocumentGeneration: function (sFormat, sDetailLevel, bIncludeCode, sCustomPrompt, sTemplateId, sAnalysisType, bRetry) {
            var that = this;

            // Look up reference content from local template model
            var sReferenceContent = "";
            if (sTemplateId) {
                var aTemplates = this._oTemplateModel.getProperty("/templates") || [];
                for (var i = 0; i < aTemplates.length; i++) {
                    if (aTemplates[i].ID === sTemplateId && aTemplates[i].referenceContent) {
                        sReferenceContent = aTemplates[i].referenceContent;
                        break;
                    }
                }
            }

            this._oBusyDialog.setText(
                "Generating document...\n\n" +
                "Step 1: Fetching source code from SAP\n" +
                "Step 2: Analyzing code with Diligent AI\n" +
                "Step 3: Creating " + sFormat + " document\n\n" +
                "This may take 30-60 seconds..."
            );
            this._oBusyDialog.open();

            var oModel = this.getOwnerComponent().getModel();
            var oContext = oModel.bindContext("/generateDocument(...)");

            oContext.setParameter("objectName", this._sObjectName);
            oContext.setParameter("category", this._sCategory);
            oContext.setParameter("options", {
                documentType: sFormat,
                analysisType: sAnalysisType || "BRD",
                includeCode: bIncludeCode,
                detailLevel: sDetailLevel,
                customPrompt: sCustomPrompt || "",
                templateId: sTemplateId || null,
                referenceContent: sReferenceContent || null
            });

            oContext.execute().then(function () {
                var oResult = oContext.getBoundContext().getObject();
                that._oBusyDialog.close();

                if (oResult.success) {
                    that._downloadFile(oResult.fileContent, oResult.fileName, oResult.fileType);
                    MessageToast.show(oResult.message || "Document generated successfully!");
                } else {
                    MessageBox.error("Document generation failed: " + (oResult.message || "Unknown error"));
                }
            }).catch(function (oError) {
                // Handle CSRF token expiry (403) - refresh and retry once
                if (!bRetry && oError.statusCode === 403) {
                    that._oBusyDialog.close();
                    that._refreshCSRFTokenAndRetry(function () {
                        that._executeDocumentGeneration(sFormat, sDetailLevel, bIncludeCode, sCustomPrompt, sTemplateId, sAnalysisType, true);
                    });
                    return;
                }
                that._oBusyDialog.close();
                MessageBox.error("Document generation failed: " + (oError.message || "Unknown error"));
            });
        },

        // ═══════════════════════════════════════════════════════════
        // TEMPLATE MANAGER
        // ═══════════════════════════════════════════════════════════

        onOpenTemplateManager: function () {
            if (!this._oTemplateDialog) {
                this._oTemplateDialog = this._createTemplateDialog();
            }
            this._loadTemplates();
            this._oTemplateDialog.open();
        },

        _createTemplateDialog: function () {
            var that = this;

            var oTemplateTable = new Table("templateListTable", {
                growing: true,
                growingThreshold: 20,
                mode: "None",
                alternateRowColors: true,
                headerToolbar: new Toolbar({
                    content: [
                        new Title({ text: "Document Templates", level: "H5" }),
                        new ToolbarSpacer(),
                        new Button({
                            text: "Create Template",
                            icon: "sap-icon://add",
                            type: "Emphasized",
                            press: function () { that._showCreateTemplateDialog(); }
                        })
                    ]
                }),
                columns: [
                    new Column({ width: "22%", header: new Text({ text: "Template Name" }) }),
                    new Column({ width: "12%", header: new Text({ text: "Type" }) }),
                    new Column({ width: "28%", header: new Text({ text: "Description" }) }),
                    new Column({ width: "10%", header: new Text({ text: "Active" }) }),
                    new Column({ width: "18%", header: new Text({ text: "Modified" }) }),
                    new Column({ width: "10%", header: new Text({ text: "Actions" }) })
                ]
            });

            oTemplateTable.setModel(this._oTemplateModel);
            oTemplateTable.bindItems({
                path: "/templates",
                template: new ColumnListItem({
                    cells: [
                        new Text({ text: "{templateName}" }),
                        new ObjectStatus({
                            text: "{templateType}",
                            state: "{= ${templateType} === 'BRD' ? 'Success' : ${templateType} === 'FUNC_SPEC' ? 'Information' : 'Warning'}"
                        }),
                        new Text({ text: "{description}", maxLines: 2 }),
                        new ObjectStatus({
                            text: "{= ${isActive} ? 'Yes' : 'No'}",
                            state: "{= ${isActive} ? 'Success' : 'None'}"
                        }),
                        new Text({ text: "{modifiedAt}" }),
                        new HBox({
                            items: [
                                new Button({
                                    icon: "sap-icon://edit",
                                    tooltip: "Edit Template",
                                    type: "Transparent",
                                    press: function (oEvt) {
                                        var sPath = oEvt.getSource().getParent().getParent().getBindingContextPath();
                                        var oTemplate = that._oTemplateModel.getProperty(sPath);
                                        that._showEditTemplateDialog(oTemplate, sPath);
                                    }
                                }),
                                new Button({
                                    icon: "sap-icon://delete",
                                    tooltip: "Delete Template",
                                    type: "Transparent",
                                    press: function (oEvt) {
                                        var sPath = oEvt.getSource().getParent().getParent().getBindingContextPath();
                                        var oTemplate = that._oTemplateModel.getProperty(sPath);
                                        that._deleteTemplate(oTemplate, sPath);
                                    }
                                })
                            ]
                        })
                    ]
                })
            });

            var oDialog = new Dialog({
                title: "Document Template Manager",
                contentWidth: "900px",
                contentHeight: "480px",
                resizable: true,
                draggable: true,
                content: [
                    new VBox({
                        class: "sapUiSmallMargin",
                        items: [
                            new sap.m.MessageStrip({
                                text: "Templates define how Diligent AI structures the BRD/Functional documents. Each customer/tenant can have their own templates with custom sections and prompts.",
                                type: "Information",
                                showIcon: true,
                                class: "sapUiSmallMarginBottom"
                            }),
                            oTemplateTable
                        ]
                    })
                ],
                endButton: new Button({
                    text: "Close",
                    press: function () { oDialog.close(); }
                })
            });

            return oDialog;
        },

        _loadTemplates: function () {
            var that = this;
            var oModel = this.getOwnerComponent().getModel();
            var aLocalTemplates = this._oTemplateModel.getProperty("/templates") || [];

            try {
                var oListBinding = oModel.bindList("/DocumentTemplates");
                oListBinding.requestContexts(0, 100).then(function (aContexts) {
                    var aBackendTemplates = aContexts.map(function (oCtx) {
                        return oCtx.getObject();
                    });

                    // Merge: backend templates + locally created ones (by ID)
                    var mIds = {};
                    var aMerged = [];
                    aBackendTemplates.forEach(function (t) { mIds[t.ID] = true; aMerged.push(t); });
                    aLocalTemplates.forEach(function (t) {
                        if (!mIds[t.ID]) { aMerged.push(t); }
                    });

                    if (aMerged.length === 0) {
                        that._loadMockTemplates();
                    } else {
                        that._oTemplateModel.setProperty("/templates", aMerged);
                    }
                }).catch(function () {
                    if (aLocalTemplates.length === 0) {
                        that._loadMockTemplates();
                    }
                });
            } catch (e) {
                if (aLocalTemplates.length === 0) {
                    that._loadMockTemplates();
                }
            }
        },

        _loadMockTemplates: function () {
            var aTemplates = this._oTemplateModel.getProperty("/templates");
            if (aTemplates.length === 0) {
                this._oTemplateModel.setProperty("/templates", [
                    {
                        ID: "tpl-default-brd",
                        templateName: "Standard BRD",
                        templateType: "BRD",
                        description: "Default Business Requirements Document template with all standard sections",
                        promptTemplate: "",
                        sections: "",
                        isActive: true,
                        modifiedAt: "2025-01-15"
                    },
                    {
                        ID: "tpl-func-spec",
                        templateName: "Functional Specification",
                        templateType: "FUNC_SPEC",
                        description: "Technical functional specification focused on SAP module integration",
                        promptTemplate: "Focus on technical implementation details, data flows, and SAP module integration points.",
                        sections: "",
                        isActive: true,
                        modifiedAt: "2025-01-20"
                    }
                ]);
            }
        },

        _showCreateTemplateDialog: function () {
            var that = this;

            var oDialog = new Dialog({
                title: "Create New Document Template",
                contentWidth: "600px",
                content: [
                    new SimpleForm({
                        editable: true,
                        layout: "ResponsiveGridLayout",
                        labelSpanXL: 4, labelSpanL: 4, labelSpanM: 4,
                        emptySpanXL: 0, emptySpanL: 0, emptySpanM: 0,
                        columnsXL: 1, columnsL: 1, columnsM: 1,
                        class: "sapUiSmallMargin",
                        content: [
                            new sap.ui.core.Title({ text: "Template Information" }),
                            new Label({ text: "Template Name", required: true }),
                            new Input("newTplName", { placeholder: "e.g., Acme Corp BRD Template" }),
                            new Label({ text: "Template Type" }),
                            new Select("newTplType", {
                                selectedKey: "BRD",
                                items: [
                                    new Item({ key: "BRD", text: "Business Requirements Document" }),
                                    new Item({ key: "FUNC_SPEC", text: "Functional Specification" }),
                                    new Item({ key: "TECH_SPEC", text: "Technical Specification" }),
                                    new Item({ key: "CODE_REVIEW", text: "Code Review Report" })
                                ]
                            }),
                            new Label({ text: "Description" }),
                            new TextArea("newTplDesc", {
                                placeholder: "Describe the purpose and target audience for this template",
                                rows: 2, width: "100%"
                            }),
                            new Label({ text: "Active" }),
                            new CheckBox("newTplActive", { selected: true, text: "Enable this template" }),

                            new sap.ui.core.Title({ text: "AI Prompt Instructions" }),
                            new Label({ text: "Custom Prompt" }),
                            new TextArea("newTplPrompt", {
                                placeholder: "Custom instructions for Diligent AI when using this template.\n\nExample:\n- Focus on SAP SD module integration points\n- Include data migration requirements\n- Use customer's terminology: 'Sales Order' instead of 'SO'",
                                rows: 6, width: "100%"
                            }),

                            new sap.ui.core.Title({ text: "Reference Document" }),
                            new Label({ text: "Upload Reference" }),
                            new VBox({
                                items: [
                                    new sap.m.MessageStrip({
                                        text: "Upload a reference document (.docx, .txt) and the AI will adopt its structure, tone, and formatting style when generating documents.",
                                        type: "Information", showIcon: true,
                                        class: "sapUiTinyMarginBottom"
                                    }),
                                    new sap.ui.unified.FileUploader("newTplRefFile", {
                                        name: "referenceFile",
                                        uploadOnChange: false,
                                        fileType: "txt,docx",
                                        placeholder: "Choose reference document (.docx or .txt)...",
                                        width: "100%",
                                        buttonText: "Browse",
                                        style: "Emphasized",
                                        change: function (oEvt) { that._onReferenceFileSelected(oEvt, "newTplRefContent", "newTplRefName"); }
                                    }),
                                    new Text("newTplRefName", { text: "", class: "sapUiTinyMarginTop" }),
                                    new TextArea("newTplRefContent", { visible: false, rows: 1, width: "100%" })
                                ]
                            }),

                            new sap.ui.core.Title({ text: "Document Sections (Advanced)" }),
                            new Label({ text: "Custom Sections JSON" }),
                            new TextArea("newTplSections", {
                                placeholder: "Optional: Paste custom JSON structure for document sections.\nLeave empty to use the default structure.",
                                rows: 5, width: "100%"
                            })
                        ]
                    })
                ],
                beginButton: new Button({
                    text: "Create Template",
                    type: "Emphasized",
                    icon: "sap-icon://create",
                    press: function () {
                        that._saveNewTemplate(oDialog);
                    }
                }),
                endButton: new Button({
                    text: "Cancel",
                    press: function () { oDialog.close(); }
                }),
                afterClose: function () { oDialog.destroy(); }
            });

            oDialog.open();
        },

        _saveNewTemplate: function (oDialog) {
            var sName = sap.ui.getCore().byId("newTplName").getValue();
            if (!sName) {
                MessageBox.warning("Please enter a template name.");
                return;
            }

            var sRefContent = sap.ui.getCore().byId("newTplRefContent") ? sap.ui.getCore().byId("newTplRefContent").getValue() : "";
            var sRefName = sap.ui.getCore().byId("newTplRefName") ? sap.ui.getCore().byId("newTplRefName").getText() : "";

            var oNewTemplate = {
                ID: "tpl-" + Date.now().toString(36),
                templateName: sName,
                templateType: sap.ui.getCore().byId("newTplType").getSelectedKey(),
                description: sap.ui.getCore().byId("newTplDesc").getValue(),
                promptTemplate: sap.ui.getCore().byId("newTplPrompt").getValue(),
                sections: sap.ui.getCore().byId("newTplSections").getValue(),
                referenceContent: sRefContent,
                referenceFileName: sRefName,
                isActive: sap.ui.getCore().byId("newTplActive").getSelected(),
                modifiedAt: new Date().toISOString().split("T")[0]
            };

            // Validate sections JSON if provided
            if (oNewTemplate.sections) {
                try {
                    JSON.parse(oNewTemplate.sections);
                } catch (e) {
                    MessageBox.error("Custom Sections JSON is not valid JSON. Please fix the syntax.");
                    return;
                }
            }

            // Save to backend via OData
            var oModel = this.getOwnerComponent().getModel();
            try {
                var oListBinding = oModel.bindList("/DocumentTemplates");
                var oContext = oListBinding.create({
                    templateName: oNewTemplate.templateName,
                    templateType: oNewTemplate.templateType,
                    description: oNewTemplate.description,
                    promptTemplate: oNewTemplate.promptTemplate,
                    sections: oNewTemplate.sections,
                    referenceContent: oNewTemplate.referenceContent,
                    referenceFileName: oNewTemplate.referenceFileName,
                    isActive: oNewTemplate.isActive
                });

                oContext.created().then(function () {
                    // Refresh from backend to get server-generated IDs
                    that._loadTemplates();
                    MessageToast.show("Template created and saved!");
                }).catch(function () {
                    MessageToast.show("Template created locally (backend save failed).");
                });
            } catch (e) { /* fallback to local */ }

            // Update local model immediately for UI responsiveness
            var aTemplates = this._oTemplateModel.getProperty("/templates");
            aTemplates.push(oNewTemplate);
            this._oTemplateModel.setProperty("/templates", aTemplates);

            oDialog.close();
        },

        _showEditTemplateDialog: function (oTemplate, sPath) {
            var that = this;

            var oDialog = new Dialog({
                title: "Edit Template: " + oTemplate.templateName,
                contentWidth: "600px",
                content: [
                    new SimpleForm({
                        editable: true,
                        layout: "ResponsiveGridLayout",
                        labelSpanXL: 4, labelSpanL: 4, labelSpanM: 4,
                        emptySpanXL: 0, emptySpanL: 0, emptySpanM: 0,
                        columnsXL: 1, columnsL: 1, columnsM: 1,
                        class: "sapUiSmallMargin",
                        content: [
                            new sap.ui.core.Title({ text: "Template Information" }),
                            new Label({ text: "Template Name" }),
                            new Input("editTplName", { value: oTemplate.templateName }),
                            new Label({ text: "Type" }),
                            new Select("editTplType", {
                                selectedKey: oTemplate.templateType,
                                items: [
                                    new Item({ key: "BRD", text: "Business Requirements Document" }),
                                    new Item({ key: "FUNC_SPEC", text: "Functional Specification" }),
                                    new Item({ key: "TECH_SPEC", text: "Technical Specification" }),
                                    new Item({ key: "CODE_REVIEW", text: "Code Review Report" })
                                ]
                            }),
                            new Label({ text: "Description" }),
                            new TextArea("editTplDesc", { value: oTemplate.description, rows: 2, width: "100%" }),
                            new Label({ text: "Active" }),
                            new CheckBox("editTplActive", { selected: oTemplate.isActive, text: "Enable this template" }),

                            new sap.ui.core.Title({ text: "AI Prompt Instructions" }),
                            new Label({ text: "Custom Prompt" }),
                            new TextArea("editTplPrompt", {
                                value: oTemplate.promptTemplate || "",
                                placeholder: "Custom instructions for Diligent AI...",
                                rows: 6, width: "100%"
                            }),

                            new sap.ui.core.Title({ text: "Reference Document" }),
                            new Label({ text: "Upload Reference" }),
                            new VBox({
                                items: [
                                    new sap.m.MessageStrip({
                                        text: "Upload a reference document (.docx, .txt) and the AI will adopt its structure, tone, and formatting style when generating documents.",
                                        type: "Information", showIcon: true,
                                        class: "sapUiTinyMarginBottom"
                                    }),
                                    new sap.ui.unified.FileUploader("editTplRefFile", {
                                        name: "referenceFile",
                                        uploadOnChange: false,
                                        fileType: "txt,docx",
                                        placeholder: "Choose reference document (.docx or .txt)...",
                                        width: "100%",
                                        buttonText: "Browse",
                                        style: "Emphasized",
                                        change: function (oEvt) { that._onReferenceFileSelected(oEvt, "editTplRefContent", "editTplRefName"); }
                                    }),
                                    new Text("editTplRefName", {
                                        text: oTemplate.referenceFileName ? "Current: " + oTemplate.referenceFileName : "No reference document uploaded"
                                    }),
                                    new TextArea("editTplRefContent", { visible: false, value: oTemplate.referenceContent || "", rows: 1, width: "100%" })
                                ]
                            }),

                            new sap.ui.core.Title({ text: "Document Sections (Advanced)" }),
                            new Label({ text: "Custom Sections JSON" }),
                            new TextArea("editTplSections", {
                                value: oTemplate.sections || "",
                                placeholder: "Custom JSON structure (leave empty for default)",
                                rows: 5, width: "100%"
                            })
                        ]
                    })
                ],
                beginButton: new Button({
                    text: "Save Changes",
                    type: "Emphasized",
                    press: function () {
                        var oUpdated = {
                            ID: oTemplate.ID,
                            templateName: sap.ui.getCore().byId("editTplName").getValue(),
                            templateType: sap.ui.getCore().byId("editTplType").getSelectedKey(),
                            description: sap.ui.getCore().byId("editTplDesc").getValue(),
                            promptTemplate: sap.ui.getCore().byId("editTplPrompt").getValue(),
                            sections: sap.ui.getCore().byId("editTplSections").getValue(),
                            referenceContent: sap.ui.getCore().byId("editTplRefContent") ? sap.ui.getCore().byId("editTplRefContent").getValue() : oTemplate.referenceContent,
                            referenceFileName: sap.ui.getCore().byId("editTplRefName") ? sap.ui.getCore().byId("editTplRefName").getText().replace("Current: ", "") : oTemplate.referenceFileName,
                            isActive: sap.ui.getCore().byId("editTplActive").getSelected(),
                            modifiedAt: new Date().toISOString().split("T")[0]
                        };

                        // Validate sections JSON
                        if (oUpdated.sections) {
                            try { JSON.parse(oUpdated.sections); }
                            catch (e) { MessageBox.error("Custom Sections JSON is invalid."); return; }
                        }

                        // Persist to backend via PATCH
                        if (oUpdated.ID && !oUpdated.ID.startsWith("tpl-")) {
                            jQuery.ajax({
                                url: "/api/analyzer/DocumentTemplates(" + oUpdated.ID + ")",
                                method: "PATCH",
                                contentType: "application/json",
                                data: JSON.stringify({
                                    templateName: oUpdated.templateName,
                                    templateType: oUpdated.templateType,
                                    description: oUpdated.description,
                                    promptTemplate: oUpdated.promptTemplate,
                                    sections: oUpdated.sections,
                                    referenceContent: oUpdated.referenceContent,
                                    referenceFileName: oUpdated.referenceFileName,
                                    isActive: oUpdated.isActive
                                }),
                                success: function () {
                                    that._loadTemplates();
                                    MessageToast.show("Template updated and saved!");
                                },
                                error: function () {
                                    MessageToast.show("Template updated locally (backend save failed).");
                                }
                            });
                        }

                        that._oTemplateModel.setProperty(sPath, oUpdated);
                        oDialog.close();
                    }
                }),
                endButton: new Button({ text: "Cancel", press: function () { oDialog.close(); } }),
                afterClose: function () { oDialog.destroy(); }
            });

            oDialog.open();
        },

        _deleteTemplate: function (oTemplate, sPath) {
            var that = this;
            MessageBox.confirm("Delete template '" + oTemplate.templateName + "'?", {
                title: "Confirm Delete",
                onClose: function (oAction) {
                    if (oAction === MessageBox.Action.OK) {
                        // Delete from backend via HTTP DELETE
                        if (oTemplate.ID && !oTemplate.ID.startsWith("tpl-")) {
                            jQuery.ajax({
                                url: "/api/analyzer/DocumentTemplates(" + oTemplate.ID + ")",
                                method: "DELETE",
                                success: function () {
                                    that._loadTemplates();
                                },
                                error: function () {
                                    MessageToast.show("Backend delete failed, removed locally.");
                                }
                            });
                        }

                        // Remove from local model immediately
                        var aTemplates = that._oTemplateModel.getProperty("/templates");
                        var iIndex = parseInt(sPath.split("/").pop());
                        aTemplates.splice(iIndex, 1);
                        that._oTemplateModel.setProperty("/templates", aTemplates);
                        MessageToast.show("Template deleted.");
                    }
                }
            });
        },

        _onReferenceFileSelected: function (oEvent, sContentFieldId, sNameFieldId) {
            var oFileUploader = oEvent.getSource();
            var aFiles = oEvent.getParameter("files") || oFileUploader.oFileUpload.files;

            if (!aFiles || aFiles.length === 0) return;

            var oFile = aFiles[0];
            var sFileName = oFile.name.toLowerCase();

            var oNameField = sap.ui.getCore().byId(sNameFieldId);
            if (oNameField) oNameField.setText("Reference: " + oFile.name);

            if (sFileName.endsWith(".docx") || sFileName.endsWith(".doc")) {
                // Read .docx as ArrayBuffer and convert to base64 for server-side extraction
                var oReader = new FileReader();
                oReader.onload = function (e) {
                    var aBuffer = e.target.result;
                    var aBytes = new Uint8Array(aBuffer);
                    var sBinary = "";
                    for (var i = 0; i < aBytes.length; i++) {
                        sBinary += String.fromCharCode(aBytes[i]);
                    }
                    var sBase64 = btoa(sBinary);
                    var oContentField = sap.ui.getCore().byId(sContentFieldId);
                    if (oContentField) {
                        oContentField.setValue(sBase64);
                    }
                    MessageToast.show("Reference document loaded: " + oFile.name);
                };
                oReader.onerror = function () {
                    MessageBox.error("Failed to read reference file.");
                };
                oReader.readAsArrayBuffer(oFile);
            } else {
                // Read .txt as text
                var oReader = new FileReader();
                oReader.onload = function (e) {
                    var sContent = e.target.result;
                    var oContentField = sap.ui.getCore().byId(sContentFieldId);
                    if (oContentField) {
                        oContentField.setValue(sContent);
                    }
                    MessageToast.show("Reference document loaded: " + oFile.name);
                };
                oReader.onerror = function () {
                    MessageBox.error("Failed to read reference file.");
                };
                oReader.readAsText(oFile);
            }
        },

        // ═══════════════════════════════════════════════════════════
        // UTILITIES
        // ═══════════════════════════════════════════════════════════

        /**
         * Refresh CSRF token from Application Router and retry the action
         */
        _refreshCSRFTokenAndRetry: function (fnRetry) {
            var sServiceUrl = this.getOwnerComponent().getManifestEntry("/sap.app/dataSources/mainService/uri") || "/api/analyzer/";

            jQuery.ajax({
                url: sServiceUrl,
                type: "HEAD",
                headers: { "X-CSRF-Token": "Fetch" },
                success: function (data, textStatus, jqXHR) {
                    var sToken = jqXHR.getResponseHeader("X-CSRF-Token");
                    if (sToken) {
                        jQuery.ajaxSetup({ headers: { "X-CSRF-Token": sToken } });
                    }
                    fnRetry();
                },
                error: function () {
                    fnRetry();
                }
            });
        },

        _downloadFile: function (sBase64, sFileName, sFileType) {
            var sMimeType = sFileType === "PDF"
                ? "application/pdf"
                : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

            var byteCharacters = atob(sBase64);
            var byteNumbers = new Array(byteCharacters.length);
            for (var i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            var byteArray = new Uint8Array(byteNumbers);
            var blob = new Blob([byteArray], { type: sMimeType });

            var link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = sFileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        },

        _escapeHtml: function (str) {
            if (!str) return "";
            return String(str)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;");
        }
    });
});
