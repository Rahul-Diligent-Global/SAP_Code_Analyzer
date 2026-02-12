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
    "sap/ui/core/Item",
    "sap/ui/layout/form/SimpleForm"
], function (Controller, JSONModel, MessageBox, MessageToast, BusyDialog,
             Dialog, Button, Label, Input, Select, TextArea, CheckBox, VBox, HBox, Text, Title,
             Table, Column, ColumnListItem, Toolbar, ToolbarSpacer, ObjectStatus,
             Item, SimpleForm) {
    "use strict";

    return Controller.extend("com.sap.codeinsight.controller.OfflineAnalysis", {

        onInit: function () {
            this._oModel = new JSONModel({
                objectName: "",
                sourceCode: "",
                codeLoaded: false,
                lineCount: 0,
                busy: false,
                analysis: null,
                analysisHtml: "",
                analysisType: "BRD"
            });
            this.getView().setModel(this._oModel, "offlineModel");

            this._oTemplateModel = new JSONModel({
                templates: [],
                newTemplate: {}
            });

            this._oBusyDialog = new BusyDialog({
                title: "Analyzing Code",
                text: "Sending code to Diligent AI for analysis...\n\nThis may take a moment..."
            });

            this.getOwnerComponent().getRouter().getRoute("OfflineAnalysis")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function () {
            // Reset state if needed
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("ObjectList", {}, true);
        },

        // ═══════════════════════════════════════════════════════════
        // FILE UPLOAD
        // ═══════════════════════════════════════════════════════════

        onFileSelected: function (oEvent) {
            var that = this;
            var oFileUploader = oEvent.getSource();
            var aFiles = oEvent.getParameter("files") || oFileUploader.oFileUpload.files;

            if (!aFiles || aFiles.length === 0) {
                return;
            }

            var oFile = aFiles[0];
            var sFileName = oFile.name.replace(/\.(txt|abap)$/i, "").toUpperCase();

            // Auto-fill object name from filename
            if (!this._oModel.getProperty("/objectName")) {
                this._oModel.setProperty("/objectName", sFileName);
            }

            var oReader = new FileReader();
            oReader.onload = function (e) {
                var sContent = e.target.result;
                that._oModel.setProperty("/sourceCode", sContent);
                MessageToast.show("File loaded: " + oFile.name + " (" + sContent.split("\n").length + " lines)");
            };
            oReader.onerror = function () {
                MessageBox.error("Failed to read file.");
            };
            oReader.readAsText(oFile);
        },

        onLoadCode: function () {
            var sCode = this._oModel.getProperty("/sourceCode");
            var sName = this._oModel.getProperty("/objectName");

            if (!sName) {
                MessageBox.warning("Please enter an Object Name.");
                return;
            }
            if (!sCode || sCode.trim().length === 0) {
                MessageBox.warning("Please upload a file or paste ABAP code.");
                return;
            }

            var iLines = sCode.split("\n").length;
            this._oModel.setProperty("/lineCount", iLines);
            this._oModel.setProperty("/codeLoaded", true);
            MessageToast.show("Code loaded: " + iLines + " lines ready for analysis.");
        },

        onClearCode: function () {
            this._oModel.setProperty("/sourceCode", "");
            this._oModel.setProperty("/objectName", "");
            this._oModel.setProperty("/codeLoaded", false);
            this._oModel.setProperty("/lineCount", 0);
            this._oModel.setProperty("/analysis", null);
            this._oModel.setProperty("/analysisHtml", "");

            var oUploader = this.byId("fileUploader");
            if (oUploader) {
                oUploader.clear();
            }
        },

        onCopyCode: function () {
            var sCode = this._oModel.getProperty("/sourceCode");
            if (navigator.clipboard) {
                navigator.clipboard.writeText(sCode).then(function () {
                    MessageToast.show("Code copied to clipboard.");
                });
            }
        },

        // ═══════════════════════════════════════════════════════════
        // ANALYSIS
        // ═══════════════════════════════════════════════════════════

        onAnalyzeCode: function (bRetry) {
            var sCode = this._oModel.getProperty("/sourceCode");
            var sName = this._oModel.getProperty("/objectName");
            var sAnalysisType = this._oModel.getProperty("/analysisType") || "BRD";

            if (!sCode || sCode.trim().length === 0) {
                MessageBox.warning("Please load code first.");
                return;
            }

            var sTypeLabel = this._getAnalysisTypeLabel(sAnalysisType);
            var that = this;
            this._oBusyDialog.setText("Analyzing code with Diligent AI...\n\nAnalysis Type: " + sTypeLabel + "\n\nThis may take a moment...");
            this._oBusyDialog.open();

            var oODataModel = this.getOwnerComponent().getModel();
            var oContext = oODataModel.bindContext("/analyzeOfflineCode(...)");
            oContext.setParameter("objectName", sName || "UPLOADED_CODE");
            oContext.setParameter("sourceCode", sCode);
            oContext.setParameter("analysisType", sAnalysisType);

            oContext.execute().then(function () {
                var oResult = oContext.getBoundContext().getObject();
                that._oBusyDialog.close();

                var sResult = oResult.value || oResult;
                var sJsonText = (typeof sResult === "string") ? sResult : JSON.stringify(sResult);

                try {
                    var oAnalysis = JSON.parse(sJsonText);
                    that._oModel.setProperty("/analysis", oAnalysis);
                    that._displayAnalysis(oAnalysis);
                } catch (e) {
                    that._oModel.setProperty("/analysis", { raw: sJsonText });
                    that._oModel.setProperty("/analysisHtml",
                        "<pre style='white-space:pre-wrap;font-size:13px;'>" + that._escapeHtml(sJsonText) + "</pre>");
                }

            }).catch(function (oError) {
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

        _getAnalysisTypeLabel: function (sType) {
            var mLabels = {
                "BRD": "Business Requirements Document",
                "FUNC_SPEC": "Functional Specification",
                "TECH_SPEC": "Technical Specification",
                "CODE_REVIEW": "Code Review Report"
            };
            return mLabels[sType] || sType;
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
                        var oSel = sap.ui.getCore().byId("offlineTplSelect");
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
                            new Select("offlineTplSelect", { selectedKey: "", width: "100%", items: aTemplateItems }),

                            new Label({ text: "Document Type:", design: "Bold", class: "sapUiSmallMarginTop" }),
                            new Select("offlineDocTypeSelect", {
                                selectedKey: sTemplate || "BRD", width: "100%",
                                items: [
                                    new Item({ key: "BRD", text: "Business Requirements Document" }),
                                    new Item({ key: "FUNC_SPEC", text: "Functional Specification" }),
                                    new Item({ key: "TECH_SPEC", text: "Technical Specification" }),
                                    new Item({ key: "CODE_REVIEW", text: "Code Review Report" })
                                ]
                            }),

                            new Label({ text: "Document Format:", design: "Bold", class: "sapUiSmallMarginTop" }),
                            new Select("offlineDocFormatSelect", {
                                selectedKey: sDocType, width: "100%",
                                items: [
                                    new Item({ key: "DOCX", text: "Word Document (.docx)" }),
                                    new Item({ key: "PDF", text: "PDF Document (.pdf)" })
                                ]
                            }),

                            new Label({ text: "Detail Level:", design: "Bold", class: "sapUiSmallMarginTop" }),
                            new Select("offlineDetailSelect", {
                                selectedKey: "DETAILED", width: "100%",
                                items: [
                                    new Item({ key: "SUMMARY", text: "Summary (2-3 pages)" }),
                                    new Item({ key: "DETAILED", text: "Detailed (5-10 pages)" }),
                                    new Item({ key: "COMPREHENSIVE", text: "Comprehensive (10+ pages)" })
                                ]
                            }),

                            new CheckBox("offlineIncludeCodeCheck", { text: "Include Source Code in Appendix", selected: true, class: "sapUiSmallMarginTop" }),

                            new Label({ text: "Custom Instructions (Optional):", design: "Bold", class: "sapUiSmallMarginTop" }),
                            new TextArea("offlineCustomPromptArea", {
                                placeholder: "Add any specific instructions for the AI...\nE.g., 'Focus on the MM module integration'",
                                width: "100%", rows: 3
                            })
                        ]
                    })
                ],
                beginButton: new Button({
                    text: "Generate", type: "Emphasized", icon: "sap-icon://create",
                    press: function () {
                        var sFormat = sap.ui.getCore().byId("offlineDocFormatSelect").getSelectedKey();
                        var sDetailLevel = sap.ui.getCore().byId("offlineDetailSelect").getSelectedKey();
                        var bIncludeCode = sap.ui.getCore().byId("offlineIncludeCodeCheck").getSelected();
                        var sCustomPrompt = sap.ui.getCore().byId("offlineCustomPromptArea").getValue();
                        var sTemplateId = sap.ui.getCore().byId("offlineTplSelect").getSelectedKey();
                        var sDocTypeKey = sap.ui.getCore().byId("offlineDocTypeSelect").getSelectedKey();
                        oDialog.close();
                        that._executeOfflineDocumentGeneration(sFormat, sDetailLevel, bIncludeCode, sCustomPrompt, sTemplateId, sDocTypeKey);
                    }
                }),
                endButton: new Button({ text: "Cancel", press: function () { oDialog.close(); } }),
                afterClose: function () { oDialog.destroy(); }
            });

            oDialog.open();
        },

        _executeOfflineDocumentGeneration: function (sFormat, sDetailLevel, bIncludeCode, sCustomPrompt, sTemplateId, sDocType, bRetry) {
            var that = this;
            var sCode = this._oModel.getProperty("/sourceCode");
            var sName = this._oModel.getProperty("/objectName");

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
                "Step 1: Analyzing uploaded code with Diligent AI\n" +
                "Step 2: Creating " + sFormat + " document\n\n" +
                "This may take 30-60 seconds..."
            );
            this._oBusyDialog.open();

            var oModel = this.getOwnerComponent().getModel();
            var oContext = oModel.bindContext("/generateOfflineDocument(...)");

            oContext.setParameter("objectName", sName || "UPLOADED_CODE");
            oContext.setParameter("sourceCode", sCode);
            oContext.setParameter("options", {
                documentType: sFormat,
                analysisType: sDocType || "BRD",
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
                if (!bRetry && oError.statusCode === 403) {
                    that._oBusyDialog.close();
                    that._refreshCSRFTokenAndRetry(function () {
                        that._executeOfflineDocumentGeneration(sFormat, sDetailLevel, bIncludeCode, sCustomPrompt, sTemplateId, sDocType, true);
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

            var oTemplateTable = new Table("offlineTemplateListTable", {
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
                            state: "{= ${templateType} === 'BRD' ? 'Success' : ${templateType} === 'FUNC_SPEC' ? 'Information' : ${templateType} === 'TECH_SPEC' ? 'Warning' : 'None'}"
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
                                text: "Templates define how Diligent AI structures the analysis documents. Create templates for BRD, Functional Spec, Technical Spec, or Code Review with custom prompts and sections.",
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

            jQuery.ajax({
                url: "/api/analyzer/DocumentTemplates",
                method: "GET",
                dataType: "json",
                success: function (oData) {
                    var aBackendTemplates = oData.value || [];
                    if (aBackendTemplates.length > 0) {
                        that._oTemplateModel.setProperty("/templates", aBackendTemplates);
                    } else {
                        that._loadMockTemplates();
                    }
                },
                error: function () {
                    console.warn("Failed to load templates from backend");
                    that._loadMockTemplates();
                }
            });
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
                    },
                    {
                        ID: "tpl-tech-spec",
                        templateName: "Technical Specification",
                        templateType: "TECH_SPEC",
                        description: "Detailed technical specification with architecture, data model, and API details",
                        promptTemplate: "Focus on technical architecture, data model design, performance considerations, and API specifications.",
                        sections: "",
                        isActive: true,
                        modifiedAt: "2025-01-22"
                    },
                    {
                        ID: "tpl-code-review",
                        templateName: "Code Review Report",
                        templateType: "CODE_REVIEW",
                        description: "Code quality review covering best practices, security, performance, and maintainability",
                        promptTemplate: "Analyze code quality, identify issues, suggest improvements for performance, security, and maintainability.",
                        sections: "",
                        isActive: true,
                        modifiedAt: "2025-01-25"
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
                            new Input("offlineNewTplName", { placeholder: "e.g., Acme Corp BRD Template" }),
                            new Label({ text: "Template Type" }),
                            new Select("offlineNewTplType", {
                                selectedKey: "BRD",
                                items: [
                                    new Item({ key: "BRD", text: "Business Requirements Document" }),
                                    new Item({ key: "FUNC_SPEC", text: "Functional Specification" }),
                                    new Item({ key: "TECH_SPEC", text: "Technical Specification" }),
                                    new Item({ key: "CODE_REVIEW", text: "Code Review Report" })
                                ]
                            }),
                            new Label({ text: "Description" }),
                            new TextArea("offlineNewTplDesc", {
                                placeholder: "Describe the purpose and target audience for this template",
                                rows: 2, width: "100%"
                            }),
                            new Label({ text: "Active" }),
                            new CheckBox("offlineNewTplActive", { selected: true, text: "Enable this template" }),

                            new sap.ui.core.Title({ text: "AI Prompt Instructions" }),
                            new Label({ text: "Custom Prompt" }),
                            new TextArea("offlineNewTplPrompt", {
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
                                    new sap.ui.unified.FileUploader("offlineNewTplRefFile", {
                                        name: "referenceFile",
                                        uploadOnChange: false,
                                        fileType: "txt,docx",
                                        placeholder: "Choose reference document (.docx or .txt)...",
                                        width: "100%",
                                        buttonText: "Browse",
                                        style: "Emphasized",
                                        change: function (oEvt) { that._onReferenceFileSelected(oEvt, "offlineNewTplRefContent", "offlineNewTplRefName"); }
                                    }),
                                    new Text("offlineNewTplRefName", { text: "", class: "sapUiTinyMarginTop" }),
                                    new TextArea("offlineNewTplRefContent", { visible: false, rows: 1, width: "100%" })
                                ]
                            }),

                            new sap.ui.core.Title({ text: "Document Sections (Advanced)" }),
                            new Label({ text: "Custom Sections JSON" }),
                            new TextArea("offlineNewTplSections", {
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
            var sName = sap.ui.getCore().byId("offlineNewTplName").getValue();
            if (!sName) {
                MessageBox.warning("Please enter a template name.");
                return;
            }

            var sRefContent = sap.ui.getCore().byId("offlineNewTplRefContent") ? sap.ui.getCore().byId("offlineNewTplRefContent").getValue() : "";
            var sRefName = sap.ui.getCore().byId("offlineNewTplRefName") ? sap.ui.getCore().byId("offlineNewTplRefName").getText() : "";

            var oNewTemplate = {
                ID: "tpl-" + Date.now().toString(36),
                templateName: sName,
                templateType: sap.ui.getCore().byId("offlineNewTplType").getSelectedKey(),
                description: sap.ui.getCore().byId("offlineNewTplDesc").getValue(),
                promptTemplate: sap.ui.getCore().byId("offlineNewTplPrompt").getValue(),
                sections: sap.ui.getCore().byId("offlineNewTplSections").getValue(),
                referenceContent: sRefContent,
                referenceFileName: sRefName,
                isActive: sap.ui.getCore().byId("offlineNewTplActive").getSelected(),
                modifiedAt: new Date().toISOString().split("T")[0]
            };

            if (oNewTemplate.sections) {
                try {
                    JSON.parse(oNewTemplate.sections);
                } catch (e) {
                    MessageBox.error("Custom Sections JSON is not valid JSON. Please fix the syntax.");
                    return;
                }
            }

            // Save to backend via direct HTTP POST
            jQuery.ajax({
                url: "/api/analyzer/DocumentTemplates",
                method: "POST",
                contentType: "application/json",
                data: JSON.stringify({
                    templateName: oNewTemplate.templateName,
                    templateType: oNewTemplate.templateType,
                    description: oNewTemplate.description,
                    promptTemplate: oNewTemplate.promptTemplate,
                    sections: oNewTemplate.sections,
                    referenceContent: oNewTemplate.referenceContent,
                    referenceFileName: oNewTemplate.referenceFileName,
                    isActive: oNewTemplate.isActive
                }),
                success: function () {
                    that._loadTemplates();
                    MessageToast.show("Template created and saved to database!");
                },
                error: function (jqXHR) {
                    console.error("Failed to save template:", jqXHR.status, jqXHR.responseText);
                    MessageToast.show("Template created locally (backend save failed).");
                }
            });

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
                            new Input("offlineEditTplName", { value: oTemplate.templateName }),
                            new Label({ text: "Type" }),
                            new Select("offlineEditTplType", {
                                selectedKey: oTemplate.templateType,
                                items: [
                                    new Item({ key: "BRD", text: "Business Requirements Document" }),
                                    new Item({ key: "FUNC_SPEC", text: "Functional Specification" }),
                                    new Item({ key: "TECH_SPEC", text: "Technical Specification" }),
                                    new Item({ key: "CODE_REVIEW", text: "Code Review Report" })
                                ]
                            }),
                            new Label({ text: "Description" }),
                            new TextArea("offlineEditTplDesc", { value: oTemplate.description, rows: 2, width: "100%" }),
                            new Label({ text: "Active" }),
                            new CheckBox("offlineEditTplActive", { selected: oTemplate.isActive, text: "Enable this template" }),

                            new sap.ui.core.Title({ text: "AI Prompt Instructions" }),
                            new Label({ text: "Custom Prompt" }),
                            new TextArea("offlineEditTplPrompt", {
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
                                    new sap.ui.unified.FileUploader("offlineEditTplRefFile", {
                                        name: "referenceFile",
                                        uploadOnChange: false,
                                        fileType: "txt,docx",
                                        placeholder: "Choose reference document (.docx or .txt)...",
                                        width: "100%",
                                        buttonText: "Browse",
                                        style: "Emphasized",
                                        change: function (oEvt) { that._onReferenceFileSelected(oEvt, "offlineEditTplRefContent", "offlineEditTplRefName"); }
                                    }),
                                    new Text("offlineEditTplRefName", {
                                        text: oTemplate.referenceFileName ? "Current: " + oTemplate.referenceFileName : "No reference document uploaded"
                                    }),
                                    new TextArea("offlineEditTplRefContent", { visible: false, value: oTemplate.referenceContent || "", rows: 1, width: "100%" })
                                ]
                            }),

                            new sap.ui.core.Title({ text: "Document Sections (Advanced)" }),
                            new Label({ text: "Custom Sections JSON" }),
                            new TextArea("offlineEditTplSections", {
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
                            templateName: sap.ui.getCore().byId("offlineEditTplName").getValue(),
                            templateType: sap.ui.getCore().byId("offlineEditTplType").getSelectedKey(),
                            description: sap.ui.getCore().byId("offlineEditTplDesc").getValue(),
                            promptTemplate: sap.ui.getCore().byId("offlineEditTplPrompt").getValue(),
                            sections: sap.ui.getCore().byId("offlineEditTplSections").getValue(),
                            referenceContent: sap.ui.getCore().byId("offlineEditTplRefContent") ? sap.ui.getCore().byId("offlineEditTplRefContent").getValue() : oTemplate.referenceContent,
                            referenceFileName: sap.ui.getCore().byId("offlineEditTplRefName") ? sap.ui.getCore().byId("offlineEditTplRefName").getText().replace("Current: ", "") : oTemplate.referenceFileName,
                            isActive: sap.ui.getCore().byId("offlineEditTplActive").getSelected(),
                            modifiedAt: new Date().toISOString().split("T")[0]
                        };

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
        // ANALYSIS DISPLAY (complete - matching ObjectDetail)
        // ═══════════════════════════════════════════════════════════

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

            // Document Metadata Table
            if (oAnalysis.documentMetadata && oAnalysis.documentMetadata.length > 0) {
                aHtml.push(this._sectionHeader("Document Information"));
                aHtml.push(this._htmlTable(
                    ["Field", "Value"],
                    oAnalysis.documentMetadata.map(function (m) { return [m.label, m.value]; }),
                    ["30%", "70%"]
                ));
            }

            // Version History
            if (oAnalysis.versionHistory && oAnalysis.versionHistory.length > 0) {
                aHtml.push(this._sectionHeader("Version History"));
                aHtml.push(this._htmlTable(
                    ["Date", "Version", "Description", "Prepared By", "Approved By"],
                    oAnalysis.versionHistory.map(function (v) { return [v.date, v.version, v.description, v.preparedBy, v.approvedBy]; }),
                    ["15%", "10%", "35%", "20%", "20%"]
                ));
            }

            // Dynamic sections (reference template mode)
            if (oAnalysis.sections && oAnalysis.sections.length > 0) {
                oAnalysis.sections.forEach(function (section) {
                    if (!section || !section.title) return;
                    var sTitle = section.number ? section.number + " " + section.title : section.title;
                    var nLevel = section.level || 1;
                    if (nLevel === 1) {
                        aHtml.push(this._sectionHeader(sTitle));
                    } else if (nLevel === 2) {
                        aHtml.push("<h4 style='color:#2E75B6;margin:12px 0 6px;'>" + this._escapeHtml(sTitle) + "</h4>");
                    } else {
                        aHtml.push("<h5 style='color:#404040;margin:8px 0 4px;'>" + this._escapeHtml(sTitle) + "</h5>");
                    }
                    if (section.content) {
                        var paragraphs = String(section.content).split("\n\n");
                        paragraphs.forEach(function (p) {
                            if (p.trim()) aHtml.push("<p style='line-height:1.6;'>" + this._escapeHtml(p.trim()) + "</p>");
                        }.bind(this));
                    }
                    if (section.bulletPoints && section.bulletPoints.length > 0) {
                        aHtml.push("<ul>");
                        section.bulletPoints.forEach(function (bp) {
                            aHtml.push("<li>" + this._escapeHtml(String(bp || "")) + "</li>");
                        }.bind(this));
                        aHtml.push("</ul>");
                    }
                    if (section.tableData && section.tableData.headers && section.tableData.rows) {
                        var widths = section.tableData.headers.map(function () {
                            return Math.floor(100 / section.tableData.headers.length) + "%";
                        });
                        aHtml.push(this._htmlTable(section.tableData.headers, section.tableData.rows, widths));
                    }
                }.bind(this));
            }

            // Executive Summary (fixed mode - only shown when no dynamic sections)
            if (!oAnalysis.sections && oAnalysis.executiveSummary) {
                aHtml.push(this._sectionHeader("Executive Summary"));
                aHtml.push("<p style='line-height:1.6;'>" + this._escapeHtml(oAnalysis.executiveSummary) + "</p>");
            }

            // Business Overview (fixed mode)
            if (!oAnalysis.sections && oAnalysis.businessOverview) {
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

            // Functional Requirements (fixed mode only)
            if (!oAnalysis.sections && oAnalysis.functionalRequirements && oAnalysis.functionalRequirements.length > 0) {
                aHtml.push(this._sectionHeader("Functional Requirements"));
                aHtml.push(this._htmlTable(
                    ["ID", "Title", "Description", "Business Rule", "Priority"],
                    oAnalysis.functionalRequirements.map(function (r) { return [r.reqId, r.title, r.description, r.businessRule, r.priority]; }),
                    ["8%", "15%", "32%", "30%", "10%"]
                ));
            }

            // Data Specification (fixed mode only)
            if (!oAnalysis.sections && oAnalysis.dataSpecification) {
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

            // Selection Screen (fixed mode only)
            if (!oAnalysis.sections && oAnalysis.selectionScreen) {
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

            // Business Rules (fixed mode only)
            if (!oAnalysis.sections && oAnalysis.businessRules && oAnalysis.businessRules.length > 0) {
                aHtml.push(this._sectionHeader("Business Rules"));
                aHtml.push(this._htmlTable(
                    ["Rule ID", "Rule Name", "Description", "Condition", "Action"],
                    oAnalysis.businessRules.map(function (r) { return [r.ruleId, r.ruleName, r.description, r.condition, r.action]; }),
                    ["10%", "15%", "30%", "20%", "25%"]
                ));
            }

            // Integration Points (fixed mode only)
            if (!oAnalysis.sections && oAnalysis.integrationPoints && oAnalysis.integrationPoints.length > 0) {
                aHtml.push(this._sectionHeader("Integration Points"));
                aHtml.push(this._htmlTable(
                    ["System", "Type", "Direction", "Description", "Data Exchanged"],
                    oAnalysis.integrationPoints.map(function (ip) { return [ip.system, ip.type, ip.direction, ip.description, ip.dataExchanged]; }),
                    ["15%", "12%", "12%", "33%", "28%"]
                ));
            }

            // Authorization (fixed mode only)
            if (!oAnalysis.sections && oAnalysis.authorization) {
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

            // Error Handling (fixed mode only)
            if (!oAnalysis.sections && oAnalysis.errorHandling && oAnalysis.errorHandling.length > 0) {
                aHtml.push(this._sectionHeader("Error Handling"));
                aHtml.push(this._htmlTable(
                    ["Error Code", "Description", "Business Impact", "Resolution"],
                    oAnalysis.errorHandling.map(function (e) { return [e.errorCode, e.description, e.businessImpact, e.resolution]; }),
                    ["12%", "28%", "30%", "30%"]
                ));
            }

            // Test Scenarios (fixed mode only)
            if (!oAnalysis.sections && oAnalysis.testScenarios && oAnalysis.testScenarios.length > 0) {
                aHtml.push(this._sectionHeader("Test Scenarios"));
                aHtml.push(this._htmlTable(
                    ["ID", "Title", "Precondition", "Steps", "Expected Result"],
                    oAnalysis.testScenarios.map(function (t) { return [t.scenarioId, t.title, t.precondition, t.steps, t.expectedResult]; }),
                    ["8%", "15%", "22%", "28%", "27%"]
                ));
            }

            // Appendix (fixed mode only)
            if (!oAnalysis.sections && oAnalysis.appendix) {
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

            // Custom Sections (fixed mode only, from reference template fallback)
            if (!oAnalysis.sections && oAnalysis.customSections && oAnalysis.customSections.length > 0) {
                oAnalysis.customSections.forEach(function (section) {
                    if (!section.title) return;
                    aHtml.push(this._sectionHeader(section.title));
                    if (section.content) {
                        aHtml.push("<p style='line-height:1.6;'>" + this._escapeHtml(section.content) + "</p>");
                    }
                    if (section.tableData && section.tableData.headers && section.tableData.rows) {
                        var widths = section.tableData.headers.map(function () {
                            return Math.floor(100 / section.tableData.headers.length) + "%";
                        });
                        aHtml.push(this._htmlTable(section.tableData.headers, section.tableData.rows, widths));
                    }
                }.bind(this));
            }

            // Processing Logic (COMPREHENSIVE mode)
            if (oAnalysis.processingLogic && oAnalysis.processingLogic.length > 0) {
                aHtml.push(this._sectionHeader("Processing Logic - Detailed Flow"));
                aHtml.push("<p style='color:#666;font-style:italic;'>Step-by-step walkthrough of all core processing logic including every IF/ELSE condition, LOOP, and data operation.</p>");
                oAnalysis.processingLogic.forEach(function (routine) {
                    if (!routine || !routine.subroutineName) return;
                    aHtml.push("<h4 style='color:#1F4E79;margin:16px 0 6px;font-size:14px;'>" + this._escapeHtml(routine.subroutineName) + "</h4>");
                    if (routine.purpose) {
                        aHtml.push("<p><strong>Purpose:</strong> " + this._escapeHtml(routine.purpose) + "</p>");
                    }
                    if (routine.steps && routine.steps.length > 0) {
                        aHtml.push(this._htmlTable(
                            ["Step", "Type", "Condition / Code", "Description"],
                            routine.steps.map(function (s) {
                                var indent = s.indentLevel ? "\u00A0\u00A0".repeat(s.indentLevel) : "";
                                return [
                                    String(s.stepNumber || ""),
                                    indent + (s.type || ""),
                                    s.condition || s.codeReference || "",
                                    s.description || ""
                                ];
                            }),
                            ["6%", "14%", "40%", "40%"]
                        ));
                    }
                }.bind(this));
            }

            // Flowchart (COMPREHENSIVE mode)
            if (oAnalysis.flowchart && oAnalysis.flowchart.length > 0) {
                aHtml.push(this._sectionHeader("Program Flowchart"));
                aHtml.push("<p style='color:#666;font-style:italic;'>Complete program flow with decision points, loops, and processing steps.</p>");
                var shapeMap = { start: "[START]", end: "[END]", process: "[PROCESS]", decision: "&lt;DECISION&gt;", loop: "((LOOP))", io: "[/IO/]" };
                aHtml.push(this._htmlTable(
                    ["ID", "Type", "Description", "Flow"],
                    oAnalysis.flowchart.map(function (node) {
                        var shape = shapeMap[node.type] || "[" + (node.type || "?").toUpperCase() + "]";
                        var flow = "";
                        if (node.type === "decision") {
                            flow = "YES → " + (node.yesTarget || "?") + " | NO → " + (node.noTarget || "?");
                        } else {
                            flow = "→ " + (node.nextTarget || "END");
                        }
                        var desc = (node.label || "") + (node.description ? " - " + node.description : "");
                        return [node.id || "", shape, desc, flow];
                    }),
                    ["8%", "12%", "55%", "25%"]
                ));
            }

            // Fallback: raw analysis
            if (oAnalysis.rawAnalysis) {
                aHtml.push(this._sectionHeader("Raw Analysis"));
                aHtml.push("<pre style='white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:4px;font-size:13px;'>" +
                    this._escapeHtml(oAnalysis.rawAnalysis) + "</pre>");
            }

            this._oModel.setProperty("/analysisHtml", aHtml.join(""));
        },

        // ═══════════════════════════════════════════════════════════
        // UTILITY METHODS
        // ═══════════════════════════════════════════════════════════

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

        _escapeHtml: function (str) {
            if (!str) return "";
            var s = String(str);
            return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
        }
    });
});
