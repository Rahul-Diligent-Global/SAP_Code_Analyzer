sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/BusyDialog",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Label",
    "sap/m/Select",
    "sap/m/TextArea",
    "sap/m/CheckBox",
    "sap/m/VBox",
    "sap/ui/core/Item",
    "sap/ui/core/Fragment"
], function (Controller, JSONModel, MessageBox, MessageToast, BusyDialog,
             Dialog, Button, Label, Select, TextArea, CheckBox, VBox, Item, Fragment) {
    "use strict";

    return Controller.extend("com.sap.codeinsight.controller.ObjectDetail", {

        onInit: function () {
            this._oViewModel = this.getOwnerComponent().getModel("viewModel");
            this._oBusyDialog = new BusyDialog({ title: "Processing..." });

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
         */
        _loadSourceCode: function (sObjectName, sCategory) {
            var that = this;
            var oModel = this.getOwnerComponent().getModel();

            this._oViewModel.setProperty("/busy", true);

            // Call CAP action: getSourceCode
            var oContext = oModel.bindContext("/getSourceCode(...)");
            oContext.setParameter("objectName", sObjectName);
            oContext.setParameter("category", sCategory);

            oContext.execute().then(function () {
                var oResult = oContext.getBoundContext().getObject();

                // Store result
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

                // Format code for editor
                that._formatCodeForEditor(oResult.sourceCode);

                // Populate section filter
                that._populateSectionFilter(oResult.sourceCode);

                that._oViewModel.setProperty("/busy", false);

            }).catch(function (oError) {
                that._oViewModel.setProperty("/busy", false);
                MessageBox.error("Failed to load source code: " + (oError.message || "Unknown error"));
            });
        },

        /**
         * Format source code for the code editor
         */
        _formatCodeForEditor: function (aSourceCode, sSectionFilter) {
            if (!aSourceCode || aSourceCode.length === 0) {
                this._oViewModel.setProperty("/formattedCode", "* No source code available");
                return;
            }

            var aLines = [];
            var sCurrentSection = "";

            for (var i = 0; i < aSourceCode.length; i++) {
                var oLine = aSourceCode[i];

                // Apply section filter
                if (sSectionFilter && sSectionFilter !== "ALL" && oLine.section !== sSectionFilter) {
                    continue;
                }

                // Add section header when section changes
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

        /**
         * Populate section filter dropdown
         */
        _populateSectionFilter: function (aSourceCode) {
            var oSelect = this.byId("sectionFilter");
            if (!oSelect) return;

            // Get unique sections
            var aSections = [];
            var oSeen = {};
            for (var i = 0; i < aSourceCode.length; i++) {
                if (!oSeen[aSourceCode[i].section]) {
                    oSeen[aSourceCode[i].section] = true;
                    aSections.push(aSourceCode[i].section);
                }
            }

            // Rebuild items
            oSelect.removeAllItems();
            oSelect.addItem(new Item({ key: "ALL", text: "All Sections" }));
            aSections.forEach(function (s) {
                oSelect.addItem(new Item({ key: s, text: s }));
            });
        },

        /**
         * Section filter change
         */
        onSectionFilter: function (oEvent) {
            var sKey = oEvent.getParameter("selectedItem").getKey();
            var aSourceCode = this._oViewModel.getProperty("/sourceCode");
            this._formatCodeForEditor(aSourceCode, sKey);
        },

        /**
         * Navigate back
         */
        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("ObjectList");
        },

        /**
         * Copy code to clipboard
         */
        onCopyCode: function () {
            var sCode = this._oViewModel.getProperty("/formattedCode");
            if (navigator.clipboard) {
                navigator.clipboard.writeText(sCode).then(function () {
                    MessageToast.show("Code copied to clipboard!");
                });
            }
        },

        /**
         * Toggle line numbers in code editor
         */
        onToggleLineNumbers: function (oEvent) {
            var bPressed = oEvent.getParameter("pressed");
            this.byId("codeEditor").setLineNumbers(bPressed);
        },

        /**
         * Navigate to include source
         */
        onIncludePress: function (oEvent) {
            var oItem = oEvent.getSource();
            var oContext = oItem.getBindingContext("viewModel");
            var sSection = oContext.getProperty("includeType");

            // Filter to show only this include
            var oSelect = this.byId("sectionFilter");
            oSelect.setSelectedKey(sSection);
            var aSourceCode = this._oViewModel.getProperty("/sourceCode");
            this._formatCodeForEditor(aSourceCode, sSection);

            MessageToast.show("Showing section: " + sSection);
        },

        // ═══════════════════════════════════════════════════════════
        // CLAUDE AI INTEGRATION
        // ═══════════════════════════════════════════════════════════

        /**
         * Analyze code with Claude (preview)
         */
        onAnalyzeCode: function () {
            var that = this;
            this._oBusyDialog.setText("Analyzing code with Claude AI...");
            this._oBusyDialog.open();

            var oModel = this.getOwnerComponent().getModel();
            var oContext = oModel.bindContext("/analyzeCode(...)");
            oContext.setParameter("objectName", this._sObjectName);
            oContext.setParameter("category", this._sCategory);
            oContext.setParameter("analysisType", "BRD");

            oContext.execute().then(function () {
                var sResult = oContext.getBoundContext().getObject().value;
                that._oBusyDialog.close();

                try {
                    var oAnalysis = JSON.parse(sResult);
                    that._oViewModel.setProperty("/analysis", oAnalysis);
                    that._displayAnalysis(oAnalysis);
                } catch (e) {
                    // Raw text response
                    that._oViewModel.setProperty("/analysis", { raw: sResult });
                    that._oViewModel.setProperty("/analysisHtml",
                        "<pre style='white-space:pre-wrap;'>" + that._escapeHtml(sResult) + "</pre>");
                }

            }).catch(function (oError) {
                that._oBusyDialog.close();
                MessageBox.error("Analysis failed: " + (oError.message || "Unknown error"));
            });
        },

        /**
         * Display structured analysis as HTML
         */
        _displayAnalysis: function (oAnalysis) {
            var aHtml = [];

            if (oAnalysis.executiveSummary) {
                aHtml.push("<h3>Executive Summary</h3>");
                aHtml.push("<p>" + this._escapeHtml(oAnalysis.executiveSummary) + "</p>");
            }

            if (oAnalysis.businessOverview) {
                aHtml.push("<h3>Business Overview</h3>");
                aHtml.push("<p><strong>Purpose:</strong> " + this._escapeHtml(oAnalysis.businessOverview.purpose || "") + "</p>");
                aHtml.push("<p><strong>Process:</strong> " + this._escapeHtml(oAnalysis.businessOverview.businessProcess || "") + "</p>");
                aHtml.push("<p><strong>Module:</strong> " + this._escapeHtml(oAnalysis.businessOverview.module || "") + "</p>");
            }

            if (oAnalysis.functionalRequirements && oAnalysis.functionalRequirements.length > 0) {
                aHtml.push("<h3>Functional Requirements</h3>");
                aHtml.push("<table border='1' cellpadding='5' style='border-collapse:collapse;width:100%'>");
                aHtml.push("<tr style='background:#1F4E79;color:white;'><th>ID</th><th>Title</th><th>Description</th><th>Priority</th></tr>");
                oAnalysis.functionalRequirements.forEach(function (req) {
                    aHtml.push("<tr>");
                    aHtml.push("<td>" + this._escapeHtml(req.reqId || "") + "</td>");
                    aHtml.push("<td>" + this._escapeHtml(req.title || "") + "</td>");
                    aHtml.push("<td>" + this._escapeHtml(req.description || "") + "</td>");
                    aHtml.push("<td>" + this._escapeHtml(req.priority || "") + "</td>");
                    aHtml.push("</tr>");
                }.bind(this));
                aHtml.push("</table>");
            }

            this._oViewModel.setProperty("/analysisHtml", aHtml.join(""));
        },

        /**
         * Generate DOCX document
         */
        onGenerateDocx: function () {
            this._showGenerateDialog("DOCX");
        },

        /**
         * Generate PDF document
         */
        onGeneratePdf: function () {
            this._showGenerateDialog("PDF");
        },

        /**
         * Generate Functional Specification
         */
        onGenerateFuncSpec: function () {
            this._showGenerateDialog("DOCX", "FUNC_SPEC");
        },

        /**
         * Show document generation options dialog
         */
        _showGenerateDialog: function (sDocType, sTemplate) {
            var that = this;

            // Create dialog with options
            var oDialog = new Dialog({
                title: "Generate " + (sTemplate === "FUNC_SPEC" ? "Functional Specification" : "BRD Document"),
                type: "Message",
                contentWidth: "500px",
                content: [
                    new VBox({
                        class: "sapUiSmallMargin",
                        items: [
                            new Label({ text: "Document Format:", design: "Bold" }),
                            new Select("docFormatSelect", {
                                selectedKey: sDocType,
                                width: "100%",
                                items: [
                                    new Item({ key: "DOCX", text: "Word Document (.docx)" }),
                                    new Item({ key: "PDF", text: "PDF Document (.pdf)" })
                                ]
                            }),

                            new Label({ text: "Detail Level:", design: "Bold", class: "sapUiSmallMarginTop" }),
                            new Select("detailLevelSelect", {
                                selectedKey: "DETAILED",
                                width: "100%",
                                items: [
                                    new Item({ key: "SUMMARY", text: "Summary (2-3 pages)" }),
                                    new Item({ key: "DETAILED", text: "Detailed (5-10 pages)" }),
                                    new Item({ key: "COMPREHENSIVE", text: "Comprehensive (10+ pages)" })
                                ]
                            }),

                            new CheckBox("includeCodeCheck", {
                                text: "Include Source Code in Appendix",
                                selected: true,
                                class: "sapUiSmallMarginTop"
                            }),

                            new Label({ text: "Custom Instructions (Optional):", design: "Bold", class: "sapUiSmallMarginTop" }),
                            new TextArea("customPromptArea", {
                                placeholder: "Add any specific instructions for the AI...\nE.g., 'Focus on the MM module integration' or 'Include data flow diagrams description'",
                                width: "100%",
                                rows: 4
                            })
                        ]
                    })
                ],
                beginButton: new Button({
                    text: "Generate",
                    type: "Emphasized",
                    icon: "sap-icon://create",
                    press: function () {
                        var sFormat = sap.ui.getCore().byId("docFormatSelect").getSelectedKey();
                        var sDetailLevel = sap.ui.getCore().byId("detailLevelSelect").getSelectedKey();
                        var bIncludeCode = sap.ui.getCore().byId("includeCodeCheck").getSelected();
                        var sCustomPrompt = sap.ui.getCore().byId("customPromptArea").getValue();

                        oDialog.close();
                        that._executeDocumentGeneration(sFormat, sDetailLevel, bIncludeCode, sCustomPrompt);
                    }
                }),
                endButton: new Button({
                    text: "Cancel",
                    press: function () {
                        oDialog.close();
                    }
                }),
                afterClose: function () {
                    oDialog.destroy();
                }
            });

            oDialog.open();
        },

        /**
         * Execute document generation via CAP action
         */
        _executeDocumentGeneration: function (sFormat, sDetailLevel, bIncludeCode, sCustomPrompt) {
            var that = this;

            this._oBusyDialog.setText(
                "Generating document...\n\n" +
                "Step 1: Fetching source code from SAP\n" +
                "Step 2: Analyzing code with Claude AI\n" +
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
                includeCode: bIncludeCode,
                detailLevel: sDetailLevel,
                customPrompt: sCustomPrompt || ""
            });

            oContext.execute().then(function () {
                var oResult = oContext.getBoundContext().getObject();
                that._oBusyDialog.close();

                if (oResult.success) {
                    // Trigger download
                    that._downloadFile(
                        oResult.fileContent,
                        oResult.fileName,
                        oResult.fileType
                    );
                    MessageToast.show(oResult.message || "Document generated successfully!");
                } else {
                    MessageBox.error("Document generation failed: " + (oResult.message || "Unknown error"));
                }

            }).catch(function (oError) {
                that._oBusyDialog.close();
                MessageBox.error("Document generation failed: " + (oError.message || "Unknown error"));
            });
        },

        /**
         * Download file from base64 content
         */
        _downloadFile: function (sBase64, sFileName, sFileType) {
            var sMimeType = sFileType === "PDF"
                ? "application/pdf"
                : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

            // Decode base64
            var byteCharacters = atob(sBase64);
            var byteNumbers = new Array(byteCharacters.length);
            for (var i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            var byteArray = new Uint8Array(byteNumbers);
            var blob = new Blob([byteArray], { type: sMimeType });

            // Create download link
            var link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = sFileName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
        },

        /**
         * Escape HTML for safe display
         */
        _escapeHtml: function (str) {
            if (!str) return "";
            return str
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;");
        }
    });
});

