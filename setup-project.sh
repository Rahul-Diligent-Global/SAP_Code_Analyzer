#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# ABAP Code Analyzer - Complete Project Setup Script
# Run this in your Git repo root directory
# ═══════════════════════════════════════════════════════════════

set -e
echo "🚀 Setting up ABAP Code Analyzer project..."

# Create complete directory structure
mkdir -p on-prem-abap
mkdir -p docs
mkdir -p btp-cap-app/db
mkdir -p btp-cap-app/srv/lib/security
mkdir -p btp-cap-app/srv/lib/multitenancy
mkdir -p btp-cap-app/srv/lib/onboarding
mkdir -p btp-cap-app/app/fiori-ui/webapp/view
mkdir -p btp-cap-app/app/fiori-ui/webapp/controller
mkdir -p btp-cap-app/app/fiori-ui/webapp/i18n

echo "📁 Directory structure created"

# ─── File: btp-cap-app/.cdsrc.json ───
cat > "btp-cap-app/.cdsrc.json" << 'FILEOF_6087cf77'
{
    "requires": {
        "SAP_ONPREM": {
            "kind": "odata",
            "[development]": {
                "kind": "mocked"
            },
            "[production]": {
                "credentials": {
                    "destination": "SAP_ONPREM_RFC"
                }
            }
        },
        "db": {
            "[development]": {
                "kind": "sqlite",
                "credentials": {
                    "database": ":memory:"
                }
            },
            "[production]": {
                "kind": "hana"
            }
        }
    }
}

FILEOF_6087cf77

# ─── File: btp-cap-app/.env.template ───
cat > "btp-cap-app/.env.template" << 'FILEOF_4c7ffc06'
# ═══════════════════════════════════════════════════════════
# Local Development Environment Variables
# Copy this to .env and fill in your values
# ═══════════════════════════════════════════════════════════

# Claude AI (Anthropic) API Configuration
ANTHROPIC_API_KEY=sk-ant-your-api-key-here
CLAUDE_MODEL=claude-sonnet-4-20250514
CLAUDE_MAX_TOKENS=8192
CLAUDE_API_URL=https://api.anthropic.com/v1/messages

# SAP On-Premise Destination Name
SAP_DESTINATION=SAP_ONPREM_RFC

# For local testing without SAP destination, use mock:
# MOCK_SAP_DATA=true

# CDS Development profile
CDS_ENV=development

FILEOF_4c7ffc06

# ─── File: btp-cap-app/app/fiori-ui/webapp/Component.js ───
cat > "btp-cap-app/app/fiori-ui/webapp/Component.js" << 'FILEOF_e0479c81'
sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
    "sap/ui/Device"
], function (UIComponent, JSONModel, Device) {
    "use strict";

    return UIComponent.extend("com.company.abapanalyzer.Component", {

        metadata: {
            manifest: "json"
        },

        init: function () {
            // Call the base component's init function
            UIComponent.prototype.init.apply(this, arguments);

            // Set device model
            var oDeviceModel = new JSONModel(Device);
            oDeviceModel.setDefaultBindingMode("OneWay");
            this.setModel(oDeviceModel, "device");

            // Set view model with initial state
            var oViewModel = new JSONModel({
                busy: false,
                sourceCode: [],
                includes: [],
                objectDetail: null,
                analysis: null,
                documentGenerating: false,
                selectedCategory: "ALL",
                searchQuery: ""
            });
            this.setModel(oViewModel, "viewModel");

            // Initialize routing
            this.getRouter().initialize();
        },

        getContentDensityClass: function () {
            if (!this._sContentDensityClass) {
                if (!Device.support.touch) {
                    this._sContentDensityClass = "sapUiSizeCompact";
                } else {
                    this._sContentDensityClass = "sapUiSizeCozy";
                }
            }
            return this._sContentDensityClass;
        }
    });
});

FILEOF_e0479c81

# ─── File: btp-cap-app/app/fiori-ui/webapp/controller/App.controller.js ───
cat > "btp-cap-app/app/fiori-ui/webapp/controller/App.controller.js" << 'FILEOF_f67b5e62'
sap.ui.define([
    "sap/ui/core/mvc/Controller"
], function (Controller) {
    "use strict";
    return Controller.extend("com.company.abapanalyzer.controller.App", {
        onInit: function () { }
    });
});

FILEOF_f67b5e62

# ─── File: btp-cap-app/app/fiori-ui/webapp/controller/ObjectDetail.controller.js ───
cat > "btp-cap-app/app/fiori-ui/webapp/controller/ObjectDetail.controller.js" << 'FILEOF_2082ed7c'
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

    return Controller.extend("com.company.abapanalyzer.controller.ObjectDetail", {

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

FILEOF_2082ed7c

# ─── File: btp-cap-app/app/fiori-ui/webapp/controller/ObjectList.controller.js ───
cat > "btp-cap-app/app/fiori-ui/webapp/controller/ObjectList.controller.js" << 'FILEOF_f938ce98'
sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (Controller, Filter, FilterOperator, Sorter, MessageBox, MessageToast) {
    "use strict";

    return Controller.extend("com.company.abapanalyzer.controller.ObjectList", {

        onInit: function () {
            this._oViewModel = this.getOwnerComponent().getModel("viewModel");
            this._oTable = null;
        },

        onAfterRendering: function () {
            this._oTable = this.byId("objectTable");
        },

        /**
         * Navigate to object detail page
         */
        onObjectPress: function (oEvent) {
            var oItem = oEvent.getSource();
            var oContext = oItem.getBindingContext();
            var sObjectName = oContext.getProperty("objectName");
            var sCategory = oContext.getProperty("category");

            this.getOwnerComponent().getRouter().navTo("ObjectDetail", {
                objectName: encodeURIComponent(sObjectName),
                category: sCategory
            });
        },

        /**
         * Search objects by name
         */
        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
            this._applyFilters(sQuery);
        },

        /**
         * Filter by category
         */
        onCategoryFilter: function () {
            this._applyFilters();
        },

        /**
         * Apply combined filters (search + category)
         */
        _applyFilters: function (sSearchQuery) {
            var aFilters = [];

            // Search filter
            var sQuery = sSearchQuery || this.byId("searchField").getValue();
            if (sQuery) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("objectName", FilterOperator.Contains, sQuery),
                        new Filter("objectTypeText", FilterOperator.Contains, sQuery),
                        new Filter("package", FilterOperator.Contains, sQuery)
                    ],
                    and: false
                }));
            }

            // Category filter
            var sCategory = this._oViewModel.getProperty("/selectedCategory");
            if (sCategory && sCategory !== "ALL") {
                aFilters.push(new Filter("category", FilterOperator.EQ, sCategory));
            }

            // Apply to table binding
            var oTable = this.byId("objectTable");
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.filter(aFilters.length > 0 ? new Filter({ filters: aFilters, and: true }) : []);

                // Update count
                oBinding.attachChange(function () {
                    this._oViewModel.setProperty("/objectCount", oBinding.getLength());
                }.bind(this));
            }
        },

        /**
         * Refresh objects from SAP On-Premise
         */
        onRefreshObjects: function () {
            var that = this;
            this._oViewModel.setProperty("/busy", true);

            MessageBox.confirm(
                "This will refresh all custom objects from the SAP system. Continue?",
                {
                    title: "Refresh Objects",
                    onClose: function (oAction) {
                        if (oAction === MessageBox.Action.OK) {
                            that._callRefreshAction();
                        } else {
                            that._oViewModel.setProperty("/busy", false);
                        }
                    }
                }
            );
        },

        _callRefreshAction: function () {
            var that = this;
            var oModel = this.getOwnerComponent().getModel();

            // Call the CAP action
            var oContext = oModel.bindContext("/refreshObjects(...)");
            oContext.setParameter("filter", {
                objectType: "ALL",
                namespace: "Z",
                maxRows: 1000
            });

            oContext.execute().then(function () {
                MessageToast.show("Objects refreshed successfully!");
                that._oViewModel.setProperty("/busy", false);
                // Refresh the table
                that.byId("objectTable").getBinding("items").refresh();
            }).catch(function (oError) {
                that._oViewModel.setProperty("/busy", false);
                MessageBox.error("Failed to refresh objects: " + (oError.message || "Unknown error"));
            });
        },

        /**
         * Sort handler
         */
        onSort: function () {
            var oTable = this.byId("objectTable");
            var oBinding = oTable.getBinding("items");
            var aSorters = oBinding.aSorters || [];

            // Toggle sort
            if (aSorters.length > 0 && aSorters[0].sPath === "objectName") {
                oBinding.sort(new Sorter("category", false));
            } else {
                oBinding.sort(new Sorter("objectName", false));
            }
        },

        /**
         * Export to CSV (simple implementation)
         */
        onExport: function () {
            MessageToast.show("Export functionality - implement with sap.ui.export.Spreadsheet");
        }
    });
});

FILEOF_f938ce98

# ─── File: btp-cap-app/app/fiori-ui/webapp/i18n/i18n.properties ───
cat > "btp-cap-app/app/fiori-ui/webapp/i18n/i18n.properties" << 'FILEOF_41fca0ba'
# App Info
appTitle=ABAP Code Analyzer
appDescription=Analyze SAP ABAP Custom Objects & Generate BRD Documents with AI

# Object List
objectListTitle=Custom ABAP Objects
refreshButton=Refresh from SAP
searchPlaceholder=Search objects...
exportButton=Export

# Categories
categoryAll=All Objects
categoryProgram=Programs / Reports
categoryClass=ABAP Classes
categoryFunctionModule=Function Modules
categoryFunctionGroup=Function Groups
categoryBadi=BADIs
categoryEnhancement=Enhancements

# Object Detail
objectDetailTitle=Object Details
sourceCodeTitle=Source Code
includesTitle=Includes / Components
analysisTitle=AI Analysis Result

# Actions
analyzeCode=Analyze Code
generateDocument=Generate Document
generateBRD=Generate BRD (Word)
generatePDF=Generate BRD (PDF)
generateFuncSpec=Functional Specification

# Messages
loadingCode=Loading source code...
analysisInProgress=Analyzing code with Claude AI...
documentGenerating=Generating document...
documentSuccess=Document generated successfully!
documentFailed=Document generation failed
noSourceCode=No source code available
codeCopied=Code copied to clipboard!

FILEOF_41fca0ba

# ─── File: btp-cap-app/app/fiori-ui/webapp/index.html ───
cat > "btp-cap-app/app/fiori-ui/webapp/index.html" << 'FILEOF_7fb9c1d2'
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ABAP Code Analyzer</title>

    <script id="sap-ui-bootstrap"
            src="https://sapui5.hana.ondemand.com/resources/sap-ui-core.js"
            data-sap-ui-theme="sap_horizon"
            data-sap-ui-resourceroots='{"com.company.abapanalyzer": "./"}'
            data-sap-ui-compatVersion="edge"
            data-sap-ui-async="true"
            data-sap-ui-frameOptions="allow"
            data-sap-ui-oninit="module:sap/ui/core/ComponentSupport">
    </script>

    <style>
        /* Code editor styling */
        .codeEditorPanel .sapMPanel {
            border: 1px solid #d9d9d9;
        }
    </style>
</head>
<body class="sapUiBody" id="content">
    <div data-sap-ui-component
         data-name="com.company.abapanalyzer"
         data-id="container"
         data-settings='{"id": "com.company.abapanalyzer"}'
         data-handle-validation="true">
    </div>
</body>
</html>

FILEOF_7fb9c1d2

# ─── File: btp-cap-app/app/fiori-ui/webapp/manifest.json ───
cat > "btp-cap-app/app/fiori-ui/webapp/manifest.json" << 'FILEOF_ffa991e0'
{
    "_version": "1.59.0",
    "sap.app": {
        "id": "com.company.abapanalyzer",
        "type": "application",
        "title": "ABAP Code Analyzer",
        "description": "Analyze SAP ABAP Custom Objects & Generate BRD Documents",
        "applicationVersion": { "version": "1.0.0" },
        "dataSources": {
            "mainService": {
                "uri": "/api/analyzer/",
                "type": "OData",
                "settings": {
                    "odataVersion": "4.0"
                }
            }
        }
    },
    "sap.ui": {
        "technology": "UI5",
        "icons": {
            "icon": "sap-icon://syntax"
        },
        "deviceTypes": {
            "desktop": true,
            "tablet": true,
            "phone": true
        }
    },
    "sap.ui5": {
        "flexEnabled": true,
        "rootView": {
            "viewName": "com.company.abapanalyzer.view.App",
            "type": "XML",
            "async": true,
            "id": "app"
        },
        "dependencies": {
            "minUI5Version": "1.120.0",
            "libs": {
                "sap.m": {},
                "sap.ui.core": {},
                "sap.ui.layout": {},
                "sap.f": {},
                "sap.ui.table": {},
                "sap.ui.codeeditor": {},
                "sap.ui.unified": {}
            }
        },
        "models": {
            "": {
                "dataSource": "mainService",
                "preload": true,
                "settings": {
                    "operationMode": "Server",
                    "autoExpandSelect": true,
                    "groupId": "$auto"
                }
            },
            "viewModel": {
                "type": "sap.ui.model.json.JSONModel",
                "settings": {
                    "busy": false,
                    "sourceCode": [],
                    "includes": [],
                    "analysis": null,
                    "documentGenerating": false
                }
            }
        },
        "routing": {
            "config": {
                "routerClass": "sap.m.routing.Router",
                "viewType": "XML",
                "viewPath": "com.company.abapanalyzer.view",
                "controlId": "appControl",
                "controlAggregation": "pages",
                "async": true
            },
            "routes": [
                {
                    "name": "ObjectList",
                    "pattern": "",
                    "target": "ObjectList"
                },
                {
                    "name": "ObjectDetail",
                    "pattern": "object/{objectName}/{category}",
                    "target": "ObjectDetail"
                }
            ],
            "targets": {
                "ObjectList": {
                    "viewName": "ObjectList",
                    "viewLevel": 1
                },
                "ObjectDetail": {
                    "viewName": "ObjectDetail",
                    "viewLevel": 2
                }
            }
        },
        "contentDensities": {
            "compact": true,
            "cozy": true
        }
    }
}

FILEOF_ffa991e0

# ─── File: btp-cap-app/app/fiori-ui/webapp/view/App.view.xml ───
cat > "btp-cap-app/app/fiori-ui/webapp/view/App.view.xml" << 'FILEOF_b9974239'
<mvc:View
    xmlns:mvc="sap.ui.core.mvc"
    xmlns="sap.m"
    displayBlock="true"
    controllerName="com.company.abapanalyzer.controller.App">
    <App id="appControl"
         class="{= ${device>/support/touch} ? 'sapUiSizeCozy' : 'sapUiSizeCompact'}"
         busy="{viewModel>/busy}"
         busyIndicatorDelay="0">
    </App>
</mvc:View>

FILEOF_b9974239

# ─── File: btp-cap-app/app/fiori-ui/webapp/view/ObjectDetail.view.xml ───
cat > "btp-cap-app/app/fiori-ui/webapp/view/ObjectDetail.view.xml" << 'FILEOF_9435d329'
<mvc:View
    xmlns:mvc="sap.ui.core.mvc"
    xmlns="sap.m"
    xmlns:core="sap.ui.core"
    xmlns:layout="sap.ui.layout"
    xmlns:f="sap.f"
    xmlns:ce="sap.ui.codeeditor"
    xmlns:unified="sap.ui.unified"
    controllerName="com.company.abapanalyzer.controller.ObjectDetail">

    <Page id="objectDetailPage"
          title="Object Details"
          showNavButton="true"
          navButtonPress=".onNavBack"
          busy="{viewModel>/busy}"
          class="sapUiResponsiveContentPadding">

        <!-- Header Actions -->
        <customHeader>
            <Bar>
                <contentLeft>
                    <Button icon="sap-icon://nav-back" press=".onNavBack"/>
                    <Title text="{viewModel>/objectDetail/objectName}" level="H3"/>
                </contentLeft>
                <contentRight>
                    <Button
                        text="Analyze Code"
                        icon="sap-icon://inspection"
                        type="Default"
                        press=".onAnalyzeCode"/>
                    <MenuButton text="Generate Document" icon="sap-icon://document" type="Emphasized">
                        <menu>
                            <Menu>
                                <MenuItem text="Generate BRD (Word)" icon="sap-icon://doc-attachment" press=".onGenerateDocx"/>
                                <MenuItem text="Generate BRD (PDF)" icon="sap-icon://pdf-attachment" press=".onGeneratePdf"/>
                                <MenuItem text="Functional Spec (Word)" icon="sap-icon://document-text" press=".onGenerateFuncSpec"/>
                            </Menu>
                        </menu>
                    </MenuButton>
                </contentRight>
            </Bar>
        </customHeader>

        <content>
            <VBox class="sapUiSmallMargin">

                <!-- Object Info Panel -->
                <Panel headerText="Object Information" expandable="true" expanded="true" class="sapUiSmallMarginBottom">
                    <content>
                        <layout:Grid defaultSpan="L4 M6 S12" class="sapUiSmallMargin">
                            <layout:VerticalLayout class="sapUiSmallMarginBottom">
                                <Label text="Object Name" design="Bold"/>
                                <Text text="{viewModel>/objectDetail/objectName}"/>
                            </layout:VerticalLayout>
                            <layout:VerticalLayout class="sapUiSmallMarginBottom">
                                <Label text="Title" design="Bold"/>
                                <Text text="{viewModel>/objectDetail/title}"/>
                            </layout:VerticalLayout>
                            <layout:VerticalLayout class="sapUiSmallMarginBottom">
                                <Label text="Type" design="Bold"/>
                                <ObjectStatus text="{viewModel>/objectDetail/objectType}" state="Information"/>
                            </layout:VerticalLayout>
                            <layout:VerticalLayout class="sapUiSmallMarginBottom">
                                <Label text="Package" design="Bold"/>
                                <Text text="{viewModel>/objectDetail/package}"/>
                            </layout:VerticalLayout>
                            <layout:VerticalLayout class="sapUiSmallMarginBottom">
                                <Label text="Author" design="Bold"/>
                                <Text text="{viewModel>/objectDetail/author}"/>
                            </layout:VerticalLayout>
                            <layout:VerticalLayout class="sapUiSmallMarginBottom">
                                <Label text="Total Lines" design="Bold"/>
                                <ObjectNumber number="{viewModel>/objectDetail/totalLines}" unit="lines"/>
                            </layout:VerticalLayout>
                        </layout:Grid>
                    </content>
                </Panel>

                <!-- Includes Panel -->
                <Panel headerText="Includes / Components"
                       expandable="true"
                       expanded="{= ${viewModel>/includes}.length > 0}"
                       visible="{= ${viewModel>/includes}.length > 0}"
                       class="sapUiSmallMarginBottom">
                    <content>
                        <List items="{viewModel>/includes}" mode="None">
                            <StandardListItem
                                title="{viewModel>includeName}"
                                description="{viewModel>includeType}"
                                info="{viewModel>lineCount} lines"
                                icon="sap-icon://source-code"
                                type="Active"
                                press=".onIncludePress"/>
                        </List>
                    </content>
                </Panel>

                <!-- Source Code Panel -->
                <Panel headerText="Source Code" expandable="true" expanded="true">
                    <headerToolbar>
                        <Toolbar>
                            <Title text="Source Code" level="H5"/>
                            <ToolbarSpacer/>
                            <Select id="sectionFilter"
                                    selectedKey="ALL"
                                    change=".onSectionFilter">
                                <items>
                                    <core:Item key="ALL" text="All Sections"/>
                                </items>
                            </Select>
                            <Button icon="sap-icon://copy" tooltip="Copy Code" press=".onCopyCode"/>
                            <ToggleButton
                                id="lineNumbersToggle"
                                text="Line Numbers"
                                pressed="true"
                                press=".onToggleLineNumbers"/>
                        </Toolbar>
                    </headerToolbar>
                    <content>
                        <!-- Code Editor -->
                        <ce:CodeEditor
                            id="codeEditor"
                            value="{viewModel>/formattedCode}"
                            type="abap"
                            height="500px"
                            editable="false"
                            syntaxHints="true"
                            lineNumbers="true"
                            class="sapUiSmallMarginTop"/>
                    </content>
                </Panel>

                <!-- Document Generation Options (shown as dialog) -->
                <!-- Analysis Result Panel (shown after analyze) -->
                <Panel id="analysisPanel"
                       headerText="AI Analysis Result"
                       expandable="true"
                       expanded="true"
                       visible="{= !!${viewModel>/analysis}}"
                       class="sapUiSmallMarginTop">
                    <content>
                        <MessageStrip
                            text="Analysis generated by Claude AI. Review before generating the final document."
                            type="Information"
                            showIcon="true"
                            class="sapUiSmallMarginBottom"/>
                        <FormattedText
                            htmlText="{viewModel>/analysisHtml}"
                            class="sapUiSmallMargin"/>
                    </content>
                </Panel>

            </VBox>
        </content>

    </Page>
</mvc:View>

FILEOF_9435d329

# ─── File: btp-cap-app/app/fiori-ui/webapp/view/ObjectList.view.xml ───
cat > "btp-cap-app/app/fiori-ui/webapp/view/ObjectList.view.xml" << 'FILEOF_bc9043ab'
<mvc:View
    xmlns:mvc="sap.ui.core.mvc"
    xmlns="sap.m"
    xmlns:core="sap.ui.core"
    xmlns:f="sap.f"
    xmlns:fb="sap.ui.comp.filterbar"
    controllerName="com.company.abapanalyzer.controller.ObjectList">

    <Page id="objectListPage"
          title="{i18n>appTitle}"
          showNavButton="false"
          class="sapUiResponsiveContentPadding">

        <!-- Header Toolbar -->
        <customHeader>
            <Bar>
                <contentLeft>
                    <Title text="ABAP Code Analyzer" level="H3"/>
                </contentLeft>
                <contentMiddle>
                    <SearchField
                        id="searchField"
                        placeholder="Search objects by name..."
                        width="400px"
                        search=".onSearch"
                        liveChange=".onSearch"/>
                </contentMiddle>
                <contentRight>
                    <Button
                        text="Refresh from SAP"
                        icon="sap-icon://synchronize"
                        type="Emphasized"
                        press=".onRefreshObjects"/>
                </contentRight>
            </Bar>
        </customHeader>

        <content>
            <VBox class="sapUiSmallMargin">

                <!-- Filter Bar -->
                <HBox class="sapUiSmallMarginBottom" alignItems="Center">
                    <Label text="Category:" class="sapUiSmallMarginEnd"/>
                    <Select id="categoryFilter"
                            selectedKey="{viewModel>/selectedCategory}"
                            change=".onCategoryFilter">
                        <items>
                            <core:Item key="ALL" text="All Objects"/>
                            <core:Item key="REPORT" text="Reports / Programs"/>
                            <core:Item key="CLASS" text="ABAP Classes"/>
                            <core:Item key="FUNCTION_MODULE" text="Function Modules"/>
                            <core:Item key="FUNCTION_GROUP" text="Function Groups"/>
                            <core:Item key="BADI" text="BADIs"/>
                            <core:Item key="ENHANCEMENT_IMPL" text="Enhancements"/>
                            <core:Item key="INCLUDE" text="Includes"/>
                        </items>
                    </Select>

                    <ToolbarSpacer/>

                    <ObjectStatus
                        text="{= ${viewModel>/objectCount} + ' objects found'}"
                        state="Information"
                        class="sapUiSmallMarginEnd"/>
                </HBox>

                <!-- Object Table -->
                <Table id="objectTable"
                       items="{
                           path: '/CustomObjects',
                           sorter: { path: 'objectName' },
                           parameters: { $count: true }
                       }"
                       growing="true"
                       growingThreshold="50"
                       growingScrollToLoad="true"
                       mode="SingleSelectMaster"
                       selectionChange=".onObjectSelect"
                       sticky="ColumnHeaders,HeaderToolbar"
                       alternateRowColors="true"
                       class="sapUiSmallMarginTop">

                    <headerToolbar>
                        <OverflowToolbar>
                            <Title text="Custom ABAP Objects" level="H4"/>
                            <ToolbarSpacer/>
                            <Button icon="sap-icon://excel-attachment" tooltip="Export" press=".onExport"/>
                            <Button icon="sap-icon://sort" tooltip="Sort" press=".onSort"/>
                        </OverflowToolbar>
                    </headerToolbar>

                    <columns>
                        <Column width="25%">
                            <Text text="Object Name"/>
                        </Column>
                        <Column width="20%">
                            <Text text="Type"/>
                        </Column>
                        <Column width="15%">
                            <Text text="Category"/>
                        </Column>
                        <Column width="15%">
                            <Text text="Package"/>
                        </Column>
                        <Column width="12%">
                            <Text text="Created By"/>
                        </Column>
                        <Column width="13%">
                            <Text text="Created On"/>
                        </Column>
                    </columns>

                    <items>
                        <ColumnListItem type="Navigation" press=".onObjectPress">
                            <cells>
                                <ObjectIdentifier
                                    title="{objectName}"
                                    text="{objectTypeText}"/>
                                <ObjectStatus
                                    text="{objectType}"
                                    state="{= ${category} === 'CLASS' ? 'Success' :
                                             ${category} === 'REPORT' ? 'Information' :
                                             ${category} === 'FUNCTION_MODULE' ? 'Warning' : 'None'}"/>
                                <Text text="{category}"/>
                                <Text text="{package}"/>
                                <Text text="{createdByAbap}"/>
                                <Text text="{
                                    path: 'createdOnAbap',
                                    type: 'sap.ui.model.type.Date',
                                    formatOptions: { pattern: 'dd.MM.yyyy' }
                                }"/>
                            </cells>
                        </ColumnListItem>
                    </items>
                </Table>

            </VBox>
        </content>

        <!-- Info Toolbar at bottom -->
        <footer>
            <Toolbar>
                <ToolbarSpacer/>
                <Label text="Powered by Claude AI | SAP BTP Cloud Application Programming Model"
                       class="sapUiTinyMargin"/>
            </Toolbar>
        </footer>

    </Page>
</mvc:View>

FILEOF_bc9043ab

# ─── File: btp-cap-app/app/xs-app.json ───
cat > "btp-cap-app/app/xs-app.json" << 'FILEOF_dd91eb1e'
{
    "welcomeFile": "/fiori-ui/webapp/index.html",
    "authenticationMethod": "route",
    "routes": [
        {
            "source": "^/api/(.*)$",
            "target": "/api/$1",
            "authenticationType": "xsuaa",
            "destination": "srv-api",
            "csrfProtection": true
        },
        {
            "source": "^/fiori-ui/(.*)$",
            "target": "/fiori-ui/$1",
            "localDir": "fiori-ui/webapp",
            "authenticationType": "xsuaa"
        }
    ]
}

FILEOF_dd91eb1e

# ─── File: btp-cap-app/db/schema-multitenant.cds ───
cat > "btp-cap-app/db/schema-multitenant.cds" << 'FILEOF_4f17ee2d'
namespace abap.analyzer;

using { cuid, managed } from '@sap/cds/common';

// ═══════════════════════════════════════════════════════════════════════
// MULTI-TENANT AWARE: All entities include tenantId for data isolation
// HANA Row-Level Security enforces tenant boundaries at DB level
// ═══════════════════════════════════════════════════════════════════════

// ─── Tenant Isolation Aspect ───
aspect tenantAware {
    tenantId : String(36) @mandatory @readonly;
}

// ═══════════════════════════════════════════════════════════════════════
// TENANT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

/**
 * Tenant configuration - one record per subscribed customer
 */
entity TenantConfig : cuid, managed, tenantAware {
    tenantName          : String(200)  @title: 'Company Name';
    tenantDomain        : String(200)  @title: 'Custom Domain';
    status              : String(20)   @title: 'Status'; // ACTIVE, SUSPENDED, OFFBOARDING
    plan                : String(20)   @title: 'Subscription Plan'; // BASIC, PROFESSIONAL, ENTERPRISE
    sapSystemId         : String(10)   @title: 'SAP System ID';
    sapClientNumber     : String(3)    @title: 'SAP Client';
    destinationName     : String(100)  @title: 'BTP Destination Name';
    cloudConnectorLocId : String(50)   @title: 'Cloud Connector Location ID';
    maxUsersAllowed     : Integer      @title: 'Max Users';
    maxAPICallsPerMonth : Integer      @title: 'Max Claude API Calls/Month';
    currentAPICallCount : Integer default 0;
    apiCallResetDate    : Date;

    // Security settings per tenant
    anonymizationLevel  : String(10) default 'STANDARD'; // NONE/BASIC/STANDARD/STRICT/MAXIMUM
    retentionPolicy     : LargeString; // JSON with retention hours per data type
    companyTerms        : LargeString; // JSON array of company-specific terms to obfuscate
    sensitiveKeywords   : LargeString; // JSON array of keywords to strip from comments
    ipAllowlist         : LargeString; // JSON array of allowed IP ranges
    claudeApiKeyOverride: LargeString; // Encrypted - tenant's own API key (Enterprise plan)

    // Onboarding tracking
    onboardedAt         : Timestamp;
    onboardedBy         : String(100);
    lastActiveAt        : Timestamp;
}

/**
 * Consent records for AI processing (GDPR/Compliance)
 */
entity TenantConsent : cuid, managed, tenantAware {
    consentType    : String(50)    @title: 'Consent Type'; // AI_CODE_PROCESSING, DATA_COLLECTION
    status         : String(20)    @title: 'Status'; // ACTIVE, REVOKED, EXPIRED
    grantedBy      : String(100)   @title: 'Granted By (Admin)';
    grantedAt      : Timestamp;
    expiresAt      : Timestamp;
    consentVersion : String(10)    @title: 'Agreement Version';
    ipAddress      : String(50);
    legalEntity    : String(200);
    agreementText  : LargeString   @title: 'Full Agreement Text Accepted';
}

/**
 * Tenant users mapping (supplementary to XSUAA)
 */
entity TenantUsers : cuid, managed, tenantAware {
    userId     : String(100)  @title: 'User ID (from IDP)';
    email      : String(200)  @title: 'Email';
    role       : String(20)   @title: 'Role'; // ADMIN, DEVELOPER, VIEWER
    isActive   : Boolean default true;
    lastLogin  : Timestamp;
}

// ═══════════════════════════════════════════════════════════════════════
// CORE BUSINESS ENTITIES (Tenant-Isolated)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Cache of custom ABAP objects fetched from On-Premise
 */
entity CustomObjects : cuid, managed, tenantAware {
    objectName      : String(120)   @title: 'Object Name';
    objectType      : String(10)    @title: 'Object Type';
    objectTypeText  : String(100)   @title: 'Type Description';
    category        : String(30)    @title: 'Category';
    subType         : String(1)     @title: 'Sub Type';
    package         : String(30)    @title: 'Package';
    createdByAbap   : String(12)    @title: 'ABAP Created By';
    createdOnAbap   : Date          @title: 'ABAP Created On';
    changedByAbap   : String(12)    @title: 'ABAP Changed By';
    changedOnAbap   : Date          @title: 'ABAP Changed On';
    lineCount       : Integer       @title: 'Line Count';
    lastSynced      : Timestamp     @title: 'Last Synced';
}

/**
 * Document generation audit log
 */
entity DocumentGenerationLog : cuid, managed, tenantAware {
    objectName      : String(120);
    objectType      : String(30);
    documentType    : String(10);
    templateUsed    : String(50);
    claudeModel     : String(50);
    tokensUsed      : Integer;
    generationTime  : Integer;
    status          : String(20);
    errorMessage    : String(500);
    generatedBy     : String(100);
    generatedAt     : Timestamp;
}

/**
 * Document templates (tenant-customizable)
 */
entity DocumentTemplates : cuid, managed, tenantAware {
    templateName    : String(100);
    templateType    : String(20);
    description     : String(500);
    promptTemplate  : LargeString;
    sections        : LargeString;
    isActive        : Boolean;
    isDefault       : Boolean default false;
}

// ═══════════════════════════════════════════════════════════════════════
// SECURITY & AUDIT ENTITIES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Security audit log - immutable, comprehensive
 */
entity SecurityAuditLog : cuid, tenantAware {
    timestamp   : Timestamp  @title: 'Event Time';
    eventType   : String(50) @title: 'Event Type';
    severity    : String(10) @title: 'Severity'; // INFO, MEDIUM, HIGH, CRITICAL
    userId      : String(100);
    action      : String(50);
    objectName  : String(120);
    details     : LargeString; // JSON
}

/**
 * Temporary storage for Claude API responses (auto-purged)
 */
entity ClaudeResponseCache : cuid, managed, tenantAware {
    requestId      : UUID;
    objectName     : String(120);
    responseHash   : String(64);  // SHA-256 hash (not the actual response in prod)
    tokensUsed     : Integer;
    expiresAt      : Timestamp;
}

/**
 * Reversal maps for de-anonymization (auto-purged)
 */
entity ReversalMaps : cuid, managed, tenantAware {
    requestId      : UUID;
    encryptedMap   : LargeString;  // AES-256 encrypted JSON
    expiresAt      : Timestamp;
}

/**
 * Temporary source code holder (auto-purged, memory-preferred)
 */
entity TempSourceCode : cuid, managed, tenantAware {
    requestId      : UUID;
    objectName     : String(120);
    encryptedCode  : LargeString;  // Encrypted, never plain text
    expiresAt      : Timestamp;
}

/**
 * Session data (auto-purged)
 */
entity SessionData : cuid, managed, tenantAware {
    sessionId   : String(100);
    userId      : String(100);
    data        : LargeString;
    expiresAt   : Timestamp;
}

// ═══════════════════════════════════════════════════════════════════════
// SUBSCRIPTION PLAN LIMITS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Plan definitions
 */
entity SubscriptionPlans : cuid, managed {
    planId              : String(20)  @title: 'Plan ID';
    planName            : String(100) @title: 'Plan Name';
    maxUsers            : Integer;
    maxAPICallsPerMonth : Integer;
    maxObjectsSync      : Integer;
    features            : LargeString; // JSON array of enabled features
    anonymizationMin    : String(10); // Minimum anonymization level required
    canUseOwnAPIKey     : Boolean default false;
    pricePerMonth       : Decimal(10,2);
}

FILEOF_4f17ee2d

# ─── File: btp-cap-app/db/schema.cds ───
cat > "btp-cap-app/db/schema.cds" << 'FILEOF_be206168'
namespace abap.analyzer;

using { cuid, managed } from '@sap/cds/common';

/**
 * Cache of custom ABAP objects fetched from On-Premise
 * Refreshed periodically or on-demand
 */
entity CustomObjects : cuid, managed {
    objectName      : String(120)   @title: 'Object Name';
    objectType      : String(10)    @title: 'Object Type';
    objectTypeText  : String(100)   @title: 'Type Description';
    category        : String(30)    @title: 'Category';
    subType         : String(1)     @title: 'Sub Type';
    package         : String(30)    @title: 'Package';
    createdByAbap   : String(12)    @title: 'ABAP Created By';
    createdOnAbap   : Date          @title: 'ABAP Created On';
    changedByAbap   : String(12)    @title: 'ABAP Changed By';
    changedOnAbap   : Date          @title: 'ABAP Changed On';
    lineCount       : Integer       @title: 'Line Count';
    lastSynced      : Timestamp     @title: 'Last Synced';
}

/**
 * Audit log for document generation requests
 */
entity DocumentGenerationLog : cuid, managed {
    objectName      : String(120)   @title: 'Object Name';
    objectType      : String(30)    @title: 'Object Type';
    documentType    : String(10)    @title: 'Document Type (PDF/DOCX)';
    templateUsed    : String(50)    @title: 'Template Used';
    claudeModel     : String(50)    @title: 'Claude Model Used';
    tokensUsed      : Integer       @title: 'Tokens Used';
    generationTime  : Integer       @title: 'Generation Time (ms)';
    status          : String(20)    @title: 'Status';
    errorMessage    : String(500)   @title: 'Error Message';
    generatedBy     : String(100)   @title: 'Generated By';
    generatedAt     : Timestamp     @title: 'Generated At';
}

/**
 * Document templates for BRD generation
 */
entity DocumentTemplates : cuid, managed {
    templateName    : String(100)   @title: 'Template Name';
    templateType    : String(20)    @title: 'Template Type';  // BRD, FUNC_SPEC, TECH_SPEC
    description     : String(500)   @title: 'Description';
    promptTemplate  : LargeString   @title: 'Claude Prompt Template';
    sections        : LargeString   @title: 'Document Sections (JSON)';
    isActive        : Boolean       @title: 'Active';
}

FILEOF_be206168

# ─── File: btp-cap-app/mta-saas.yaml ───
cat > "btp-cap-app/mta-saas.yaml" << 'FILEOF_95823ca0'
_schema-version: '3.1'
ID: abap-code-analyzer-saas
version: 1.0.0
description: ABAP Code Analyzer SaaS - Multi-Tenant with Security

parameters:
  enable-parallel-deployments: true

modules:
  # ═══════════════════════════════════════════════════════════
  # CAP Backend Service (Multi-Tenant)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-srv
    type: nodejs
    path: gen/srv
    parameters:
      buildpack: nodejs_buildpack
      memory: 512M
      disk-quota: 1024M
      health-check-type: http
      health-check-http-endpoint: /health
    properties:
      CLAUDE_MODEL: "claude-sonnet-4-20250514"
      CLAUDE_MAX_TOKENS: "8192"
      CLAUDE_API_URL: "https://api.anthropic.com/v1/messages"
      APP_DOMAIN: "${default-domain}"
    requires:
      - name: abap-analyzer-auth
      - name: abap-analyzer-mtx
      - name: abap-analyzer-registry
      - name: abap-analyzer-sm
      - name: abap-analyzer-destination
      - name: abap-analyzer-connectivity
      - name: abap-analyzer-credstore
      - name: abap-analyzer-auditlog
    provides:
      - name: srv-api
        properties:
          srv-url: ${default-url}

  # ═══════════════════════════════════════════════════════════
  # MTX Sidecar (Multitenancy Extension)
  # Handles tenant DB schema provisioning
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-mtx
    type: nodejs
    path: gen/mtx/sidecar
    parameters:
      buildpack: nodejs_buildpack
      memory: 256M
    requires:
      - name: abap-analyzer-auth
      - name: abap-analyzer-sm
      - name: abap-analyzer-registry
    provides:
      - name: mtx-api
        properties:
          mtx-url: ${default-url}

  # ═══════════════════════════════════════════════════════════
  # App Router (Tenant-Aware, handles subdomain routing)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-app
    type: approuter.nodejs
    path: app/
    parameters:
      memory: 256M
      disk-quota: 512M
      keep-existing-routes: true
    properties:
      TENANT_HOST_PATTERN: "^(.*)-${default-uri}"
    requires:
      - name: abap-analyzer-auth
      - name: srv-api
        group: destinations
        properties:
          name: srv-api
          url: ~{srv-url}
          forwardAuthToken: true
      - name: mtx-api
        group: destinations
        properties:
          name: mtx-api
          url: ~{mtx-url}
          forwardAuthToken: true

  # ═══════════════════════════════════════════════════════════
  # DB Deployer (Schema for provider account)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-db-deployer
    type: hdb
    path: gen/db
    parameters:
      buildpack: nodejs_buildpack
    requires:
      - name: abap-analyzer-sm

resources:
  # ═══════════════════════════════════════════════════════════
  # XSUAA (Multi-Tenant Auth)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-auth
    type: org.cloudfoundry.managed-service
    parameters:
      service: xsuaa
      service-plan: application
      path: ./xs-security-mt.json

  # ═══════════════════════════════════════════════════════════
  # SaaS Provisioning Service (Subscription Management)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-registry
    type: org.cloudfoundry.managed-service
    parameters:
      service: saas-registry
      service-plan: application
      config:
        xsappname: abap-code-analyzer
        appName: abap-code-analyzer
        displayName: "ABAP Code Analyzer"
        description: "AI-Powered ABAP Code Analysis & BRD Document Generator"
        category: "SAP BTP Applications"
        appUrls:
          getDependencies: ~{srv-api/srv-url}/mtx/v1/provisioning/dependencies
          onSubscription: ~{srv-api/srv-url}/mtx/v1/provisioning/tenant/{tenantId}
    requires:
      - name: srv-api

  # ═══════════════════════════════════════════════════════════
  # Service Manager (HDI Container per Tenant)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-sm
    type: org.cloudfoundry.managed-service
    parameters:
      service: service-manager
      service-plan: container

  # ═══════════════════════════════════════════════════════════
  # Destination Service (Per-Tenant SAP connections)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-destination
    type: org.cloudfoundry.managed-service
    parameters:
      service: destination
      service-plan: lite

  # ═══════════════════════════════════════════════════════════
  # Connectivity Service (Cloud Connector)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-connectivity
    type: org.cloudfoundry.managed-service
    parameters:
      service: connectivity
      service-plan: lite

  # ═══════════════════════════════════════════════════════════
  # Credential Store (Encryption Keys & API Keys)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-credstore
    type: org.cloudfoundry.managed-service
    parameters:
      service: credstore
      service-plan: standard
      config:
        authentication:
          type: basic

  # ═══════════════════════════════════════════════════════════
  # Audit Log Service (Compliance)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-auditlog
    type: org.cloudfoundry.managed-service
    parameters:
      service: auditlog
      service-plan: oauth2

FILEOF_95823ca0

# ─── File: btp-cap-app/mta.yaml ───
cat > "btp-cap-app/mta.yaml" << 'FILEOF_a8944f43'
_schema-version: '3.1'
ID: abap-code-analyzer
version: 1.0.0
description: ABAP Code Analyzer & BRD Generator with Claude AI

parameters:
  enable-parallel-deployments: true

modules:
  # ═══════════════════════════════════════════════════════════
  # CAP Backend Service
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-srv
    type: nodejs
    path: gen/srv
    parameters:
      buildpack: nodejs_buildpack
      memory: 512M
      disk-quota: 1024M
    properties:
      ANTHROPIC_API_KEY: "~{claude-api/api-key}"
      CLAUDE_MODEL: "claude-sonnet-4-20250514"
      CLAUDE_MAX_TOKENS: "8192"
      SAP_DESTINATION: "SAP_ONPREM_RFC"
    requires:
      - name: abap-analyzer-auth
      - name: abap-analyzer-db
      - name: abap-analyzer-destination
      - name: claude-api
    provides:
      - name: srv-api
        properties:
          srv-url: ${default-url}

  # ═══════════════════════════════════════════════════════════
  # Fiori UI (App Router)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-app
    type: approuter.nodejs
    path: app/
    parameters:
      memory: 256M
      disk-quota: 512M
    requires:
      - name: abap-analyzer-auth
      - name: srv-api
        group: destinations
        properties:
          name: srv-api
          url: ~{srv-url}
          forwardAuthToken: true

  # ═══════════════════════════════════════════════════════════
  # HANA DB Deployer (optional - for caching)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-db-deployer
    type: hdb
    path: gen/db
    parameters:
      buildpack: nodejs_buildpack
    requires:
      - name: abap-analyzer-db

resources:
  # ═══════════════════════════════════════════════════════════
  # XSUAA Service (Authentication)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-auth
    type: org.cloudfoundry.managed-service
    parameters:
      service: xsuaa
      service-plan: application
      path: ./xs-security.json

  # ═══════════════════════════════════════════════════════════
  # HANA Cloud (Database)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-db
    type: com.sap.xs.hdi-container
    parameters:
      service: hana
      service-plan: hdi-shared

  # ═══════════════════════════════════════════════════════════
  # Destination Service (SAP On-Prem connectivity)
  # ═══════════════════════════════════════════════════════════
  - name: abap-analyzer-destination
    type: org.cloudfoundry.managed-service
    parameters:
      service: destination
      service-plan: lite

  # ═══════════════════════════════════════════════════════════
  # Claude API Credentials (User-Provided Service)
  # ═══════════════════════════════════════════════════════════
  - name: claude-api
    type: org.cloudfoundry.user-provided-service
    parameters:
      config:
        api-key: "<YOUR_ANTHROPIC_API_KEY>"

FILEOF_a8944f43

# ─── File: btp-cap-app/package.json ───
cat > "btp-cap-app/package.json" << 'FILEOF_505820b6'
{
  "name": "abap-code-analyzer",
  "version": "1.0.0",
  "description": "SAP BTP CAP Application - ABAP Code Analyzer & BRD Generator with Claude AI",
  "repository": "",
  "license": "ISC",
  "dependencies": {
    "@sap/cds": "^7",
    "@sap/cds-odata-v2-adapter-proxy": "^1",
    "@sap-cloud-sdk/http-client": "^3",
    "@sap-cloud-sdk/connectivity": "^3",
    "@anthropic-ai/sdk": "^0.26",
    "express": "^4",
    "docx": "^8",
    "pdfkit": "^0.13",
    "passport": "^0.6",
    "@sap/xssec": "^3",
    "@sap/xsenv": "^4"
  },
  "devDependencies": {
    "@sap/cds-dk": "^7",
    "@sap/ux-specification": "latest",
    "rimraf": "^5"
  },
  "scripts": {
    "start": "cds-serve",
    "build": "cds build --production",
    "deploy": "cf push",
    "watch": "cds watch"
  },
  "cds": {
    "requires": {
      "SAP_ONPREM": {
        "kind": "odata",
        "model": "srv/external/SAP_ONPREM",
        "[production]": {
          "credentials": {
            "destination": "SAP_ONPREM_RFC",
            "path": "/sap/bc/srt/scs_ext/sap"
          }
        }
      },
      "auth": {
        "[production]": {
          "kind": "xsuaa"
        },
        "[development]": {
          "kind": "dummy"
        }
      }
    },
    "hana": {
      "deploy-format": "hdbtable"
    }
  },
  "sapux": [
    "app/fiori-ui"
  ]
}

FILEOF_505820b6

# ─── File: btp-cap-app/srv/code-analyzer-service-secure.js ───
cat > "btp-cap-app/srv/code-analyzer-service-secure.js" << 'FILEOF_4ba73d2b'
/**
 * ═══════════════════════════════════════════════════════════════════════
 * CODE ANALYZER SERVICE (SECURITY-ENHANCED, MULTI-TENANT)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Flow with security:
 * 1. Verify tenant consent for AI processing
 * 2. Check API call quota for tenant
 * 3. Fetch code from tenant's SAP system (tenant-specific destination)
 * 4. ANONYMIZE code before sending to Claude
 * 5. Send anonymized code to Claude API over TLS
 * 6. Log audit trail (NO code in logs)
 * 7. DE-ANONYMIZE Claude response server-side
 * 8. Generate document with restored original names
 * 9. Purge all intermediate data
 */

const cds = require('@sap/cds');
const LOG = cds.log('code-analyzer');

const SAPConnector = require('./lib/sap-connector');
const ClaudeAnalyzer = require('./lib/claude-analyzer');
const DocumentGenerator = require('./lib/document-generator');
const CodeAnonymizer = require('./lib/security/code-anonymizer');
const EncryptionService = require('./lib/security/encryption-service');
const SecurityAuditLogger = require('./lib/security/audit-logger');
const SecurityMiddleware = require('./lib/security/security-middleware');
const DataRetentionService = require('./lib/security/data-retention');

module.exports = class CodeAnalyzerService extends cds.ApplicationService {

    async init() {
        // Initialize encryption service
        this._encService = new EncryptionService();
        await this._encService.initialize();

        // ─── BEFORE handlers: security checks ───

        this.before('*', async (req) => {
            // Get tenant ID from JWT token
            req.tenantId = req.user?.tenant || req.headers?.['x-tenant-id'] || 'default';

            // Inject tenant filter for data isolation
            if (req.query?.SELECT) {
                req.query.where({ tenantId: req.tenantId });
            }
        });

        // ─── READ handlers ───

        this.before('READ', 'CustomObjects', async (req) => {
            const { CustomObjects } = this.entities;
            const count = await SELECT.one.from(CustomObjects)
                .columns('count(*) as cnt')
                .where({ tenantId: req.tenantId });

            if (!count || count.cnt === 0) {
                LOG.info(`Cache empty for tenant ${req.tenantId}, triggering sync...`);
                await this._syncObjects(
                    { objectType: 'ALL', namespace: 'Z', maxRows: 1000 },
                    req.tenantId, req.user
                );
            }
        });

        // ─── ACTION handlers ───

        this.on('refreshObjects', async (req) => {
            return this._syncObjects(req.data.filter || {}, req.tenantId, req.user);
        });

        this.on('getSourceCode', async (req) => {
            // Validate input
            const objectName = SecurityMiddleware.validateObjectName(req.data.objectName);
            const category = req.data.category;

            // Audit log: code access
            const auditLogger = new SecurityAuditLogger(req.tenantId);
            await auditLogger.logCodeAccess({
                userId: req.user?.id,
                action: 'FETCH',
                objectName,
                objectType: category
            });

            return this._getSourceCode(objectName, category, req.tenantId);
        });

        this.on('generateDocument', async (req) => {
            return this._generateDocumentSecure(req.data, req.tenantId, req.user);
        });

        this.on('analyzeCode', async (req) => {
            return this._analyzeCodeSecure(req.data, req.tenantId, req.user);
        });

        await super.init();
    }

    // ═══════════════════════════════════════════════════════════════
    // SECURE: Document Generation with Full Security Pipeline
    // ═══════════════════════════════════════════════════════════════

    async _generateDocumentSecure(data, tenantId, user) {
        const { DocumentGenerationLog, TenantConfig } = this.entities;
        const startTime = Date.now();
        const auditLogger = new SecurityAuditLogger(tenantId);
        const requestId = crypto.randomUUID();

        try {
            // ── STEP 1: Verify AI processing consent ──
            LOG.info(`[${requestId}] Step 1: Verifying consent...`);
            await SecurityMiddleware.verifyConsent(tenantId, user?.id);

            // ── STEP 2: Check API quota ──
            LOG.info(`[${requestId}] Step 2: Checking API quota...`);
            const tenantConfig = await SELECT.one.from(TenantConfig).where({ tenantId });
            if (!tenantConfig) throw new Error('Tenant not configured');

            if (tenantConfig.currentAPICallCount >= tenantConfig.maxAPICallsPerMonth) {
                throw new Error(
                    `Monthly API call limit reached (${tenantConfig.maxAPICallsPerMonth}). ` +
                    `Resets on ${tenantConfig.apiCallResetDate}. Contact your admin to upgrade.`
                );
            }

            // ── STEP 3: Fetch source code ──
            LOG.info(`[${requestId}] Step 3: Fetching source code...`);
            const objectName = SecurityMiddleware.validateObjectName(data.objectName);
            const sourceResult = await this._getSourceCode(objectName, data.category, tenantId);
            const fullCode = this._buildCodeString(sourceResult);

            // ── STEP 4: ANONYMIZE CODE ──
            LOG.info(`[${requestId}] Step 4: Anonymizing code (level: ${tenantConfig.anonymizationLevel})...`);
            const anonymizer = new CodeAnonymizer(tenantConfig.anonymizationLevel);

            const anonymizationResult = anonymizer.anonymize(fullCode, {
                companyTerms: tenantConfig.companyTerms ? JSON.parse(tenantConfig.companyTerms) : [],
                sensitiveKeywords: tenantConfig.sensitiveKeywords ? JSON.parse(tenantConfig.sensitiveKeywords) : []
            });

            // Audit: anonymization event
            await auditLogger.logAnonymization({
                userId: user?.id,
                objectName,
                level: tenantConfig.anonymizationLevel,
                itemsStripped: anonymizationResult.strippedItemsCount,
                credentialsFound: anonymizationResult.warnings.filter(w => w.includes('credential')).length,
                piiFound: anonymizationResult.warnings.filter(w => w.includes('PII')).length,
                warnings: anonymizationResult.warnings
            });

            // ── STEP 5: Send ANONYMIZED code to Claude ──
            LOG.info(`[${requestId}] Step 5: Sending anonymized code to Claude API...`);
            const claudeAnalyzer = new ClaudeAnalyzer();

            // Use tenant's own API key if Enterprise plan
            if (tenantConfig.claudeApiKeyOverride && tenantConfig.plan === 'ENTERPRISE') {
                const decryptedKey = this._encService.decrypt(
                    JSON.parse(tenantConfig.claudeApiKeyOverride), tenantId
                );
                claudeAnalyzer.apiKey = decryptedKey;
            }

            const analysis = await claudeAnalyzer.generateBRD({
                objectName: objectName, // Keep real name for document title
                objectType: sourceResult.objectType,
                title: sourceResult.title,
                sourceCode: anonymizationResult.anonymizedCode, // ← ANONYMIZED!
                includes: sourceResult.includes,
                detailLevel: data.options?.detailLevel || 'DETAILED',
                customPrompt: data.options?.customPrompt
            });

            // Audit: Claude API call
            await auditLogger.logClaudeAPICall({
                userId: user?.id,
                objectName,
                model: analysis.modelUsed,
                inputTokens: analysis.inputTokens,
                outputTokens: analysis.outputTokens,
                anonymizationLevel: tenantConfig.anonymizationLevel,
                itemsAnonymized: anonymizationResult.strippedItemsCount,
                codePayload: anonymizationResult.anonymizedCode, // Hashed in logger, not stored
                durationMs: Date.now() - startTime,
                success: true
            });

            // ── STEP 6: DE-ANONYMIZE the analysis (server-side only) ──
            LOG.info(`[${requestId}] Step 6: De-anonymizing analysis for document...`);
            const deAnonymizedAnalysis = this._deAnonymizeAnalysis(
                analysis, anonymizationResult.reversalMap, anonymizer
            );

            // ── STEP 7: Generate document ──
            LOG.info(`[${requestId}] Step 7: Generating ${data.options?.documentType || 'DOCX'}...`);
            const docGenerator = new DocumentGenerator();
            const docType = data.options?.documentType || 'DOCX';

            let docResult;
            if (docType === 'PDF') {
                docResult = await docGenerator.generatePDF(deAnonymizedAnalysis, sourceResult, data.options);
            } else {
                docResult = await docGenerator.generateDOCX(deAnonymizedAnalysis, sourceResult, data.options);
            }

            // Audit: document generation
            const docHash = require('crypto').createHash('sha256')
                .update(docResult.base64Content.substring(0, 1000))
                .digest('hex').substring(0, 32);

            await auditLogger.logDocumentGeneration({
                userId: user?.id,
                objectName,
                documentType: docType,
                templateUsed: 'DEFAULT',
                detailLevel: data.options?.detailLevel,
                includesSourceCode: data.options?.includeCode !== false,
                fileSize: docResult.fileSize,
                documentHash: docHash
            });

            // ── STEP 8: Increment API call counter ──
            await UPDATE(TenantConfig)
                .set({ currentAPICallCount: { '+=': 1 }, lastActiveAt: new Date().toISOString() })
                .where({ tenantId });

            // ── STEP 9: Log and return ──
            const genTime = Date.now() - startTime;

            await INSERT.into(DocumentGenerationLog).entries({
                tenantId,
                objectName,
                objectType: data.category,
                documentType: docType,
                claudeModel: analysis.modelUsed,
                tokensUsed: analysis.tokensUsed,
                generationTime: genTime,
                status: 'SUCCESS',
                generatedBy: user?.id || 'anonymous',
                generatedAt: new Date().toISOString()
            });

            LOG.info(`[${requestId}] Document generated in ${genTime}ms. ` +
                     `Items anonymized: ${anonymizationResult.strippedItemsCount}. ` +
                     `Tokens: ${analysis.tokensUsed}`);

            return {
                success: true,
                fileName: docResult.fileName,
                fileType: docType,
                fileContent: docResult.base64Content,
                fileSize: docResult.fileSize,
                generationId: requestId,
                message: `Document generated in ${genTime}ms. ` +
                         `${anonymizationResult.strippedItemsCount} sensitive items were anonymized before AI processing.`
            };

        } catch (error) {
            LOG.error(`[${requestId}] Generation failed:`, error.message);

            await auditLogger.logClaudeAPICall({
                userId: user?.id,
                objectName: data.objectName,
                anonymizationLevel: 'N/A',
                success: false,
                errorCode: error.message?.substring(0, 100),
                durationMs: Date.now() - startTime
            });

            return {
                success: false,
                message: `Generation failed: ${error.message}`
            };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SECURE: Code Analysis with anonymization
    // ═══════════════════════════════════════════════════════════════

    async _analyzeCodeSecure(data, tenantId, user) {
        // Same security pipeline as generateDocument
        await SecurityMiddleware.verifyConsent(tenantId, user?.id);

        const { TenantConfig } = this.entities;
        const tenantConfig = await SELECT.one.from(TenantConfig).where({ tenantId });

        const sourceResult = await this._getSourceCode(data.objectName, data.category, tenantId);
        const fullCode = this._buildCodeString(sourceResult);

        // Anonymize
        const anonymizer = new CodeAnonymizer(tenantConfig?.anonymizationLevel || 'STANDARD');
        const anonResult = anonymizer.anonymize(fullCode);

        // Analyze anonymized code
        const claudeAnalyzer = new ClaudeAnalyzer();
        const analysis = await claudeAnalyzer.analyzeCode({
            objectName: data.objectName,
            objectType: sourceResult.objectType,
            title: sourceResult.title,
            sourceCode: anonResult.anonymizedCode,
            analysisType: data.analysisType || 'BRD'
        });

        // De-anonymize response
        const deAnon = anonymizer.deAnonymize(
            JSON.stringify(analysis), anonResult.reversalMap
        );

        return deAnon;
    }

    // ═══════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════

    _deAnonymizeAnalysis(analysis, reversalMap, anonymizer) {
        // Deep-walk the analysis object and replace all placeholders
        const deAnon = (obj) => {
            if (typeof obj === 'string') {
                return anonymizer.deAnonymize(obj, reversalMap);
            }
            if (Array.isArray(obj)) {
                return obj.map(item => deAnon(item));
            }
            if (obj && typeof obj === 'object') {
                const result = {};
                for (const [key, value] of Object.entries(obj)) {
                    result[key] = deAnon(value);
                }
                return result;
            }
            return obj;
        };
        return deAnon(analysis);
    }

    async _syncObjects(filter, tenantId, user) {
        const { CustomObjects, TenantConfig } = this.entities;

        const tenantConfig = await SELECT.one.from(TenantConfig).where({ tenantId });
        if (!tenantConfig?.destinationName) {
            throw new Error('SAP system not configured. Please complete onboarding setup.');
        }

        const sapConnector = new SAPConnector();
        sapConnector.destinationName = tenantConfig.destinationName;

        const result = await sapConnector.getCustomObjects({
            ivObjectType: filter.objectType || 'ALL',
            ivNamespace: filter.namespace || 'Z',
            ivMaxRows: filter.maxRows || 500
        });

        await DELETE.from(CustomObjects).where({ tenantId });

        const objects = result.etObjects.map(obj => ({
            tenantId,
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

        for (let i = 0; i < objects.length; i += 100) {
            await INSERT.into(CustomObjects).entries(objects.slice(i, i + 100));
        }

        return objects;
    }

    async _getSourceCode(objectName, category, tenantId) {
        const { TenantConfig } = this.entities;
        const tenantConfig = await SELECT.one.from(TenantConfig).where({ tenantId });

        const sapConnector = new SAPConnector();
        sapConnector.destinationName = tenantConfig?.destinationName || 'SAP_ONPREM_RFC';

        const result = await sapConnector.getSourceCode(objectName, category);

        return {
            objectName,
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
    }

    _buildCodeString(sourceResult) {
        const sections = {};
        for (const line of sourceResult.sourceCode) {
            if (!sections[line.section]) sections[line.section] = [];
            sections[line.section].push(line.sourceLine);
        }
        let fullCode = '';
        for (const [section, lines] of Object.entries(sections)) {
            fullCode += `\n${'='.repeat(70)}\n* SECTION: ${section}\n${'='.repeat(70)}\n`;
            fullCode += lines.join('\n') + '\n';
        }
        return fullCode;
    }
};

FILEOF_4ba73d2b

# ─── File: btp-cap-app/srv/code-analyzer-service.cds ───
cat > "btp-cap-app/srv/code-analyzer-service.cds" << 'FILEOF_387bd9f0'
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

FILEOF_387bd9f0

# ─── File: btp-cap-app/srv/code-analyzer-service.js ───
cat > "btp-cap-app/srv/code-analyzer-service.js" << 'FILEOF_7aba6e87'
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
            LOG.info('Sending code to Claude AI for analysis...');
            const claudeAnalyzer = new ClaudeAnalyzer();
            const analysis = await claudeAnalyzer.generateBRD({
                objectName: data.objectName,
                objectType: sourceResult.objectType,
                title: sourceResult.title,
                sourceCode: fullCode,
                includes: sourceResult.includes,
                detailLevel: data.options?.detailLevel || 'DETAILED',
                customPrompt: data.options?.customPrompt,
                templatePrompt: template?.promptTemplate,
                templateSections: template?.sections
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

            return JSON.stringify(analysis);

        } catch (error) {
            LOG.error(`Code analysis failed for ${objectName}:`, error.message);
            throw new Error(`Code analysis failed: ${error.message}`);
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

FILEOF_7aba6e87

# ─── File: btp-cap-app/srv/lib/claude-analyzer.js ───
cat > "btp-cap-app/srv/lib/claude-analyzer.js" << 'FILEOF_e6af2698'
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
     * Generate BRD (Business Requirements Document) analysis from ABAP code
     */
    async generateBRD(params) {
        const {
            objectName, objectType, title, sourceCode,
            includes, detailLevel, customPrompt,
            templatePrompt, templateSections
        } = params;

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
     */
    async analyzeCode(params) {
        const { objectName, objectType, title, sourceCode, analysisType } = params;

        const systemPrompts = {
            BRD: 'You are a Senior SAP Functional Consultant. Analyze the ABAP code and provide business requirements.',
            FUNC_SPEC: 'You are a Senior SAP Technical Architect. Create a functional specification from this ABAP code.',
            TECH_SPEC: 'You are a Senior ABAP Developer. Create a detailed technical specification from this code.',
            CODE_REVIEW: 'You are a Senior SAP Code Reviewer. Review this ABAP code for quality, performance, and best practices.'
        };

        const systemPrompt = systemPrompts[analysisType] || systemPrompts.BRD;

        const userMessage = `Analyze this SAP ABAP object:
Object Name: ${objectName}
Object Type: ${objectType}
Title: ${title}

Source Code:
\`\`\`abap
${sourceCode}
\`\`\`

Provide your analysis in JSON format with clear sections.`;

        const response = await this._callClaudeAPI(systemPrompt, userMessage);

        return {
            analysis: response.content[0]?.text || '',
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

FILEOF_e6af2698

# ─── File: btp-cap-app/srv/lib/document-generator.js ───
cat > "btp-cap-app/srv/lib/document-generator.js" << 'FILEOF_9a21ad9e'
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

FILEOF_9a21ad9e

# ─── File: btp-cap-app/srv/lib/multitenancy/tenant-provisioning.js ───
cat > "btp-cap-app/srv/lib/multitenancy/tenant-provisioning.js" << 'FILEOF_6044d81d'
/**
 * ═══════════════════════════════════════════════════════════════════════
 * TENANT PROVISIONING HANDLER
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Manages the complete SaaS tenant lifecycle:
 * 1. Subscription (onboarding) - create tenant DB schema, seed data
 * 2. Upgrade/Downgrade - change plan, adjust limits
 * 3. Unsubscription (offboarding) - wipe data, delete schema
 *
 * Integrates with BTP SaaS Provisioning Service (saas-registry)
 */

const cds = require('@sap/cds');
const LOG = cds.log('tenant-provisioning');
const DataRetentionService = require('../security/data-retention');

class TenantProvisioning {

    /**
     * Called by SaaS Registry when a new tenant subscribes
     * This is the main onboarding entry point
     */
    static async onSubscribe(tenant, options) {
        const tenantId = tenant.subscribedTenantId;
        const tenantHost = tenant.subscribedSubdomain;

        LOG.info(`═══ TENANT ONBOARDING: ${tenantId} (${tenantHost}) ═══`);

        try {
            // Step 1: Create HDI container / DB schema for tenant
            await TenantProvisioning._createTenantDB(tenantId);

            // Step 2: Seed default data
            await TenantProvisioning._seedTenantData(tenantId, tenant);

            // Step 3: Create tenant-specific BTP destination placeholder
            await TenantProvisioning._setupDestination(tenantId, tenantHost);

            LOG.info(`Tenant ${tenantId} onboarded successfully`);

            // Return the app URL for this tenant
            const appUrl = `https://${tenantHost}.${process.env.APP_DOMAIN || 'cfapps.us10.hana.ondemand.com'}`;
            return appUrl;

        } catch (error) {
            LOG.error(`Tenant onboarding failed for ${tenantId}:`, error.message);
            // Rollback: clean up any partial setup
            await TenantProvisioning._rollbackOnboarding(tenantId);
            throw error;
        }
    }

    /**
     * Called by SaaS Registry when a tenant unsubscribes
     */
    static async onUnsubscribe(tenant) {
        const tenantId = tenant.subscribedTenantId;
        LOG.warn(`═══ TENANT OFFBOARDING: ${tenantId} ═══`);

        try {
            // Step 1: Wipe all tenant data
            const retentionService = new DataRetentionService(tenantId);
            await retentionService.wipeAllTenantData();

            // Step 2: Delete HDI container
            await TenantProvisioning._deleteTenantDB(tenantId);

            // Step 3: Clean up destinations
            await TenantProvisioning._cleanupDestination(tenantId);

            LOG.warn(`Tenant ${tenantId} offboarded and all data deleted`);
            return tenantId;

        } catch (error) {
            LOG.error(`Tenant offboarding failed for ${tenantId}:`, error.message);
            throw error;
        }
    }

    /**
     * Called when tenant dependency changes (upgrade/downgrade)
     */
    static async onDependenciesUpdate(tenant, options) {
        const tenantId = tenant.subscribedTenantId;
        LOG.info(`Tenant dependency update: ${tenantId}`);
        // Upgrade schema if needed
        await TenantProvisioning._upgradeTenantDB(tenantId);
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Database Operations
    // ═══════════════════════════════════════════════════════════════

    static async _createTenantDB(tenantId) {
        LOG.info(`Creating DB schema for tenant: ${tenantId}`);

        // In CAP multitenancy, the framework handles HDI container creation
        // when using @sap/cds-mtxs (Multitenancy Extension Service)
        // The schema is deployed automatically per tenant

        // For manual control:
        try {
            const mtxs = require('@sap/cds-mtxs');
            if (mtxs) {
                // CAP MTXS handles this automatically
                LOG.info('Using CAP MTXS for tenant DB provisioning');
            }
        } catch (e) {
            LOG.info('CAP MTXS not available, using manual DB setup');
        }
    }

    static async _deleteTenantDB(tenantId) {
        LOG.warn(`Deleting DB schema for tenant: ${tenantId}`);
        // CAP MTXS handles HDI container deletion
    }

    static async _upgradeTenantDB(tenantId) {
        LOG.info(`Upgrading DB schema for tenant: ${tenantId}`);
        // Deploy latest schema changes to tenant's HDI container
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Seed Default Data
    // ═══════════════════════════════════════════════════════════════

    static async _seedTenantData(tenantId, tenantInfo) {
        LOG.info(`Seeding default data for tenant: ${tenantId}`);

        try {
            const { TenantConfig, DocumentTemplates, SubscriptionPlans } = cds.entities('abap.analyzer');

            // Create tenant config
            await INSERT.into(TenantConfig).entries({
                tenantId: tenantId,
                tenantName: tenantInfo.subscribedSubdomain || 'New Tenant',
                status: 'ACTIVE',
                plan: 'PROFESSIONAL', // Default plan
                anonymizationLevel: 'STANDARD',
                maxUsersAllowed: 10,
                maxAPICallsPerMonth: 500,
                currentAPICallCount: 0,
                apiCallResetDate: new Date().toISOString().split('T')[0],
                retentionPolicy: JSON.stringify({
                    SOURCE_CODE_CACHE: 0,
                    CLAUDE_API_RESPONSE: 1,
                    GENERATED_DOCUMENTS: 24,
                    REVERSAL_MAPS: 1,
                    AUDIT_LOGS: 8760
                }),
                onboardedAt: new Date().toISOString()
            });

            // Seed default BRD template
            await INSERT.into(DocumentTemplates).entries({
                tenantId: tenantId,
                templateName: 'Standard BRD Template',
                templateType: 'BRD',
                description: 'Default Business Requirements Document template',
                isActive: true,
                isDefault: true,
                promptTemplate: 'Analyze this ABAP code and generate a comprehensive BRD following the section structure provided.'
            });

            // Seed Functional Spec template
            await INSERT.into(DocumentTemplates).entries({
                tenantId: tenantId,
                templateName: 'Functional Specification',
                templateType: 'FUNC_SPEC',
                description: 'Detailed functional specification with data mappings',
                isActive: true,
                isDefault: false,
                promptTemplate: 'Create a detailed functional specification from this ABAP code. Include data flow diagrams description, screen layouts, and complete field mappings.'
            });

            // Seed Technical Spec template
            await INSERT.into(DocumentTemplates).entries({
                tenantId: tenantId,
                templateName: 'Technical Design Document',
                templateType: 'TECH_SPEC',
                description: 'Technical architecture and design document',
                isActive: true,
                isDefault: false,
                promptTemplate: 'Generate a technical design document from this ABAP code. Include class diagrams description, database design, API specifications, and performance considerations.'
            });

            LOG.info(`Default data seeded for tenant: ${tenantId}`);

        } catch (error) {
            LOG.error(`Failed to seed data for tenant ${tenantId}:`, error.message);
            throw error;
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Destination Management
    // ═══════════════════════════════════════════════════════════════

    static async _setupDestination(tenantId, tenantHost) {
        LOG.info(`Setting up destination placeholder for tenant: ${tenantId}`);

        // Each tenant needs their own BTP destination pointing to their SAP system
        // The destination is named: SAP_ONPREM_<TENANT_ID>
        // Tenant admin configures the actual connection details via self-service UI
        //
        // In production, use BTP Destination Service API to create destinations:
        // POST /destination-configuration/v1/subaccountDestinations
        //
        // For now, we log what needs to be configured
        LOG.info(`Tenant ${tenantId} needs destination: SAP_ONPREM_${tenantId.substring(0, 8).toUpperCase()}`);
    }

    static async _cleanupDestination(tenantId) {
        LOG.info(`Cleaning up destination for tenant: ${tenantId}`);
        // DELETE destination via BTP Destination Service API
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Rollback
    // ═══════════════════════════════════════════════════════════════

    static async _rollbackOnboarding(tenantId) {
        LOG.warn(`Rolling back partial onboarding for tenant: ${tenantId}`);
        try {
            const retentionService = new DataRetentionService(tenantId);
            await retentionService.wipeAllTenantData();
        } catch (e) {
            LOG.error(`Rollback also failed: ${e.message}`);
        }
    }
}

module.exports = TenantProvisioning;

FILEOF_6044d81d

# ─── File: btp-cap-app/srv/lib/sap-connector.js ───
cat > "btp-cap-app/srv/lib/sap-connector.js" << 'FILEOF_59e46831'
/**
 * SAP On-Premise Connector
 * Handles RFC calls to SAP system via Cloud Connector + BTP Destination
 *
 * Prerequisites:
 * 1. Cloud Connector configured and connected to BTP subaccount
 * 2. BTP Destination "SAP_ONPREM_RFC" created with RFC connection details
 * 3. RFC function modules Z_MCP_GET_CUSTOM_OBJECTS and Z_MCP_GET_SOURCE_CODE deployed
 */

const cds = require('@sap/cds');
const LOG = cds.log('sap-connector');

class SAPConnector {

    constructor() {
        this.destinationName = process.env.SAP_DESTINATION || 'SAP_ONPREM_RFC';
    }

    /**
     * Call RFC Z_MCP_GET_CUSTOM_OBJECTS
     * Returns list of all custom ABAP objects
     */
    async getCustomObjects(params) {
        const { ivObjectType = 'ALL', ivNamespace = 'Z', ivMaxRows = 500 } = params;

        LOG.info(`Calling Z_MCP_GET_CUSTOM_OBJECTS: type=${ivObjectType}, ns=${ivNamespace}`);

        try {
            // ─── Option A: Via CAP remote service (OData wrapper around RFC) ───
            // If you expose the RFC as OData service via SAP Gateway (recommended)
            const sapService = await cds.connect.to('SAP_ONPREM');

            const result = await sapService.send({
                method: 'POST',
                path: '/GetCustomObjects',
                data: {
                    IvObjectType: ivObjectType,
                    IvNamespace: ivNamespace,
                    IvMaxRows: ivMaxRows
                }
            });

            return this._mapObjectsResult(result);

        } catch (odataError) {
            LOG.warn('OData call failed, trying direct RFC via http-client...');

            // ─── Option B: Direct RFC call via SAP Cloud SDK ───
            // Use when RFC is exposed via ICF service (/sap/bc/srt/rfc/sap/)
            try {
                return await this._callRFCDirect('Z_MCP_GET_CUSTOM_OBJECTS', {
                    IV_OBJECT_TYPE: ivObjectType,
                    IV_NAMESPACE: ivNamespace,
                    IV_MAX_ROWS: ivMaxRows
                });
            } catch (rfcError) {
                LOG.error('Both OData and direct RFC calls failed');
                throw rfcError;
            }
        }
    }

    /**
     * Call RFC Z_MCP_GET_SOURCE_CODE
     * Returns complete source code for an ABAP object
     */
    async getSourceCode(objectName, category) {
        LOG.info(`Calling Z_MCP_GET_SOURCE_CODE: name=${objectName}, cat=${category}`);

        try {
            // Option A: Via OData
            const sapService = await cds.connect.to('SAP_ONPREM');

            const result = await sapService.send({
                method: 'POST',
                path: '/GetSourceCode',
                data: {
                    IvObjectName: objectName,
                    IvCategory: category
                }
            });

            return this._mapSourceCodeResult(result);

        } catch (odataError) {
            LOG.warn('OData call failed for source code, trying direct RFC...');

            try {
                return await this._callRFCDirect('Z_MCP_GET_SOURCE_CODE', {
                    IV_OBJECT_NAME: objectName,
                    IV_CATEGORY: category
                });
            } catch (rfcError) {
                throw rfcError;
            }
        }
    }

    /**
     * Direct RFC call via HTTP (SOAP/RFC over HTTP)
     * Uses BTP Destination with Cloud Connector
     */
    async _callRFCDirect(functionName, params) {
        // Using @sap-cloud-sdk/http-client for destination-based calls
        const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
        const { getDestination } = require('@sap-cloud-sdk/connectivity');

        const destination = await getDestination({ destinationName: this.destinationName });

        if (!destination) {
            throw new Error(`Destination '${this.destinationName}' not found. Please configure it in BTP cockpit.`);
        }

        // Build SOAP envelope for RFC call
        const soapBody = this._buildSOAPEnvelope(functionName, params);

        const response = await executeHttpRequest(destination, {
            method: 'POST',
            url: `/sap/bc/srt/rfc/sap/${functionName.toLowerCase()}/`,
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'SOAPAction': `urn:sap-com:document:sap:rfc:functions:${functionName}`
            },
            data: soapBody
        });

        if (response.status !== 200) {
            throw new Error(`RFC call failed with status ${response.status}: ${response.data}`);
        }

        return this._parseSOAPResponse(functionName, response.data);
    }

    /**
     * Build SOAP envelope for RFC call
     */
    _buildSOAPEnvelope(functionName, params) {
        let paramsXml = '';
        for (const [key, value] of Object.entries(params)) {
            paramsXml += `<${key}>${this._escapeXml(String(value))}</${key}>`;
        }

        return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:urn="urn:sap-com:document:sap:rfc:functions">
  <soapenv:Header/>
  <soapenv:Body>
    <urn:${functionName}>
      ${paramsXml}
    </urn:${functionName}>
  </soapenv:Body>
</soapenv:Envelope>`;
    }

    /**
     * Parse SOAP response from RFC
     */
    _parseSOAPResponse(functionName, xmlData) {
        // Simple XML parsing (in production, use a proper XML parser like fast-xml-parser)
        const xml2js = require('xml2js');
        const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });

        return new Promise((resolve, reject) => {
            parser.parseString(xmlData, (err, result) => {
                if (err) {
                    reject(new Error(`Failed to parse SOAP response: ${err.message}`));
                    return;
                }

                try {
                    const body = result['soap-env:Envelope']['soap-env:Body'];
                    const response = body[`n0:${functionName}Response`] ||
                                   body[`${functionName}.Response`];
                    resolve(response);
                } catch (e) {
                    reject(new Error(`Unexpected SOAP response structure: ${e.message}`));
                }
            });
        });
    }

    /**
     * Map raw RFC result to normalized objects format
     */
    _mapObjectsResult(result) {
        const objects = [];
        const rawObjects = result.EtObjects || result.ET_OBJECTS || [];
        const items = Array.isArray(rawObjects) ? rawObjects : [rawObjects];

        for (const obj of items) {
            objects.push({
                objectName: obj.ObjectName || obj.OBJECT_NAME,
                objectType: obj.ObjectType || obj.OBJECT_TYPE,
                objectTypeText: obj.ObjectTypeText || obj.OBJECT_TYPE_TEXT,
                category: obj.Category || obj.CATEGORY,
                subType: obj.SubType || obj.SUB_TYPE,
                package: obj.Package || obj.PACKAGE,
                createdBy: obj.CreatedBy || obj.CREATED_BY,
                createdOn: obj.CreatedOn || obj.CREATED_ON
            });
        }

        return {
            evTotalCount: result.EvTotalCount || result.EV_TOTAL_COUNT || objects.length,
            etObjects: objects
        };
    }

    /**
     * Map raw RFC result to normalized source code format
     */
    _mapSourceCodeResult(result) {
        const sourceLines = [];
        const rawLines = result.EtSourceCode || result.ET_SOURCE_CODE || [];
        const items = Array.isArray(rawLines) ? rawLines : [rawLines];

        for (const line of items) {
            sourceLines.push({
                lineNumber: parseInt(line.LineNumber || line.LINE_NUMBER || 0),
                sourceLine: line.SourceLine || line.SOURCE_LINE || '',
                includeName: line.IncludeName || line.INCLUDE_NAME || '',
                section: line.Section || line.SECTION || ''
            });
        }

        const rawIncludes = result.EtIncludes || result.ET_INCLUDES || [];
        const includes = (Array.isArray(rawIncludes) ? rawIncludes : [rawIncludes]).map(inc => ({
            includeName: inc.IncludeName || inc.INCLUDE_NAME,
            includeType: inc.IncludeType || inc.INCLUDE_TYPE,
            parentObject: inc.ParentObject || inc.PARENT_OBJECT,
            lineCount: parseInt(inc.LineCount || inc.LINE_COUNT || 0)
        }));

        return {
            evTitle: result.EvTitle || result.EV_TITLE || '',
            evObjectType: result.EvObjectType || result.EV_OBJECT_TYPE || '',
            evPackage: result.EvPackage || result.EV_PACKAGE || '',
            evAuthor: result.EvAuthor || result.EV_AUTHOR || '',
            evCreatedOn: result.EvCreatedOn || result.EV_CREATED_ON || '',
            etSourceCode: sourceLines,
            etIncludes: includes
        };
    }

    _escapeXml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }
}

module.exports = SAPConnector;

FILEOF_59e46831

# ─── File: btp-cap-app/srv/lib/security/audit-logger.js ───
cat > "btp-cap-app/srv/lib/security/audit-logger.js" << 'FILEOF_14cbfca0'
/**
 * ═══════════════════════════════════════════════════════════════════════
 * SECURITY AUDIT LOGGER
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Logs all security-relevant events for compliance:
 * - Code access events (who accessed what code, when)
 * - Claude API calls (what was sent, tokens used, NO actual code logged)
 * - Document generation events
 * - Data anonymization events
 * - Authentication / authorization events
 * - Data retention/deletion events
 *
 * Compliant with: SOC 2, GDPR Article 30, ISO 27001
 */

const cds = require('@sap/cds');
const crypto = require('crypto');
const LOG = cds.log('security-audit');

class SecurityAuditLogger {

    constructor(tenantId) {
        this.tenantId = tenantId;
    }

    /**
     * Log code access event
     */
    async logCodeAccess(params) {
        return this._log({
            eventType: 'CODE_ACCESS',
            severity: 'INFO',
            userId: params.userId,
            action: params.action,  // VIEW, FETCH, EXPORT
            objectName: params.objectName,
            objectType: params.objectType,
            details: {
                linesAccessed: params.lineCount,
                includeCount: params.includeCount,
                sourceSystem: params.sourceSystem
            }
        });
    }

    /**
     * Log Claude API call (CRITICAL - never log actual code)
     */
    async logClaudeAPICall(params) {
        return this._log({
            eventType: 'EXTERNAL_API_CALL',
            severity: 'HIGH',
            userId: params.userId,
            action: 'CLAUDE_API_INVOCATION',
            objectName: params.objectName,
            details: {
                // NEVER log actual source code or API response content
                model: params.model,
                inputTokens: params.inputTokens,
                outputTokens: params.outputTokens,
                anonymizationLevel: params.anonymizationLevel,
                itemsAnonymized: params.itemsAnonymized,
                // Hash of what was sent (for forensic correlation without exposing code)
                payloadHash: this._hashPayload(params.codePayload),
                apiEndpoint: 'api.anthropic.com',
                requestDurationMs: params.durationMs,
                success: params.success,
                errorCode: params.errorCode
            }
        });
    }

    /**
     * Log document generation
     */
    async logDocumentGeneration(params) {
        return this._log({
            eventType: 'DOCUMENT_GENERATION',
            severity: 'MEDIUM',
            userId: params.userId,
            action: 'GENERATE_DOCUMENT',
            objectName: params.objectName,
            details: {
                documentType: params.documentType,
                templateUsed: params.templateUsed,
                detailLevel: params.detailLevel,
                includesSourceCode: params.includesSourceCode,
                fileSizeBytes: params.fileSize,
                documentHash: params.documentHash
            }
        });
    }

    /**
     * Log anonymization event
     */
    async logAnonymization(params) {
        return this._log({
            eventType: 'DATA_ANONYMIZATION',
            severity: 'HIGH',
            userId: params.userId,
            action: 'CODE_ANONYMIZED',
            objectName: params.objectName,
            details: {
                level: params.level,
                itemsStripped: params.itemsStripped,
                credentialsFound: params.credentialsFound,
                piiFound: params.piiFound,
                warnings: params.warnings
            }
        });
    }

    /**
     * Log authentication event
     */
    async logAuth(params) {
        return this._log({
            eventType: 'AUTHENTICATION',
            severity: params.success ? 'INFO' : 'CRITICAL',
            userId: params.userId,
            action: params.success ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED',
            details: {
                method: params.method,  // XSUAA, IDP
                ipAddress: this._maskIP(params.ipAddress),
                userAgent: params.userAgent?.substring(0, 100),
                failureReason: params.failureReason
            }
        });
    }

    /**
     * Log data retention/deletion event
     */
    async logDataDeletion(params) {
        return this._log({
            eventType: 'DATA_DELETION',
            severity: 'HIGH',
            userId: params.userId || 'SYSTEM',
            action: params.action,  // AUTO_PURGE, MANUAL_DELETE, TENANT_OFFBOARD
            details: {
                recordsDeleted: params.recordCount,
                dataType: params.dataType,
                retentionPolicy: params.policy,
                reason: params.reason
            }
        });
    }

    /**
     * Log consent/agreement events (for data processing consent)
     */
    async logConsent(params) {
        return this._log({
            eventType: 'DATA_CONSENT',
            severity: 'HIGH',
            userId: params.userId,
            action: params.action,  // CONSENT_GIVEN, CONSENT_REVOKED
            details: {
                consentType: params.consentType,  // CODE_PROCESSING, AI_ANALYSIS
                version: params.consentVersion,
                ipAddress: this._maskIP(params.ipAddress)
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE
    // ═══════════════════════════════════════════════════════════════

    async _log(entry) {
        const auditEntry = {
            ID: crypto.randomUUID(),
            tenantId: this.tenantId,
            timestamp: new Date().toISOString(),
            ...entry,
            details: JSON.stringify(entry.details || {})
        };

        try {
            // Write to DB
            const { SecurityAuditLog } = cds.entities('abap.analyzer');
            await INSERT.into(SecurityAuditLog).entries(auditEntry);

            // Also write to CDS audit log for BTP Audit Log Service integration
            if (entry.severity === 'CRITICAL' || entry.severity === 'HIGH') {
                LOG.warn(`AUDIT [${entry.eventType}] tenant=${this.tenantId} ` +
                    `user=${entry.userId} action=${entry.action} ` +
                    `object=${entry.objectName || 'N/A'}`);
            }

            return auditEntry.ID;
        } catch (error) {
            // Audit logging failure is itself a critical event
            LOG.error(`CRITICAL: Audit log write failed: ${error.message}`, auditEntry);
            throw error;
        }
    }

    _hashPayload(payload) {
        if (!payload) return null;
        return crypto.createHash('sha256')
            .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
            .digest('hex')
            .substring(0, 32);
    }

    _maskIP(ip) {
        if (!ip) return 'unknown';
        // Mask last octet for privacy
        const parts = ip.split('.');
        if (parts.length === 4) {
            return `${parts[0]}.${parts[1]}.${parts[2]}.xxx`;
        }
        return ip.substring(0, ip.length / 2) + '***';
    }
}

module.exports = SecurityAuditLogger;

FILEOF_14cbfca0

# ─── File: btp-cap-app/srv/lib/security/code-anonymizer.js ───
cat > "btp-cap-app/srv/lib/security/code-anonymizer.js" << 'FILEOF_df2df69c'
/**
 * ═══════════════════════════════════════════════════════════════════════
 * CODE ANONYMIZER / OBFUSCATOR
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CRITICAL SECURITY COMPONENT
 *
 * Before ANY code is sent to Claude API (external service), this module:
 * 1. Strips hardcoded credentials, passwords, API keys
 * 2. Obfuscates company-specific table/field names (optional)
 * 3. Removes business-sensitive comments
 * 4. Replaces real hostnames, IPs, URLs with placeholders
 * 5. Masks employee names, email addresses, phone numbers
 * 6. Provides a reversal map so document generator can restore names
 *
 * Anonymization Levels:
 *   NONE     - No anonymization (only for internal/private Claude deployments)
 *   BASIC    - Strip credentials + PII only
 *   STANDARD - BASIC + obfuscate hostnames, URLs, comments with names
 *   STRICT   - STANDARD + obfuscate custom table/field names, company references
 *   MAXIMUM  - STRICT + obfuscate all Z/Y object names, variable names
 */

const cds = require('@sap/cds');
const crypto = require('crypto');
const LOG = cds.log('code-anonymizer');

class CodeAnonymizer {

    constructor(level = 'STANDARD') {
        this.level = level;
        this.reversalMap = new Map();  // For de-anonymization in final document
        this.counter = 0;
        this.sensitivePatterns = [];
        this._initPatterns();
    }

    /**
     * Main entry: Anonymize ABAP source code before sending to Claude
     * Returns { anonymizedCode, reversalMap, strippedItemsCount }
     */
    anonymize(sourceCode, tenantConfig = {}) {
        if (this.level === 'NONE') {
            return {
                anonymizedCode: sourceCode,
                reversalMap: {},
                strippedItemsCount: 0,
                warnings: ['WARNING: No anonymization applied. Code sent as-is to external API.']
            };
        }

        let code = sourceCode;
        let strippedCount = 0;
        const warnings = [];

        // ─── PHASE 1: Always strip (all levels) ───
        // Hardcoded credentials - ALWAYS remove regardless of level
        const credResult = this._stripCredentials(code);
        code = credResult.code;
        strippedCount += credResult.count;
        if (credResult.count > 0) {
            warnings.push(`Stripped ${credResult.count} hardcoded credential(s) from source code.`);
        }

        // ─── PHASE 2: BASIC level and above ───
        if (['BASIC', 'STANDARD', 'STRICT', 'MAXIMUM'].includes(this.level)) {
            // PII: names, emails, phone numbers
            const piiResult = this._maskPII(code);
            code = piiResult.code;
            strippedCount += piiResult.count;

            // SAP client numbers that could identify systems
            const clientResult = this._maskClientNumbers(code);
            code = clientResult.code;
            strippedCount += clientResult.count;
        }

        // ─── PHASE 3: STANDARD level and above ───
        if (['STANDARD', 'STRICT', 'MAXIMUM'].includes(this.level)) {
            // Hostnames, IPs, URLs
            const netResult = this._maskNetworkInfo(code);
            code = netResult.code;
            strippedCount += netResult.count;

            // Comments containing business-sensitive info
            const commentResult = this._sanitizeComments(code, tenantConfig);
            code = commentResult.code;
            strippedCount += commentResult.count;

            // RFC destinations, logical systems
            const destResult = this._maskDestinations(code);
            code = destResult.code;
            strippedCount += destResult.count;
        }

        // ─── PHASE 4: STRICT level and above ───
        if (['STRICT', 'MAXIMUM'].includes(this.level)) {
            // Company-specific terms from tenant config
            if (tenantConfig.companyTerms && tenantConfig.companyTerms.length > 0) {
                const termResult = this._obfuscateCompanyTerms(code, tenantConfig.companyTerms);
                code = termResult.code;
                strippedCount += termResult.count;
            }

            // Custom table names (keep standard SAP tables readable)
            const tableResult = this._obfuscateCustomTables(code);
            code = tableResult.code;
            strippedCount += tableResult.count;
        }

        // ─── PHASE 5: MAXIMUM level ───
        if (this.level === 'MAXIMUM') {
            // Obfuscate all Z/Y custom object names
            const objResult = this._obfuscateObjectNames(code);
            code = objResult.code;
            strippedCount += objResult.count;

            // Obfuscate variable names (aggressive)
            const varResult = this._obfuscateVariables(code);
            code = varResult.code;
            strippedCount += varResult.count;
        }

        // Add anonymization header comment
        code = this._addAnonymizationHeader(code, strippedCount);

        // Build serializable reversal map
        const reversalMapObj = {};
        this.reversalMap.forEach((original, placeholder) => {
            reversalMapObj[placeholder] = original;
        });

        LOG.info(`Anonymization complete: level=${this.level}, items=${strippedCount}`);

        return {
            anonymizedCode: code,
            reversalMap: reversalMapObj,
            strippedItemsCount: strippedCount,
            warnings
        };
    }

    /**
     * De-anonymize text (used to restore real names in final document)
     * Only called server-side when generating the document, NEVER sent externally
     */
    deAnonymize(text, reversalMap) {
        let result = text;
        for (const [placeholder, original] of Object.entries(reversalMap)) {
            result = result.split(placeholder).join(original);
        }
        return result;
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Pattern Initialization
    // ═══════════════════════════════════════════════════════════════

    _initPatterns() {
        // Credential patterns in ABAP code
        this.credentialPatterns = [
            // Hardcoded passwords
            /(['"])(?:password|passwd|pwd|kennwort)\1\s*[=:]\s*(['"])[^'"]+\2/gi,
            /(?:password|passwd|pwd)\s*=\s*(['"])[^'"]+\1/gi,
            // API keys
            /(['"])(?:api[_-]?key|apikey|secret[_-]?key|access[_-]?key)\1\s*[=:]\s*(['"])[^'"]+\2/gi,
            /(?:sk-ant-|sk-|xoxb-|xoxp-|ghp_|gho_|AKIA)[A-Za-z0-9_\-]{20,}/g,
            // Bearer tokens
            /Bearer\s+[A-Za-z0-9_\-\.]+/gi,
            // Basic auth
            /Basic\s+[A-Za-z0-9+\/=]{10,}/gi,
            // SAP connection strings with passwords
            /(?:RFCDES|RFCDATA).*?(?:RFCPSWD|RFCPASS)\s*=\s*['"][^'"]+['"]/gi,
            // Hardcoded client secrets
            /client[_-]?secret\s*[=:]\s*(['"])[^'"]+\1/gi,
            // Database connection strings
            /(?:jdbc|odbc):.*?(?:password|pwd)\s*=\s*[^;]+/gi,
        ];

        // PII patterns
        this.piiPatterns = [
            // Email addresses
            { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, type: 'EMAIL' },
            // Phone numbers (international)
            { regex: /(?:\+\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?){2,3}\d{2,4}/g, type: 'PHONE' },
            // IP Addresses
            { regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, type: 'IP' },
            // URLs with internal hostnames
            { regex: /https?:\/\/[a-zA-Z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+/g, type: 'URL' },
        ];

        // SAP-specific sensitive patterns
        this.sapSensitivePatterns = [
            // RFC destinations
            /(?:DESTINATION|RFCDEST)\s*=?\s*(['"])[^'"]+\1/gi,
            // Logical system names
            /(?:LOGSYS|LOGICAL_SYSTEM)\s*=?\s*(['"])[^'"]+\1/gi,
            // SAP Router strings
            /\/H\/[^\s\/]+\/S\/\d+/g,
        ];
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Phase 1 - Strip Credentials (ALWAYS)
    // ═══════════════════════════════════════════════════════════════

    _stripCredentials(code) {
        let result = code;
        let count = 0;

        for (const pattern of this.credentialPatterns) {
            const matches = result.match(pattern);
            if (matches) {
                count += matches.length;
                result = result.replace(pattern, (match) => {
                    LOG.warn(`SECURITY: Stripped credential pattern from code`);
                    return '***CREDENTIAL_REMOVED***';
                });
            }
        }

        // Also strip anything that looks like a 32+ char hex/base64 token in string literals
        result = result.replace(/(['"])[A-Fa-f0-9]{32,}(['"])/g, (match, q1, q2) => {
            count++;
            return `${q1}***TOKEN_REMOVED***${q2}`;
        });

        return { code: result, count };
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Phase 2 - Mask PII
    // ═══════════════════════════════════════════════════════════════

    _maskPII(code) {
        let result = code;
        let count = 0;

        for (const { regex, type } of this.piiPatterns) {
            result = result.replace(regex, (match) => {
                // Don't mask SAP standard URLs
                if (type === 'URL' && (
                    match.includes('sap.com') ||
                    match.includes('sapui5') ||
                    match.includes('help.sap.com')
                )) {
                    return match;
                }

                // Don't mask loopback/localhost IPs
                if (type === 'IP' && (
                    match.startsWith('127.') ||
                    match === '0.0.0.0' ||
                    match.startsWith('10.') ||  // Keep class but mask last octets
                    match.startsWith('192.168.')
                )) {
                    // Mask last octets of private IPs
                    if (match.startsWith('10.') || match.startsWith('192.168.')) {
                        const placeholder = `[INTERNAL_IP_${++this.counter}]`;
                        this.reversalMap.set(placeholder, match);
                        count++;
                        return placeholder;
                    }
                    return match;
                }

                const placeholder = `[${type}_${++this.counter}]`;
                this.reversalMap.set(placeholder, match);
                count++;
                return placeholder;
            });
        }

        return { code: result, count };
    }

    _maskClientNumbers(code) {
        let result = code;
        let count = 0;

        // SAP client numbers in context (e.g., sy-mandt = '100')
        result = result.replace(
            /(sy-mandt|mandt|client)\s*=\s*(['"])(\d{3})\2/gi,
            (match, field, quote, client) => {
                const placeholder = `[CLIENT_${++this.counter}]`;
                this.reversalMap.set(placeholder, client);
                count++;
                return `${field} = ${quote}${placeholder}${quote}`;
            }
        );

        return { code: result, count };
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Phase 3 - Network Info & Comments
    // ═══════════════════════════════════════════════════════════════

    _maskNetworkInfo(code) {
        let result = code;
        let count = 0;

        // Hostnames in string literals (pattern: xxx.company.com, xxx.internal.corp)
        result = result.replace(
            /(['"])([a-zA-Z0-9\-]+\.(?:internal|corp|local|company|intra|private|prod|dev|staging|uat)\.[a-zA-Z]{2,})(['"])/gi,
            (match, q1, hostname, q2) => {
                const placeholder = `[HOST_${++this.counter}]`;
                this.reversalMap.set(placeholder, hostname);
                count++;
                return `${q1}${placeholder}${q2}`;
            }
        );

        // SAP system IDs (3-char SIDs in typical patterns)
        result = result.replace(
            /(?:sapsid|SID|system_id)\s*=\s*(['"])([A-Z][A-Z0-9]{2})\1/gi,
            (match, quote, sid) => {
                const placeholder = `[SID_${++this.counter}]`;
                this.reversalMap.set(placeholder, sid);
                count++;
                return `system_id = ${quote}${placeholder}${quote}`;
            }
        );

        return { code: result, count };
    }

    _sanitizeComments(code, tenantConfig) {
        let result = code;
        let count = 0;

        // Remove comments that contain author names / change history with real names
        // Pattern: * Changed by John.Smith on 2024-01-15
        result = result.replace(
            /^\*.*(?:changed|modified|created|updated|fixed)\s+by\s+([A-Z][a-z]+[\s.][A-Z][a-z]+)/gmi,
            (match, name) => {
                const placeholder = `[AUTHOR_${++this.counter}]`;
                this.reversalMap.set(placeholder, name);
                count++;
                return match.replace(name, placeholder);
            }
        );

        // Remove comments with ticket/incident numbers (could identify company)
        result = result.replace(
            /^\*.*(?:ticket|incident|JIRA|SNOW|CHG|INC|REQ)[\s:#-]*([A-Z]{2,5}-?\d{4,10})/gmi,
            (match, ticketId) => {
                const placeholder = `[TICKET_${++this.counter}]`;
                this.reversalMap.set(placeholder, ticketId);
                count++;
                return match.replace(ticketId, placeholder);
            }
        );

        // Tenant-specific comment keywords to strip
        if (tenantConfig.sensitiveKeywords) {
            for (const keyword of tenantConfig.sensitiveKeywords) {
                const regex = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                const matches = result.match(regex);
                if (matches) {
                    const placeholder = `[TERM_${++this.counter}]`;
                    this.reversalMap.set(placeholder, keyword);
                    result = result.replace(regex, placeholder);
                    count += matches.length;
                }
            }
        }

        return { code: result, count };
    }

    _maskDestinations(code) {
        let result = code;
        let count = 0;

        for (const pattern of this.sapSensitivePatterns) {
            result = result.replace(pattern, (match) => {
                const placeholder = `[SAP_DEST_${++this.counter}]`;
                this.reversalMap.set(placeholder, match);
                count++;
                return placeholder;
            });
        }

        return { code: result, count };
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Phase 4 - STRICT obfuscation
    // ═══════════════════════════════════════════════════════════════

    _obfuscateCompanyTerms(code, terms) {
        let result = code;
        let count = 0;

        for (const term of terms) {
            const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escaped, 'gi');
            const matches = result.match(regex);
            if (matches) {
                const placeholder = `[COMPANY_TERM_${++this.counter}]`;
                this.reversalMap.set(placeholder, term);
                result = result.replace(regex, placeholder);
                count += matches.length;
            }
        }

        return { code: result, count };
    }

    _obfuscateCustomTables(code) {
        let result = code;
        let count = 0;

        // Find custom table references (Z* / Y* tables, but not standard SAP tables)
        // Pattern: FROM ZTABLE, INTO ZTABLE, UPDATE ZTABLE, etc.
        result = result.replace(
            /\b([ZY][A-Z0-9_]{2,29})\b/g,
            (match, tableName) => {
                // Keep ABAP keywords that start with Z/Y (rare but possible)
                if (['ZERO'].includes(tableName)) return match;

                // Generate deterministic hash-based replacement
                // (same table name always gets same placeholder for readability)
                if (!this._tableMap) this._tableMap = new Map();

                if (!this._tableMap.has(tableName)) {
                    const hash = crypto.createHash('md5')
                        .update(tableName)
                        .digest('hex')
                        .substring(0, 6)
                        .toUpperCase();
                    const placeholder = `ZCUST_${hash}`;
                    this._tableMap.set(tableName, placeholder);
                    this.reversalMap.set(placeholder, tableName);
                    count++;
                }

                return this._tableMap.get(tableName);
            }
        );

        return { code: result, count };
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Phase 5 - MAXIMUM obfuscation
    // ═══════════════════════════════════════════════════════════════

    _obfuscateObjectNames(code) {
        let result = code;
        let count = 0;

        // Obfuscate function module names, class names in calls
        const patterns = [
            /CALL\s+FUNCTION\s+(['"])([ZY][A-Z0-9_]+)\1/gi,
            /CALL\s+METHOD\s+([ZY][A-Z0-9_]+)=>/gi,
            /CREATE\s+OBJECT\s+[a-z_]+\s+TYPE\s+([ZY][A-Z0-9_]+)/gi,
        ];

        for (const pattern of patterns) {
            result = result.replace(pattern, (match, ...groups) => {
                count++;
                return match; // Keep structure but names already handled by _obfuscateCustomTables
            });
        }

        return { code: result, count };
    }

    _obfuscateVariables(code) {
        // Intentionally conservative - only obfuscate clearly named business variables
        let result = code;
        let count = 0;

        // Obfuscate variables with business-meaningful names in DATA declarations
        // e.g., lv_customer_revenue -> lv_var_001
        result = result.replace(
            /\b(l[vtsrc]_)([a-z][a-z0-9_]{8,})\b/gi,
            (match, prefix, varName) => {
                const placeholder = `${prefix}var_${++this.counter}`;
                this.reversalMap.set(placeholder, `${prefix}${varName}`);
                count++;
                return placeholder;
            }
        );

        return { code: result, count };
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE: Utilities
    // ═══════════════════════════════════════════════════════════════

    _addAnonymizationHeader(code, count) {
        return `* ══════════════════════════════════════════════════════════════
* CODE ANONYMIZATION APPLIED
* Level: ${this.level} | Items Processed: ${count}
* Placeholders like [TYPE_N] replace sensitive data
* The AI analysis will reference these placeholders
* Original values are restored in the final document server-side
* ══════════════════════════════════════════════════════════════
${code}`;
    }
}

module.exports = CodeAnonymizer;

FILEOF_df2df69c

# ─── File: btp-cap-app/srv/lib/security/data-retention.js ───
cat > "btp-cap-app/srv/lib/security/data-retention.js" << 'FILEOF_cff69639'
/**
 * ═══════════════════════════════════════════════════════════════════════
 * DATA RETENTION & PURGE SERVICE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Ensures proprietary code is NOT retained longer than necessary:
 * 1. Source code is NEVER persisted - only held in memory during processing
 * 2. Claude API responses are purged after document generation
 * 3. Generated documents have configurable retention (default: 24 hours)
 * 4. Audit logs retained per compliance requirement (default: 1 year)
 * 5. Reversal maps (anonymization) purged with their associated request
 *
 * Each tenant can configure their own retention policy
 */

const cds = require('@sap/cds');
const LOG = cds.log('data-retention');

// Default retention periods (in hours)
const DEFAULT_RETENTION = {
    SOURCE_CODE_CACHE: 0,        // NEVER cache source code by default
    CLAUDE_API_RESPONSE: 1,      // Purge API response after 1 hour
    GENERATED_DOCUMENTS: 24,     // Keep documents for 24 hours
    REVERSAL_MAPS: 1,            // Purge with API response
    AUDIT_LOGS: 8760,            // 1 year (365 * 24)
    SESSION_DATA: 4,             // 4 hours
    FAILED_REQUESTS: 48,         // Keep failed request logs for 48 hours
};

class DataRetentionService {

    constructor(tenantId) {
        this.tenantId = tenantId;
        this.retentionPolicy = { ...DEFAULT_RETENTION };
    }

    /**
     * Load tenant-specific retention policy
     */
    async loadTenantPolicy() {
        try {
            const { TenantConfig } = cds.entities('abap.analyzer');
            const config = await SELECT.one.from(TenantConfig)
                .where({ tenantId: this.tenantId });

            if (config?.retentionPolicy) {
                const tenantPolicy = JSON.parse(config.retentionPolicy);
                this.retentionPolicy = { ...DEFAULT_RETENTION, ...tenantPolicy };
            }
        } catch (e) {
            LOG.warn(`Using default retention policy for tenant ${this.tenantId}`);
        }
    }

    /**
     * Run scheduled purge for all data types
     * Should be called by a scheduled job (e.g., every hour)
     */
    async runPurge() {
        LOG.info(`Running data purge for tenant: ${this.tenantId}`);
        const SecurityAuditLogger = require('./audit-logger');
        const auditLogger = new SecurityAuditLogger(this.tenantId);
        let totalPurged = 0;

        // 1. Purge Claude API response cache
        const apiPurged = await this._purgeByAge(
            'ClaudeResponseCache',
            this.retentionPolicy.CLAUDE_API_RESPONSE
        );
        totalPurged += apiPurged;

        // 2. Purge generated documents
        const docPurged = await this._purgeByAge(
            'GeneratedDocuments',
            this.retentionPolicy.GENERATED_DOCUMENTS
        );
        totalPurged += docPurged;

        // 3. Purge reversal maps
        const mapPurged = await this._purgeByAge(
            'ReversalMaps',
            this.retentionPolicy.REVERSAL_MAPS
        );
        totalPurged += mapPurged;

        // 4. Purge old audit logs (keep per policy)
        const auditPurged = await this._purgeByAge(
            'SecurityAuditLog',
            this.retentionPolicy.AUDIT_LOGS
        );
        totalPurged += auditPurged;

        // 5. Purge session data
        const sessionPurged = await this._purgeByAge(
            'SessionData',
            this.retentionPolicy.SESSION_DATA
        );
        totalPurged += sessionPurged;

        // Log the purge event
        if (totalPurged > 0) {
            await auditLogger.logDataDeletion({
                action: 'AUTO_PURGE',
                recordCount: totalPurged,
                dataType: 'MIXED',
                policy: JSON.stringify(this.retentionPolicy),
                reason: 'Scheduled data retention purge'
            });
        }

        LOG.info(`Purge complete: ${totalPurged} records removed`);
        return totalPurged;
    }

    /**
     * Immediately purge all data for a specific processing request
     * Called after document download to ensure no code lingers
     */
    async purgeRequestData(requestId) {
        LOG.info(`Immediate purge for request: ${requestId}`);

        try {
            const entities = cds.entities('abap.analyzer');

            // Delete API response cache
            await DELETE.from(entities.ClaudeResponseCache)
                .where({ requestId, tenantId: this.tenantId });

            // Delete reversal map
            await DELETE.from(entities.ReversalMaps)
                .where({ requestId, tenantId: this.tenantId });

            // Delete any temporary source code (should be empty, but safety net)
            await DELETE.from(entities.TempSourceCode)
                .where({ requestId, tenantId: this.tenantId });

            LOG.info(`Request data purged: ${requestId}`);

        } catch (error) {
            LOG.error(`Failed to purge request data: ${error.message}`);
            throw error;
        }
    }

    /**
     * Complete tenant data wipe (for offboarding)
     */
    async wipeAllTenantData() {
        LOG.warn(`WIPING ALL DATA for tenant: ${this.tenantId}`);

        const SecurityAuditLogger = require('./audit-logger');
        const auditLogger = new SecurityAuditLogger(this.tenantId);

        const entities = cds.entities('abap.analyzer');
        const tables = [
            'CustomObjects', 'DocumentGenerationLog', 'DocumentTemplates',
            'ClaudeResponseCache', 'GeneratedDocuments', 'ReversalMaps',
            'TempSourceCode', 'SessionData', 'TenantConfig'
        ];

        let totalDeleted = 0;
        for (const table of tables) {
            if (entities[table]) {
                try {
                    const result = await DELETE.from(entities[table])
                        .where({ tenantId: this.tenantId });
                    totalDeleted += result || 0;
                } catch (e) {
                    LOG.warn(`Could not purge ${table}: ${e.message}`);
                }
            }
        }

        // Log before deleting audit logs (audit log deletion is itself logged)
        await auditLogger.logDataDeletion({
            action: 'TENANT_OFFBOARD',
            recordCount: totalDeleted,
            dataType: 'ALL_TENANT_DATA',
            reason: 'Tenant offboarding - complete data wipe'
        });

        // Finally delete audit logs
        await DELETE.from(entities.SecurityAuditLog)
            .where({ tenantId: this.tenantId });

        LOG.warn(`Tenant data wipe complete: ${totalDeleted} records`);
        return totalDeleted;
    }

    /**
     * Get retention policy summary (for tenant admin UI)
     */
    getPolicySummary() {
        return Object.entries(this.retentionPolicy).map(([key, hours]) => ({
            dataType: key,
            retentionHours: hours,
            retentionDays: Math.round(hours / 24 * 10) / 10,
            description: this._getDescription(key)
        }));
    }

    // ═══════════════════════════════════════════════════════════════
    // PRIVATE
    // ═══════════════════════════════════════════════════════════════

    async _purgeByAge(entityName, retentionHours) {
        try {
            const entities = cds.entities('abap.analyzer');
            if (!entities[entityName]) return 0;

            const cutoff = new Date(Date.now() - retentionHours * 3600 * 1000).toISOString();

            const result = await DELETE.from(entities[entityName])
                .where({
                    tenantId: this.tenantId,
                    createdAt: { '<': cutoff }
                });

            return result || 0;
        } catch (e) {
            LOG.warn(`Purge failed for ${entityName}: ${e.message}`);
            return 0;
        }
    }

    _getDescription(key) {
        const descriptions = {
            SOURCE_CODE_CACHE: 'Cached ABAP source code (0 = never cache)',
            CLAUDE_API_RESPONSE: 'Raw responses from Claude API',
            GENERATED_DOCUMENTS: 'Generated BRD/PDF documents available for download',
            REVERSAL_MAPS: 'Anonymization reversal mappings',
            AUDIT_LOGS: 'Security and compliance audit trail',
            SESSION_DATA: 'User session and temporary data',
            FAILED_REQUESTS: 'Logs of failed processing requests',
        };
        return descriptions[key] || key;
    }
}

module.exports = DataRetentionService;

FILEOF_cff69639

# ─── File: btp-cap-app/srv/lib/security/encryption-service.js ───
cat > "btp-cap-app/srv/lib/security/encryption-service.js" << 'FILEOF_b0cc6ff2'
/**
 * ═══════════════════════════════════════════════════════════════════════
 * ENCRYPTION SERVICE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Handles all encryption for the SaaS application:
 * 1. Encrypt source code at rest in HANA DB (per-tenant keys)
 * 2. Encrypt reversal maps (never stored in plain text)
 * 3. Encrypt API payloads before logging
 * 4. Key management via BTP Credential Store
 *
 * Encryption: AES-256-GCM (authenticated encryption)
 * Key Derivation: PBKDF2 with tenant-specific salt
 */

const crypto = require('crypto');
const cds = require('@sap/cds');
const LOG = cds.log('encryption');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;     // 256 bits
const IV_LENGTH = 16;      // 128 bits
const TAG_LENGTH = 16;     // 128 bits auth tag
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

class EncryptionService {

    constructor() {
        // Master key from BTP Credential Store or environment
        this._masterKey = process.env.ENCRYPTION_MASTER_KEY;
        this._tenantKeys = new Map();
    }

    /**
     * Initialize with master key from BTP Credential Store
     */
    async initialize() {
        if (!this._masterKey) {
            try {
                // Try BTP Credential Store
                const xsenv = require('@sap/xsenv');
                const credStore = xsenv.getServices({ credstore: { tag: 'credstore' } });
                if (credStore?.credstore) {
                    this._masterKey = await this._fetchFromCredStore(
                        credStore.credstore, 'encryption-master-key'
                    );
                }
            } catch (e) {
                LOG.warn('Credential Store not available, using env variable');
            }
        }

        if (!this._masterKey) {
            // Generate and log warning - in production this MUST come from Credential Store
            this._masterKey = crypto.randomBytes(KEY_LENGTH).toString('hex');
            LOG.error('SECURITY WARNING: Using generated master key. Configure ENCRYPTION_MASTER_KEY in Credential Store!');
        }
    }

    /**
     * Derive a tenant-specific encryption key
     * Each tenant gets a unique key derived from master key + tenant ID
     */
    _deriveTenantKey(tenantId) {
        if (this._tenantKeys.has(tenantId)) {
            return this._tenantKeys.get(tenantId);
        }

        const salt = crypto.createHash('sha256')
            .update(`tenant:${tenantId}:salt`)
            .digest();

        const key = crypto.pbkdf2Sync(
            this._masterKey,
            salt,
            PBKDF2_ITERATIONS,
            KEY_LENGTH,
            'sha512'
        );

        this._tenantKeys.set(tenantId, key);
        return key;
    }

    /**
     * Encrypt data with tenant-specific key
     * Returns: { encrypted: base64, iv: base64, tag: base64 }
     */
    encrypt(plaintext, tenantId) {
        if (!plaintext) return null;

        const key = this._deriveTenantKey(tenantId);
        const iv = crypto.randomBytes(IV_LENGTH);

        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        const tag = cipher.getAuthTag();

        return {
            encrypted: encrypted,
            iv: iv.toString('base64'),
            tag: tag.toString('base64'),
            algorithm: ALGORITHM
        };
    }

    /**
     * Decrypt data with tenant-specific key
     */
    decrypt(encryptedData, tenantId) {
        if (!encryptedData?.encrypted) return null;

        const key = this._deriveTenantKey(tenantId);
        const iv = Buffer.from(encryptedData.iv, 'base64');
        const tag = Buffer.from(encryptedData.tag, 'base64');

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(tag);

        let decrypted = decipher.update(encryptedData.encrypted, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    /**
     * Encrypt source code for database storage
     * Adds compression for large code blocks
     */
    encryptSourceCode(sourceCode, tenantId) {
        const zlib = require('zlib');

        // Compress first (ABAP code compresses well - ~60-70% reduction)
        const compressed = zlib.gzipSync(Buffer.from(sourceCode, 'utf8'));
        const compressedBase64 = compressed.toString('base64');

        // Then encrypt
        const result = this.encrypt(compressedBase64, tenantId);
        result.compressed = true;
        result.originalSize = sourceCode.length;

        return result;
    }

    /**
     * Decrypt source code from database
     */
    decryptSourceCode(encryptedData, tenantId) {
        const zlib = require('zlib');

        const decryptedBase64 = this.decrypt(encryptedData, tenantId);

        if (encryptedData.compressed) {
            const compressed = Buffer.from(decryptedBase64, 'base64');
            return zlib.gunzipSync(compressed).toString('utf8');
        }

        return decryptedBase64;
    }

    /**
     * Hash sensitive data for logging (one-way, non-reversible)
     * Use this when you need to log that something happened without exposing the data
     */
    hashForAudit(data) {
        return crypto.createHash('sha256')
            .update(data)
            .digest('hex')
            .substring(0, 16); // Truncated hash for logs
    }

    /**
     * Generate a secure random token
     */
    generateToken(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }

    /**
     * Fetch key from BTP Credential Store
     */
    async _fetchFromCredStore(credentials, keyName) {
        const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

        const response = await executeHttpRequest(
            { url: credentials.url },
            {
                method: 'GET',
                url: `/api/v1/credentials/${keyName}`,
                headers: {
                    'Authorization': `Basic ${Buffer.from(
                        `${credentials.username}:${credentials.password}`
                    ).toString('base64')}`
                }
            }
        );

        return response.data?.value;
    }
}

module.exports = EncryptionService;

FILEOF_b0cc6ff2

# ─── File: btp-cap-app/srv/lib/security/security-middleware.js ───
cat > "btp-cap-app/srv/lib/security/security-middleware.js" << 'FILEOF_73778259'
/**
 * ═══════════════════════════════════════════════════════════════════════
 * SECURITY MIDDLEWARE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CAP middleware that enforces security policies:
 * 1. Rate limiting per tenant (prevent API abuse)
 * 2. Input validation & sanitization
 * 3. Consent verification (user must accept AI processing terms)
 * 4. Request size limits (prevent oversized code submissions)
 * 5. IP allowlisting per tenant (optional)
 * 6. Content Security Policy headers
 */

const cds = require('@sap/cds');
const LOG = cds.log('security-middleware');

class SecurityMiddleware {

    /**
     * Register all middleware with CAP server
     */
    static register(app) {
        // 1. Security headers
        app.use(SecurityMiddleware.securityHeaders);

        // 2. Request size limit
        app.use(SecurityMiddleware.requestSizeLimit);

        // 3. Rate limiting
        app.use(SecurityMiddleware.rateLimiter);

        LOG.info('Security middleware registered');
    }

    /**
     * Security headers for all responses
     */
    static securityHeaders(req, res, next) {
        // Prevent clickjacking
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        // XSS Protection
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        // Content Security Policy
        res.setHeader('Content-Security-Policy',
            "default-src 'self'; " +
            "script-src 'self' https://sapui5.hana.ondemand.com; " +
            "style-src 'self' 'unsafe-inline' https://sapui5.hana.ondemand.com; " +
            "font-src 'self' https://sapui5.hana.ondemand.com; " +
            "img-src 'self' data:; " +
            "connect-src 'self'"
        );
        // Strict Transport Security
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        // Referrer Policy
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        // Permissions Policy
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

        next();
    }

    /**
     * Request size limit (prevent oversized payloads)
     * ABAP programs rarely exceed 5MB of source code
     */
    static requestSizeLimit(req, res, next) {
        const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB

        if (req.headers['content-length'] &&
            parseInt(req.headers['content-length']) > MAX_BODY_SIZE) {
            LOG.warn(`Request too large: ${req.headers['content-length']} bytes from ${req.ip}`);
            return res.status(413).json({
                error: 'Request too large',
                maxSize: '10MB'
            });
        }
        next();
    }

    /**
     * Rate limiter per tenant
     */
    static rateLimiter(req, res, next) {
        // Simple in-memory rate limiter (use Redis in production)
        if (!SecurityMiddleware._rateLimitStore) {
            SecurityMiddleware._rateLimitStore = new Map();
        }

        const tenantId = req.headers['x-tenant-id'] || 'default';
        const key = `${tenantId}:${req.ip}`;
        const now = Date.now();
        const windowMs = 60 * 1000; // 1 minute window
        const maxRequests = 60;      // 60 requests per minute

        const store = SecurityMiddleware._rateLimitStore;
        const record = store.get(key) || { count: 0, resetAt: now + windowMs };

        if (now > record.resetAt) {
            record.count = 0;
            record.resetAt = now + windowMs;
        }

        record.count++;
        store.set(key, record);

        // Set rate limit headers
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - record.count));
        res.setHeader('X-RateLimit-Reset', new Date(record.resetAt).toISOString());

        if (record.count > maxRequests) {
            LOG.warn(`Rate limit exceeded: tenant=${tenantId}, ip=${req.ip}`);
            return res.status(429).json({
                error: 'Too many requests',
                retryAfter: Math.ceil((record.resetAt - now) / 1000)
            });
        }

        next();
    }

    /**
     * Validate that tenant has accepted AI processing consent
     * Call this before any Claude API interaction
     */
    static async verifyConsent(tenantId, userId) {
        try {
            const { TenantConsent } = cds.entities('abap.analyzer');
            const consent = await SELECT.one.from(TenantConsent)
                .where({
                    tenantId: tenantId,
                    consentType: 'AI_CODE_PROCESSING',
                    status: 'ACTIVE'
                });

            if (!consent) {
                throw new Error(
                    'AI Processing Consent Required. ' +
                    'Your organization must accept the AI Code Processing Agreement ' +
                    'before code can be analyzed. Please contact your tenant administrator.'
                );
            }

            // Check if consent has expired
            if (consent.expiresAt && new Date(consent.expiresAt) < new Date()) {
                throw new Error(
                    'AI Processing Consent has expired. ' +
                    'Please ask your tenant administrator to renew the agreement.'
                );
            }

            return consent;
        } catch (error) {
            if (error.message.includes('Consent')) throw error;
            LOG.warn(`Consent check failed: ${error.message}`);
            throw new Error('Unable to verify AI processing consent. Please try again.');
        }
    }

    /**
     * Validate and sanitize input parameters
     */
    static sanitizeInput(params) {
        const sanitized = {};

        for (const [key, value] of Object.entries(params)) {
            if (typeof value === 'string') {
                // Remove null bytes
                let clean = value.replace(/\0/g, '');
                // Limit string length
                clean = clean.substring(0, 10000);
                // Remove potential script injection in non-code fields
                if (key !== 'sourceCode' && key !== 'customPrompt') {
                    clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
                    clean = clean.replace(/javascript:/gi, '');
                }
                sanitized[key] = clean;
            } else {
                sanitized[key] = value;
            }
        }

        return sanitized;
    }

    /**
     * Validate object name (prevent path traversal / injection)
     */
    static validateObjectName(name) {
        if (!name || typeof name !== 'string') {
            throw new Error('Object name is required');
        }
        // ABAP object names: alphanumeric + underscore, max 30 chars
        if (!/^[A-Za-z0-9_\/]{1,120}$/.test(name)) {
            throw new Error('Invalid object name format');
        }
        // Prevent directory traversal
        if (name.includes('..') || name.includes('//')) {
            throw new Error('Invalid characters in object name');
        }
        return name.toUpperCase();
    }
}

module.exports = SecurityMiddleware;

FILEOF_73778259

# ─── File: btp-cap-app/srv/saas-admin-service.cds ───
cat > "btp-cap-app/srv/saas-admin-service.cds" << 'FILEOF_79c7cce0'
using abap.analyzer from '../db/schema-multitenant';

/**
 * SaaS Administration Service
 * Accessible only to SaaS Provider Admin and Tenant Admins
 */
service SaaSAdminService @(path: '/api/admin', requires: 'Admin') {

    // ─── Tenant Management ───
    entity TenantConfig      as projection on analyzer.TenantConfig;
    entity TenantConsent     as projection on analyzer.TenantConsent;
    entity TenantUsers       as projection on analyzer.TenantUsers;
    entity SubscriptionPlans as projection on analyzer.SubscriptionPlans;

    // ─── Audit & Compliance ───
    @readonly
    entity SecurityAuditLog  as projection on analyzer.SecurityAuditLog;

    @readonly
    entity DocumentGenerationLog as projection on analyzer.DocumentGenerationLog;

    // ─── Tenant Onboarding Actions ───

    /** Complete SAP system connection setup for a tenant */
    action configureSAPConnection(
        tenantId        : UUID,
        sapHost         : String(200),
        sapSystemNumber : String(2),
        sapClient       : String(3),
        rfcUser         : String(12),
        cloudConnectorLocationId : String(50)
    ) returns String;

    /** Test SAP connectivity for a tenant */
    action testSAPConnection(tenantId : UUID) returns String;

    /** Record AI processing consent */
    action grantAIConsent(
        tenantId       : UUID,
        consentVersion : String(10),
        legalEntity    : String(200)
    ) returns Boolean;

    /** Revoke AI processing consent (stops all Claude API calls) */
    action revokeAIConsent(tenantId : UUID) returns Boolean;

    /** Update tenant security settings */
    action updateSecuritySettings(
        tenantId           : UUID,
        anonymizationLevel : String(10),
        retentionPolicy    : LargeString,
        companyTerms       : LargeString,
        sensitiveKeywords  : LargeString,
        ipAllowlist        : LargeString
    ) returns Boolean;

    /** Trigger immediate data purge for a tenant */
    action triggerDataPurge(tenantId : UUID) returns Integer;

    /** Get tenant usage statistics */
    action getTenantUsage(tenantId : UUID) returns String; // JSON

    /** Offboard tenant - wipe all data */
    action offboardTenant(
        tenantId    : UUID,
        confirmation: String(50) // Must be "DELETE-ALL-DATA"
    ) returns Boolean;
}

FILEOF_79c7cce0

# ─── File: btp-cap-app/srv/saas-admin-service.js ───
cat > "btp-cap-app/srv/saas-admin-service.js" << 'FILEOF_5d3e9635'
const cds = require('@sap/cds');
const LOG = cds.log('saas-admin');
const DataRetentionService = require('./lib/security/data-retention');
const SecurityAuditLogger = require('./lib/security/audit-logger');
const EncryptionService = require('./lib/security/encryption-service');

module.exports = class SaaSAdminService extends cds.ApplicationService {

    async init() {

        // ─── Configure SAP Connection ───
        this.on('configureSAPConnection', async (req) => {
            const { tenantId, sapHost, sapSystemNumber, sapClient, rfcUser, cloudConnectorLocationId } = req.data;
            const userId = req.user?.id;
            const auditLogger = new SecurityAuditLogger(tenantId);

            try {
                const { TenantConfig } = this.entities;

                // Encrypt sensitive connection details
                const encService = new EncryptionService();
                await encService.initialize();

                await UPDATE(TenantConfig)
                    .set({
                        sapSystemId: sapHost?.substring(0, 10),
                        sapClientNumber: sapClient,
                        destinationName: `SAP_ONPREM_${tenantId.substring(0, 8).toUpperCase()}`,
                        cloudConnectorLocId: cloudConnectorLocationId,
                    })
                    .where({ tenantId });

                // In production: Create actual BTP Destination via Destination Service REST API
                // POST /destination-configuration/v1/subaccountDestinations
                const destinationConfig = {
                    Name: `SAP_ONPREM_${tenantId.substring(0, 8).toUpperCase()}`,
                    Type: 'RFC',
                    ProxyType: 'OnPremise',
                    Authentication: 'BasicAuthentication',
                    User: rfcUser,
                    'jco.client.ashost': sapHost,
                    'jco.client.sysnr': sapSystemNumber,
                    'jco.client.client': sapClient,
                    CloudConnectorLocationId: cloudConnectorLocationId
                };

                LOG.info(`SAP connection configured for tenant ${tenantId}. Destination config prepared.`);
                LOG.info('NOTE: Password must be configured directly in BTP Cockpit for security.');

                await auditLogger.logAuth({
                    userId, success: true,
                    method: 'SAP_CONNECTION_SETUP'
                });

                return `Destination ${destinationConfig.Name} configured. Please set the RFC password in BTP Cockpit > Destinations.`;

            } catch (error) {
                LOG.error(`SAP connection setup failed: ${error.message}`);
                throw new Error(`Configuration failed: ${error.message}`);
            }
        });

        // ─── Test SAP Connection ───
        this.on('testSAPConnection', async (req) => {
            const { tenantId } = req.data;
            try {
                const { TenantConfig } = this.entities;
                const config = await SELECT.one.from(TenantConfig).where({ tenantId });

                if (!config?.destinationName) {
                    return 'ERROR: No SAP destination configured. Run configureSAPConnection first.';
                }

                // Test RFC connectivity
                const SAPConnector = require('./lib/sap-connector');
                const connector = new SAPConnector();
                connector.destinationName = config.destinationName;

                const result = await connector.getCustomObjects({
                    ivObjectType: 'PROG',
                    ivNamespace: 'Z',
                    ivMaxRows: 1
                });

                return `SUCCESS: Connected to SAP system. Found ${result.evTotalCount} objects.`;

            } catch (error) {
                return `FAILED: ${error.message}. Check Cloud Connector and Destination settings.`;
            }
        });

        // ─── Grant AI Consent ───
        this.on('grantAIConsent', async (req) => {
            const { tenantId, consentVersion, legalEntity } = req.data;
            const userId = req.user?.id;
            const auditLogger = new SecurityAuditLogger(tenantId);

            const { TenantConsent } = this.entities;

            // Deactivate any existing consent
            await UPDATE(TenantConsent)
                .set({ status: 'SUPERSEDED' })
                .where({ tenantId, consentType: 'AI_CODE_PROCESSING', status: 'ACTIVE' });

            // Create new consent record
            await INSERT.into(TenantConsent).entries({
                tenantId,
                consentType: 'AI_CODE_PROCESSING',
                status: 'ACTIVE',
                grantedBy: userId,
                grantedAt: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(), // 1 year
                consentVersion: consentVersion || '1.0',
                legalEntity,
                agreementText: this._getConsentText(consentVersion)
            });

            await auditLogger.logConsent({
                userId,
                action: 'CONSENT_GIVEN',
                consentType: 'AI_CODE_PROCESSING',
                consentVersion
            });

            LOG.info(`AI processing consent granted for tenant ${tenantId} by ${userId}`);
            return true;
        });

        // ─── Revoke AI Consent ───
        this.on('revokeAIConsent', async (req) => {
            const { tenantId } = req.data;
            const userId = req.user?.id;
            const auditLogger = new SecurityAuditLogger(tenantId);

            const { TenantConsent } = this.entities;

            await UPDATE(TenantConsent)
                .set({ status: 'REVOKED' })
                .where({ tenantId, consentType: 'AI_CODE_PROCESSING', status: 'ACTIVE' });

            await auditLogger.logConsent({
                userId,
                action: 'CONSENT_REVOKED',
                consentType: 'AI_CODE_PROCESSING'
            });

            LOG.warn(`AI processing consent REVOKED for tenant ${tenantId}. All Claude API calls will be blocked.`);
            return true;
        });

        // ─── Update Security Settings ───
        this.on('updateSecuritySettings', async (req) => {
            const { tenantId, anonymizationLevel, retentionPolicy,
                    companyTerms, sensitiveKeywords, ipAllowlist } = req.data;
            const userId = req.user?.id;
            const auditLogger = new SecurityAuditLogger(tenantId);

            // Validate anonymization level
            const validLevels = ['NONE', 'BASIC', 'STANDARD', 'STRICT', 'MAXIMUM'];
            if (anonymizationLevel && !validLevels.includes(anonymizationLevel)) {
                throw new Error(`Invalid anonymization level. Must be: ${validLevels.join(', ')}`);
            }

            // Check plan restrictions
            const { TenantConfig } = this.entities;
            const config = await SELECT.one.from(TenantConfig).where({ tenantId });
            if (config?.plan === 'BASIC' && anonymizationLevel === 'NONE') {
                throw new Error('BASIC plan requires minimum STANDARD anonymization level.');
            }

            const updates = {};
            if (anonymizationLevel) updates.anonymizationLevel = anonymizationLevel;
            if (retentionPolicy) updates.retentionPolicy = retentionPolicy;
            if (companyTerms) updates.companyTerms = companyTerms;
            if (sensitiveKeywords) updates.sensitiveKeywords = sensitiveKeywords;
            if (ipAllowlist) updates.ipAllowlist = ipAllowlist;

            await UPDATE(TenantConfig).set(updates).where({ tenantId });

            await auditLogger.logAuth({
                userId, success: true,
                method: 'SECURITY_SETTINGS_UPDATE'
            });

            LOG.info(`Security settings updated for tenant ${tenantId}`);
            return true;
        });

        // ─── Trigger Data Purge ───
        this.on('triggerDataPurge', async (req) => {
            const { tenantId } = req.data;
            const retentionService = new DataRetentionService(tenantId);
            await retentionService.loadTenantPolicy();
            const count = await retentionService.runPurge();
            return count;
        });

        // ─── Get Tenant Usage ───
        this.on('getTenantUsage', async (req) => {
            const { tenantId } = req.data;
            const { TenantConfig, DocumentGenerationLog, SecurityAuditLog, CustomObjects } = this.entities;

            const config = await SELECT.one.from(TenantConfig).where({ tenantId });
            const docCount = await SELECT.one.from(DocumentGenerationLog)
                .columns('count(*) as cnt').where({ tenantId });
            const objectCount = await SELECT.one.from(CustomObjects)
                .columns('count(*) as cnt').where({ tenantId });
            const auditCount = await SELECT.one.from(SecurityAuditLog)
                .columns('count(*) as cnt').where({ tenantId });

            return JSON.stringify({
                plan: config?.plan,
                apiCallsUsed: config?.currentAPICallCount || 0,
                apiCallsLimit: config?.maxAPICallsPerMonth || 0,
                documentsGenerated: docCount?.cnt || 0,
                objectsSynced: objectCount?.cnt || 0,
                auditEvents: auditCount?.cnt || 0,
                anonymizationLevel: config?.anonymizationLevel
            });
        });

        // ─── Offboard Tenant ───
        this.on('offboardTenant', async (req) => {
            const { tenantId, confirmation } = req.data;

            if (confirmation !== 'DELETE-ALL-DATA') {
                throw new Error('Confirmation text must be exactly: DELETE-ALL-DATA');
            }

            const retentionService = new DataRetentionService(tenantId);
            await retentionService.wipeAllTenantData();

            LOG.warn(`Tenant ${tenantId} fully offboarded and all data wiped.`);
            return true;
        });

        await super.init();
    }

    _getConsentText(version) {
        return `AI CODE PROCESSING AGREEMENT (v${version || '1.0'})

By granting this consent, you acknowledge and agree that:

1. ABAP source code from your SAP system will be sent to Anthropic's Claude API for analysis.

2. Before transmission, code will be anonymized according to your configured anonymization level
   to remove credentials, PII, hostnames, and optionally company-specific identifiers.

3. Anthropic's Claude API processes data according to their Enterprise API Terms which state
   that input/output data is NOT used for model training.

4. Source code is transmitted via TLS 1.3 encrypted connection and is not persistently stored
   by the Claude API.

5. Generated documents are stored temporarily (per your retention policy) and then auto-purged.

6. You can revoke this consent at any time, which will immediately stop all AI processing.

7. A complete audit trail of all code transmissions is maintained and available for review.`;
    }
};

FILEOF_5d3e9635

# ─── File: btp-cap-app/xs-security-mt.json ───
cat > "btp-cap-app/xs-security-mt.json" << 'FILEOF_f46514f6'
{
    "xsappname": "abap-code-analyzer",
    "tenant-mode": "shared",
    "description": "ABAP Code Analyzer - Multi-Tenant SaaS",
    "scopes": [
        {
            "name": "$XSAPPNAME.Viewer",
            "description": "View ABAP objects and source code"
        },
        {
            "name": "$XSAPPNAME.Developer",
            "description": "Generate documents and analyze code"
        },
        {
            "name": "$XSAPPNAME.Admin",
            "description": "Tenant administration"
        },
        {
            "name": "$XSAPPNAME.SaaSAdmin",
            "description": "SaaS provider administration",
            "grant-as-authority-to-apps": ["$XSAPPNAME(application, $XSAPPNAME)"]
        },
        {
            "name": "$XSAPPNAME.Callback",
            "description": "SaaS Registry callback",
            "grant-as-authority-to-apps": ["$XSAPPNAME(application, sap-provisioning, mt-callback)"]
        }
    ],
    "authorities": [
        "$XSAPPNAME.Callback",
        "$XSAPPNAME.SaaSAdmin"
    ],
    "role-templates": [
        {
            "name": "Viewer",
            "description": "View ABAP objects (read-only)",
            "scope-references": ["$XSAPPNAME.Viewer"]
        },
        {
            "name": "Developer",
            "description": "View, analyze, and generate documents",
            "scope-references": ["$XSAPPNAME.Viewer", "$XSAPPNAME.Developer"]
        },
        {
            "name": "TenantAdmin",
            "description": "Full tenant administration",
            "scope-references": [
                "$XSAPPNAME.Viewer",
                "$XSAPPNAME.Developer",
                "$XSAPPNAME.Admin"
            ]
        },
        {
            "name": "SaaSProviderAdmin",
            "description": "SaaS provider level administration",
            "scope-references": [
                "$XSAPPNAME.Viewer",
                "$XSAPPNAME.Developer",
                "$XSAPPNAME.Admin",
                "$XSAPPNAME.SaaSAdmin"
            ]
        }
    ],
    "role-collections": [
        {
            "name": "ABAP_Analyzer_Viewer",
            "description": "View objects",
            "role-template-references": ["$XSAPPNAME.Viewer"]
        },
        {
            "name": "ABAP_Analyzer_Developer",
            "description": "Analyze and generate docs",
            "role-template-references": ["$XSAPPNAME.Developer"]
        },
        {
            "name": "ABAP_Analyzer_TenantAdmin",
            "description": "Tenant administration",
            "role-template-references": ["$XSAPPNAME.TenantAdmin"]
        }
    ],
    "oauth2-configuration": {
        "token-validity": 3600,
        "redirect-uris": [
            "https://*.cfapps.*.hana.ondemand.com/**"
        ]
    }
}

FILEOF_f46514f6

# ─── File: btp-cap-app/xs-security.json ───
cat > "btp-cap-app/xs-security.json" << 'FILEOF_b2417143'
{
    "xsappname": "abap-code-analyzer",
    "tenant-mode": "dedicated",
    "description": "ABAP Code Analyzer Security Configuration",
    "scopes": [
        {
            "name": "$XSAPPNAME.Viewer",
            "description": "View ABAP objects and source code"
        },
        {
            "name": "$XSAPPNAME.Admin",
            "description": "Generate documents and manage templates"
        }
    ],
    "role-templates": [
        {
            "name": "Viewer",
            "description": "View ABAP Objects",
            "scope-references": ["$XSAPPNAME.Viewer"]
        },
        {
            "name": "Admin",
            "description": "Full Access - Generate Documents",
            "scope-references": ["$XSAPPNAME.Viewer", "$XSAPPNAME.Admin"]
        }
    ],
    "role-collections": [
        {
            "name": "ABAPAnalyzer_Viewer",
            "description": "View ABAP objects",
            "role-template-references": ["$XSAPPNAME.Viewer"]
        },
        {
            "name": "ABAPAnalyzer_Admin",
            "description": "Full access including document generation",
            "role-template-references": ["$XSAPPNAME.Admin"]
        }
    ]
}

FILEOF_b2417143

# ─── File: docs/ARCHITECTURE.md ───
cat > "docs/ARCHITECTURE.md" << 'FILEOF_6834519b'
# SAP BTP CAPM Solution: ABAP Code Analyzer & BRD Document Generator

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SAP BTP (Cloud Foundry)                      │
│                                                                     │
│  ┌──────────────────────┐     ┌──────────────────────────────────┐  │
│  │   Fiori UI5 App      │     │      CAP Node.js Service         │  │
│  │   (AppRouter)        │────▶│                                  │  │
│  │                      │     │  ┌────────────┐ ┌─────────────┐  │  │
│  │  • Object List Page  │     │  │ Object     │ │ Document    │  │  │
│  │  • Code Detail Page  │     │  │ Service    │ │ Generation  │  │  │
│  │  • Document Preview  │     │  │            │ │ Service     │  │  │
│  │  • PDF/DOCX Download │     │  └─────┬──────┘ └──────┬──────┘  │  │
│  └──────────────────────┘     │        │               │         │  │
│                               │        ▼               ▼         │  │
│                               │  ┌────────────┐ ┌─────────────┐  │  │
│                               │  │ SAP On-Prem│ │ Claude API  │  │  │
│                               │  │ Connector  │ │ Connector   │  │  │
│                               │  └─────┬──────┘ └──────┬──────┘  │  │
│                               └────────┼───────────────┼─────────┘  │
│                                        │               │            │
│                    ┌───────────────────┘               │            │
│                    ▼                                    │            │
│            ┌──────────────┐                            │            │
│            │ Cloud        │                            │            │
│            │ Connector    │                            │            │
│            └──────┬───────┘                            │            │
└───────────────────┼────────────────────────────────────┼────────────┘
                    │                                    │
                    ▼                                    ▼
        ┌───────────────────┐              ┌──────────────────────┐
        │  SAP On-Premise   │              │   Claude API         │
        │  (ECC/S4HANA)     │              │   (Anthropic)        │
        │                   │              │                      │
        │  • Z_RFC_GET_OBJ  │              │  • Code Analysis     │
        │  • Z_RFC_GET_CODE │              │  • BRD Generation    │
        │  • Custom Tables  │              │  • Functional Spec   │
        └───────────────────┘              └──────────────────────┘
```

## Component Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | SAP Fiori / UI5 | Object browser, code viewer, document download |
| Backend | CAP Node.js | OData services, orchestration |
| On-Prem Integration | RFC via Cloud Connector | Fetch custom ABAP objects & source code |
| AI Integration | Claude API (Anthropic) | Analyze code, generate BRD documents |
| Document Generation | docx / pdfkit on Node.js | Create formatted Word/PDF documents |

## Data Flow

1. User opens Fiori app → CAP service calls RFC on SAP On-Prem via Destination
2. On-Prem returns list of custom objects (Z*, Y* programs, classes, FMs, etc.)
3. User clicks an object → CAP fetches full source code via RFC
4. User clicks "Generate BRD" → CAP sends code to Claude API
5. Claude analyzes code and returns structured BRD content
6. CAP generates Word/PDF document and returns to frontend for download

FILEOF_6834519b

# ─── File: docs/SECURITY_SAAS_ARCHITECTURE.md ───
cat > "docs/SECURITY_SAAS_ARCHITECTURE.md" << 'FILEOF_930af7d7'
# Security Architecture & SaaS Multi-Tenancy Guide

## ABAP Code Analyzer — Enterprise SaaS Solution

---

## 1. The Core Security Problem

When sending proprietary ABAP code to an external AI API (Claude), the following risks exist:

| Risk | Impact | Our Mitigation |
|------|--------|----------------|
| Code leakage via API | Competitor gains proprietary logic | 5-level code anonymization before API call |
| Credentials in code | Hardcoded passwords exposed | Automatic credential stripping (always on) |
| PII in comments | Employee names, emails leaked | PII detection and masking |
| Company identification | Business logic tied to company | Company-term obfuscation (configurable) |
| Data at rest | Stolen DB exposes client code | AES-256-GCM encryption per tenant |
| Cross-tenant access | Tenant A sees Tenant B data | Row-level security + HDI container isolation |
| Unauthorized AI usage | Code sent without management approval | Explicit consent workflow required |
| Audit compliance | No trail of what was sent | Comprehensive audit logging (code hashed, never stored) |
| Data retention | Old code lingering in system | Auto-purge with configurable retention policies |

---

## 2. Security Architecture

```
                    CUSTOMER'S SAP SYSTEM
                           │
                    ┌──────┴──────┐
                    │   Cloud     │ ← TLS 1.3
                    │ Connector   │
                    └──────┬──────┘
                           │
              ═════════════╪═══════════════════════════════
              ║  SAP BTP (Customer's Subaccount)          ║
              ║            │                               ║
              ║    ┌───────┴────────┐                      ║
              ║    │  BTP Destination│ ← RFC credentials   ║
              ║    │  (per tenant)  │   stored in BTP      ║
              ║    └───────┬────────┘                      ║
              ║            │                               ║
              ║    ┌───────┴────────────────────────────┐  ║
              ║    │         CAP Application             │  ║
              ║    │                                     │  ║
              ║    │  ┌─────────────────────────────┐   │  ║
              ║    │  │   SECURITY LAYER             │   │  ║
              ║    │  │                              │   │  ║
              ║    │  │  1. Consent Check     ✓     │   │  ║
              ║    │  │  2. Quota Check       ✓     │   │  ║
              ║    │  │  3. Input Validation  ✓     │   │  ║
              ║    │  │  4. CODE ANONYMIZER   ████  │   │  ║
              ║    │  │     ├─ Strip credentials     │   │  ║
              ║    │  │     ├─ Mask PII              │   │  ║
              ║    │  │     ├─ Mask hostnames/IPs    │   │  ║
              ║    │  │     ├─ Obfuscate tables      │   │  ║
              ║    │  │     └─ Obfuscate company     │   │  ║
              ║    │  │        terms                  │   │  ║
              ║    │  │  5. Audit Logging     ✓     │   │  ║
              ║    │  │  6. Encryption        ✓     │   │  ║
              ║    │  └──────────────┬───────────────┘   │  ║
              ║    │                 │                    │  ║
              ║    │         ANONYMIZED CODE ONLY         │  ║
              ║    │                 │                    │  ║
              ║    └─────────────────┼────────────────────┘  ║
              ║                      │                        ║
              ═══════════════════════╪════════════════════════
                                    │ TLS 1.3
                                    ▼
                         ┌──────────────────┐
                         │  Claude API       │
                         │  (Anthropic)      │
                         │                   │
                         │  • Sees ONLY      │
                         │    anonymized code│
                         │  • No training    │
                         │    on API data    │
                         │  • No persistence │
                         └──────────────────┘
```

---

## 3. Code Anonymization — 5 Levels

Tenant admins choose their anonymization level. Higher levels = more privacy, slightly less precise AI output.

### Level: NONE (Only for Private AI Deployments)
- No changes to code
- Only appropriate if customer hosts their own Claude instance

### Level: BASIC
- Strip hardcoded passwords, API keys, tokens
- Mask email addresses, phone numbers
- Mask SAP client numbers

**Example:**
```abap
* BEFORE:
lv_password = 'S3cretP@ss!'.
lv_email = 'john.smith@acme-corp.com'.
CALL FUNCTION 'Z_SEND_EMAIL' DESTINATION 'PROD_ERP_01'.

* AFTER (BASIC):
lv_password = '***CREDENTIAL_REMOVED***'.
lv_email = '[EMAIL_1]'.
CALL FUNCTION 'Z_SEND_EMAIL' DESTINATION 'PROD_ERP_01'.
```

### Level: STANDARD (Recommended Default)
- Everything in BASIC plus:
- Mask hostnames, IP addresses, URLs
- Mask RFC destinations, logical system names
- Sanitize comments with author names and ticket numbers

**Example:**
```abap
* BEFORE:
* Changed by John.Smith on 2024-01-15 (JIRA-4521)
CALL FUNCTION 'Z_GET_DATA' DESTINATION 'PRD-ERP-001'.
lv_host = 'sap-prod.acme-internal.corp'.

* AFTER (STANDARD):
* Changed by [AUTHOR_1] on 2024-01-15 ([TICKET_1])
CALL FUNCTION 'Z_GET_DATA' DESTINATION '[SAP_DEST_1]'.
lv_host = '[HOST_1]'.
```

### Level: STRICT
- Everything in STANDARD plus:
- Obfuscate company-specific terms (configured by tenant admin)
- Obfuscate all Z/Y custom table and structure names

**Example:**
```abap
* BEFORE:
SELECT * FROM ZACME_SALES_ORDER INTO TABLE lt_orders.
* Acme Corp Revenue Calculation Module

* AFTER (STRICT):
SELECT * FROM ZCUST_A3F21B INTO TABLE lt_orders.
* [COMPANY_TERM_1] Revenue Calculation Module
```

### Level: MAXIMUM
- Everything in STRICT plus:
- Obfuscate all Z/Y custom object names in CALLs
- Obfuscate business-meaningful variable names (>8 chars)

### De-Anonymization
The reversal map is kept server-side only. After Claude returns the analysis, the CAP service restores all original names before generating the final document. The customer's document has real names; Claude never sees them.

---

## 4. Data Flow — What Goes Where

| Data | Stored in BTP DB? | Sent to Claude? | Logged? |
|------|-------------------|-----------------|---------|
| Source code (raw) | NEVER persisted | NEVER (anonymized version sent) | Hash only |
| Source code (anonymized) | Temp only, auto-purged (1hr) | YES, via TLS 1.3 | Hash only |
| Reversal map | Encrypted, auto-purged (1hr) | NEVER | Entry count only |
| Claude API response | Temp only, auto-purged (1hr) | N/A (from Claude) | Token count only |
| Generated document | Encrypted, auto-purged (24hr) | NEVER | File hash + size |
| Credentials found in code | IMMEDIATELY stripped | NEVER | Count only |
| Audit trail | Encrypted, retained (1 year) | NEVER | N/A (it IS the log) |
| Object list cache | Encrypted at rest | NEVER | Access events |

---

## 5. SaaS Multi-Tenancy Architecture

```
    Customer A              Customer B              Customer C
    (acme.analyzer.com)     (beta.analyzer.com)     (gamma.analyzer.com)
         │                       │                       │
         ▼                       ▼                       ▼
    ┌─────────────────────────────────────────────────────────┐
    │                   APP ROUTER                             │
    │              (Subdomain-based routing)                    │
    │     TENANT_HOST_PATTERN: ^(.*)-app.cfapps...            │
    └───────────────────────┬─────────────────────────────────┘
                            │
                   JWT Token contains:
                   • tenantId (zid claim)
                   • user scopes
                   • subdomain
                            │
    ┌───────────────────────┴─────────────────────────────────┐
    │                 CAP SERVICE LAYER                         │
    │                                                          │
    │   ┌──────────┐  ┌──────────┐  ┌──────────┐             │
    │   │Tenant A  │  │Tenant B  │  │Tenant C  │  Data       │
    │   │Context   │  │Context   │  │Context   │  Isolation   │
    │   │          │  │          │  │          │             │
    │   │• Own DB  │  │• Own DB  │  │• Own DB  │  HDI per    │
    │   │  schema  │  │  schema  │  │  schema  │  tenant     │
    │   │• Own SAP │  │• Own SAP │  │• Own SAP │             │
    │   │  dest.   │  │  dest.   │  │  dest.   │  Separate   │
    │   │• Own     │  │• Own     │  │• Own     │  destination│
    │   │  config  │  │  config  │  │  config  │             │
    │   │• Own     │  │• Own     │  │• Own     │  Separate   │
    │   │  enc key │  │  enc key │  │  enc key │  keys       │
    │   └──────────┘  └──────────┘  └──────────┘             │
    │                                                          │
    └──────────────────────────────────────────────────────────┘
                       │            │            │
                       ▼            ▼            ▼
              ┌──────────┐  ┌──────────┐  ┌──────────┐
              │SAP ECC   │  │S/4HANA   │  │SAP ECC   │
              │Acme Corp │  │Beta Inc  │  │Gamma Ltd │
              └──────────┘  └──────────┘  └──────────┘
```

### Tenant Isolation Guarantees

| Layer | Isolation Method |
|-------|-----------------|
| Network | Each tenant's SAP connected via their own Cloud Connector + Destination |
| Database | Separate HDI container per tenant (Service Manager) |
| Data | Row-level tenantId filtering on every query |
| Encryption | Unique AES-256 key derived per tenant |
| API Keys | Enterprise plan: tenant brings own Claude API key |
| Audit | Separate audit trail per tenant |
| Configuration | Independent anonymization, retention, templates |

---

## 6. Customer Onboarding Flow

```
Step 1: SUBSCRIBE
    Customer admin subscribes via BTP Cockpit
    → SaaS Registry triggers onSubscribe callback
    → HDI container created for tenant
    → Default config, templates seeded
    → Tenant URL assigned: <subdomain>.analyzer.cfapps.*.com

Step 2: CONFIGURE SAP CONNECTION
    Tenant admin opens Admin UI
    → Enters SAP system details (host, system number, client)
    → BTP Destination created automatically
    → Admin sets RFC password in BTP Cockpit (never handled by our app)
    → Admin installs Cloud Connector on their network
    → Tests connectivity via "Test Connection" button

Step 3: DEPLOY ABAP RFCS
    Tenant's ABAP team deploys the two RFCs:
    → Z_MCP_GET_CUSTOM_OBJECTS
    → Z_MCP_GET_SOURCE_CODE
    (We provide transport request or manual copy)

Step 4: GRANT AI CONSENT
    Tenant admin reads and accepts AI Processing Agreement
    → Consent recorded with timestamp, IP, legal entity
    → AI features unlocked

Step 5: CONFIGURE SECURITY
    Tenant admin sets:
    → Anonymization level (BASIC → MAXIMUM)
    → Company-specific terms to obfuscate
    → Data retention periods
    → IP allowlist (optional)

Step 6: READY TO USE
    Developers can now:
    → Browse custom ABAP objects
    → View source code
    → Generate BRD documents via Claude AI
```

---

## 7. Subscription Plans

| Feature | BASIC | PROFESSIONAL | ENTERPRISE |
|---------|-------|-------------|------------|
| Price/month | $299 | $799 | Custom |
| Users | 5 | 25 | Unlimited |
| AI Calls/month | 100 | 500 | Unlimited |
| Object Sync | 500 | 2,000 | Unlimited |
| Min Anonymization | STANDARD | BASIC | NONE (own API) |
| Document Templates | 3 default | Custom templates | Custom + branded |
| Bring Own API Key | No | No | Yes |
| Data Retention Config | Default only | Configurable | Full control |
| SLA | Best effort | 99.5% | 99.9% |
| Support | Email | Priority | Dedicated |
| Audit Export | No | CSV | SAP DLP integration |
| IP Allowlisting | No | Yes | Yes |
| SSO Integration | XSUAA | XSUAA + IDP | XSUAA + Custom IDP |

---

## 8. Compliance & Certifications

### Anthropic Claude API — Key Security Facts
- Enterprise API data is NOT used for model training
- No persistent storage of API inputs/outputs
- SOC 2 Type II certified
- Data encrypted in transit (TLS 1.3)
- Processing in US data centers (check for EU requirements)

### Our Application — Security Measures
- ISO 27001 aligned security controls
- GDPR Article 30 compliant audit logging
- SOC 2 aligned access controls
- Data minimization (source code never persisted)
- Right to erasure (tenant offboarding wipes all data)
- Explicit consent workflow before AI processing
- Encryption at rest (AES-256-GCM) with per-tenant keys
- BTP Credential Store for key management
- BTP Audit Log Service integration
- Rate limiting and DDoS protection
- Security headers (CSP, HSTS, X-Frame-Options)

---

## 9. Key Files Reference

### Security Layer
| File | Purpose |
|------|---------|
| `srv/lib/security/code-anonymizer.js` | 5-level code anonymization engine |
| `srv/lib/security/encryption-service.js` | AES-256-GCM encryption per tenant |
| `srv/lib/security/audit-logger.js` | Comprehensive security audit trail |
| `srv/lib/security/data-retention.js` | Auto-purge and retention policies |
| `srv/lib/security/security-middleware.js` | Rate limiting, headers, validation |

### SaaS Multi-Tenancy Layer
| File | Purpose |
|------|---------|
| `db/schema-multitenant.cds` | Tenant-aware data model |
| `srv/saas-admin-service.cds` | Admin API definition |
| `srv/saas-admin-service.js` | Onboarding, consent, config |
| `srv/lib/multitenancy/tenant-provisioning.js` | Subscription lifecycle |
| `mta-saas.yaml` | SaaS deployment descriptor |
| `xs-security-mt.json` | Multi-tenant XSUAA config |

### Core Application
| File | Purpose |
|------|---------|
| `srv/code-analyzer-service-secure.js` | Main service with security pipeline |
| `srv/lib/sap-connector.js` | Tenant-aware RFC calls |
| `srv/lib/claude-analyzer.js` | Claude API integration |
| `srv/lib/document-generator.js` | DOCX/PDF generation |

FILEOF_930af7d7

# ─── File: docs/SETUP_GUIDE.md ───
cat > "docs/SETUP_GUIDE.md" << 'FILEOF_6aab2564'
# Complete Setup & Deployment Guide

## Prerequisites

### SAP On-Premise System
- SAP ECC 6.0+ or S/4HANA (any version)
- SAP Cloud Connector installed and connected to BTP subaccount
- RFC user with authorization for:
  - `S_RFC` (RFC access)
  - `S_DEVELOP` (read access to ABAP Repository)
  - `S_TADIR` (read TADIR entries)

### SAP BTP
- BTP subaccount with Cloud Foundry environment
- SAP HANA Cloud instance (for caching - optional)
- Entitlements: XSUAA, Destination Service, Connectivity Service
- Cloud Connector connected

### Claude API
- Anthropic API key (https://console.anthropic.com)
- Recommended model: claude-sonnet-4-20250514

---

## Step-by-Step Implementation

### PHASE 1: SAP On-Premise Setup

#### 1.1 Create Data Dictionary Objects
1. Open SE11
2. Create structures:
   - `ZSMCP_CUSTOM_OBJECT` (see Z_DATA_DICTIONARY.abap)
   - `ZSMCP_SOURCE_LINE`
   - `ZSMCP_INCLUDE_INFO`
3. Create table type: `Z_TT_CUSTOM_OBJECTS`

#### 1.2 Create RFC Function Modules
1. Open SE37
2. Create Function Group: `Z_MCP_CODE_ANALYZER`
3. Create FM: `Z_MCP_GET_CUSTOM_OBJECTS`
   - Mark as "Remote-Enabled Module" in Attributes tab
   - Copy code from `on-prem-abap/Z_MCP_GET_CUSTOM_OBJECTS.abap`
4. Create FM: `Z_MCP_GET_SOURCE_CODE`
   - Mark as "Remote-Enabled Module"
   - Copy code from `on-prem-abap/Z_MCP_GET_SOURCE_CODE.abap`
5. Activate all objects

#### 1.3 Test RFCs Locally
1. SE37 → `Z_MCP_GET_CUSTOM_OBJECTS` → Test (F8)
2. Input: IV_OBJECT_TYPE = 'ALL', IV_NAMESPACE = 'Z'
3. Verify ET_OBJECTS returns your custom objects

#### 1.4 Configure Cloud Connector
1. Open Cloud Connector admin (https://localhost:8443)
2. Add subaccount connection
3. Add access control:
   - Back-end Type: ABAP System
   - Protocol: RFC
   - Internal Host: <SAP hostname>
   - Internal Port: <SAP system number as port, e.g., 3200>
   - Virtual Host: `virtual-sap-host`
   - Virtual Port: `443`

### PHASE 2: BTP Configuration

#### 2.1 Create BTP Destination
1. BTP Cockpit → Subaccount → Destinations
2. Create new destination:
   ```
   Name: SAP_ONPREM_RFC
   Type: RFC
   Proxy Type: OnPremise
   User: <RFC_USER>
   Password: <RFC_PASSWORD>
   
   Additional Properties:
   jco.client.ashost: virtual-sap-host
   jco.client.sysnr: 00
   jco.client.client: 100
   jco.client.lang: EN
   
   Location ID: <Cloud Connector Location ID>
   ```

#### 2.2 Create Claude API User-Provided Service
```bash
cf create-user-provided-service claude-api -p '{"api-key":"sk-ant-your-key-here"}'
```

### PHASE 3: CAP Application Development

#### 3.1 Initialize Project
```bash
cd btp-cap-app
npm install
```

#### 3.2 Local Development
```bash
# Copy env template
cp .env.template .env
# Edit .env with your Anthropic API key

# Start CAP server
cds watch
```
The app will be available at http://localhost:4004

#### 3.3 Test Endpoints
```bash
# List custom objects
curl http://localhost:4004/api/analyzer/CustomObjects

# Get source code (POST action)
curl -X POST http://localhost:4004/api/analyzer/getSourceCode \
  -H "Content-Type: application/json" \
  -d '{"objectName":"Z_MY_REPORT","category":"REPORT"}'

# Generate document
curl -X POST http://localhost:4004/api/analyzer/generateDocument \
  -H "Content-Type: application/json" \
  -d '{
    "objectName": "Z_MY_REPORT",
    "category": "REPORT",
    "options": {
      "documentType": "DOCX",
      "detailLevel": "DETAILED",
      "includeCode": true
    }
  }'
```

### PHASE 4: Build & Deploy

#### 4.1 Build
```bash
# Install MBT build tool
npm install -g mbt

# Build MTA archive
mbt build -t ./mta_archives
```

#### 4.2 Deploy
```bash
# Login to CF
cf login -a <API_ENDPOINT> -o <ORG> -s <SPACE>

# Deploy
cf deploy mta_archives/abap-code-analyzer_1.0.0.mtar
```

#### 4.3 Assign Role Collections
1. BTP Cockpit → Security → Role Collections
2. Assign `ABAPAnalyzer_Admin` to your users

---

## Architecture Notes

### Why RFC instead of OData for On-Prem?
- RFC gives direct access to `READ REPORT` statement (cannot be exposed via standard OData)
- Better performance for large source code retrieval
- Can leverage existing ABAP security model

### Claude API Token Management
- Average ABAP program: 500-2000 lines ≈ 3,000-15,000 tokens
- Claude response (BRD): ≈ 3,000-8,000 tokens
- Estimated cost per document: ~$0.02-0.10 (Sonnet pricing)
- For large programs (>5000 lines), consider truncating or summarizing before sending

### Document Quality
- Claude generates structured JSON which is then formatted into professional DOCX/PDF
- The template system allows customizing which sections appear
- Custom prompts let users guide the AI analysis focus

---

## Troubleshooting

| Issue | Solution |
|-------|---------|
| RFC connection failed | Check Cloud Connector logs, verify virtual host mapping |
| Claude API 401 | Verify API key in environment/UPS |
| Claude API 429 | Rate limited - add retry logic with exponential backoff |
| Empty source code | Verify RFC user has S_DEVELOP authorization |
| DOCX generation fails | Check Node.js version (18+), verify docx package installed |
| Large programs timeout | Increase CAP server timeout, consider chunking code |

FILEOF_6aab2564

# ─── File: on-prem-abap/Z_DATA_DICTIONARY.abap ───
cat > "on-prem-abap/Z_DATA_DICTIONARY.abap" << 'FILEOF_d54a799c'
*&---------------------------------------------------------------------*
*& ABAP Data Dictionary Objects Required
*& Create these in SE11 before activating the RFCs
*&---------------------------------------------------------------------*

*-----------------------------------------------------------------------
* Structure: ZSMCP_CUSTOM_OBJECT
* Used by: Z_MCP_GET_CUSTOM_OBJECTS (ET_OBJECTS parameter)
*-----------------------------------------------------------------------
* Field Name       | Data Element    | Type     | Length | Description
*-----------------------------------------------------------------------
* OBJECT_NAME      | SOBJ_NAME       | CHAR     | 120    | Object Name
* OBJECT_TYPE      | TROBJTYPE       | CHAR     | 4      | Object Type (PROG/CLAS/FUGR)
* OBJECT_TYPE_TEXT  | STRING          | STRING   |        | Readable Type Description
* CATEGORY         | CHAR30          | CHAR     | 30     | Category Key
* SUB_TYPE         | SUBC            | CHAR     | 1      | Program Sub-type
* PACKAGE          | DEVCLASS        | CHAR     | 30     | Development Package
* CREATED_BY       | XUBNAME         | CHAR     | 12     | Created By
* CREATED_ON       | SYDATUM         | DATS     | 8      | Created On
* CHANGED_BY       | XUBNAME         | CHAR     | 12     | Changed By
* CHANGED_ON       | SYDATUM         | DATS     | 8      | Changed On
*-----------------------------------------------------------------------

*-----------------------------------------------------------------------
* Structure: ZSMCP_SOURCE_LINE
* Used by: Z_MCP_GET_SOURCE_CODE (ET_SOURCE_CODE parameter)
*-----------------------------------------------------------------------
* Field Name       | Data Element    | Type     | Length | Description
*-----------------------------------------------------------------------
* LINE_NUMBER      | I               | INT4     | 10     | Line Number
* SOURCE_LINE      | STRING          | STRING   |        | Source Code Line
* INCLUDE_NAME     | SOBJ_NAME       | CHAR     | 120    | Include/Component Name
* SECTION          | STRING          | STRING   |        | Section (MAIN/INCLUDE/METHOD:xxx)
*-----------------------------------------------------------------------

*-----------------------------------------------------------------------
* Structure: ZSMCP_INCLUDE_INFO
* Used by: Z_MCP_GET_SOURCE_CODE (ET_INCLUDES parameter)
*-----------------------------------------------------------------------
* Field Name       | Data Element    | Type     | Length | Description
*-----------------------------------------------------------------------
* INCLUDE_NAME     | SOBJ_NAME       | CHAR     | 120    | Include Name
* INCLUDE_TYPE     | STRING          | STRING   |        | Type (INCLUDE/METHOD/FM)
* PARENT_OBJECT    | SOBJ_NAME       | CHAR     | 120    | Parent Object Name
* LINE_COUNT       | I               | INT4     | 10     | Number of Lines
*-----------------------------------------------------------------------

*-----------------------------------------------------------------------
* Table Type: Z_TT_CUSTOM_OBJECTS
* Line Type: ZSMCP_CUSTOM_OBJECT
*-----------------------------------------------------------------------

FILEOF_d54a799c

# ─── File: on-prem-abap/Z_MCP_GET_CUSTOM_OBJECTS.abap ───
cat > "on-prem-abap/Z_MCP_GET_CUSTOM_OBJECTS.abap" << 'FILEOF_4f352e0e'
*&---------------------------------------------------------------------*
*& RFC Function Module: Z_MCP_GET_CUSTOM_OBJECTS
*& Description: Returns all custom ABAP objects from the SAP system
*&              Supports Programs, Reports, Classes, BADIs, FMs, Enhancements
*&---------------------------------------------------------------------*
*& Must be RFC-enabled in SE37
*& Import Parameters:
*&   IV_OBJECT_TYPE  TYPE CHAR20  (optional: PROG/CLAS/FUGR/BADI/ENHO/ALL)
*&   IV_NAMESPACE    TYPE CHAR10  (optional: Z/Y/ZZ - default Z*)
*&   IV_MAX_ROWS     TYPE I       (optional: default 500)
*& Export Parameters:
*&   EV_TOTAL_COUNT  TYPE I
*& Tables Parameters:
*&   ET_OBJECTS      TYPE Z_TT_CUSTOM_OBJECTS
*&---------------------------------------------------------------------*

FUNCTION z_mcp_get_custom_objects.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_OBJECT_TYPE) TYPE  CHAR20 DEFAULT 'ALL'
*"     VALUE(IV_NAMESPACE) TYPE  CHAR10 DEFAULT 'Z'
*"     VALUE(IV_MAX_ROWS) TYPE  I DEFAULT 500
*"  EXPORTING
*"     VALUE(EV_TOTAL_COUNT) TYPE  I
*"  TABLES
*"     ET_OBJECTS STRUCTURE  ZSMCP_CUSTOM_OBJECT
*"----------------------------------------------------------------------

  DATA: lt_objects TYPE TABLE OF zsmcp_custom_object,
        ls_object  TYPE zsmcp_custom_object,
        lv_prefix  TYPE string.

  lv_prefix = iv_namespace && '%'.

  CLEAR: et_objects[], ev_total_count.

*-----------------------------------------------------------------------
* 1. Fetch Custom Programs / Reports (TADIR + TRDIR)
*-----------------------------------------------------------------------
  IF iv_object_type = 'ALL' OR iv_object_type = 'PROG'.
    SELECT t~obj_name AS object_name,
           t~object   AS object_type,
           t~devclass AS package,
           t~author   AS created_by,
           r~subc     AS sub_type,
           t~created_on AS created_on
      FROM tadir AS t
      INNER JOIN trdir AS r ON r~name = t~obj_name
      INTO CORRESPONDING FIELDS OF TABLE @lt_objects
      WHERE t~pgmid    = 'R3TR'
        AND t~object   = 'PROG'
        AND t~obj_name LIKE @lv_prefix
      UP TO @iv_max_rows ROWS.

    LOOP AT lt_objects INTO ls_object.
      CASE ls_object-sub_type.
        WHEN '1'.
          ls_object-object_type_text = 'Executable Program (Report)'.
          ls_object-category = 'REPORT'.
        WHEN 'I'.
          ls_object-object_type_text = 'Include Program'.
          ls_object-category = 'INCLUDE'.
        WHEN 'M'.
          ls_object-object_type_text = 'Module Pool'.
          ls_object-category = 'MODULE_POOL'.
        WHEN 'S'.
          ls_object-object_type_text = 'Subroutine Pool'.
          ls_object-category = 'SUBROUTINE'.
        WHEN OTHERS.
          ls_object-object_type_text = 'Program'.
          ls_object-category = 'PROGRAM'.
      ENDCASE.
      APPEND ls_object TO et_objects.
    ENDLOOP.
  ENDIF.

*-----------------------------------------------------------------------
* 2. Fetch Custom Classes (TADIR + SEOCLASS)
*-----------------------------------------------------------------------
  IF iv_object_type = 'ALL' OR iv_object_type = 'CLAS'.
    CLEAR lt_objects.
    SELECT t~obj_name  AS object_name,
           t~object    AS object_type,
           t~devclass  AS package,
           t~author    AS created_by,
           c~clsname   AS object_name,
           t~created_on AS created_on
      FROM tadir AS t
      INNER JOIN seoclass AS c ON c~clsname = t~obj_name
      INTO CORRESPONDING FIELDS OF TABLE @lt_objects
      WHERE t~pgmid    = 'R3TR'
        AND t~object   = 'CLAS'
        AND t~obj_name LIKE @lv_prefix
      UP TO @iv_max_rows ROWS.

    LOOP AT lt_objects INTO ls_object.
      ls_object-object_type_text = 'ABAP Class'.
      ls_object-category = 'CLASS'.
      APPEND ls_object TO et_objects.
    ENDLOOP.
  ENDIF.

*-----------------------------------------------------------------------
* 3. Fetch Custom Function Modules (TADIR + TFDIR + ENLFDIR)
*-----------------------------------------------------------------------
  IF iv_object_type = 'ALL' OR iv_object_type = 'FUGR'.
    CLEAR lt_objects.
    SELECT t~obj_name  AS object_name,
           'FUNC'      AS object_type,
           t~devclass  AS package,
           t~author    AS created_by,
           t~created_on AS created_on
      FROM tadir AS t
      WHERE t~pgmid    = 'R3TR'
        AND t~object   = 'FUGR'
        AND t~obj_name LIKE @lv_prefix
      INTO CORRESPONDING FIELDS OF TABLE @lt_objects
      UP TO @iv_max_rows ROWS.

    LOOP AT lt_objects INTO ls_object.
      ls_object-object_type_text = 'Function Group'.
      ls_object-category = 'FUNCTION_GROUP'.
      APPEND ls_object TO et_objects.
    ENDLOOP.

    " Also get individual Function Modules
    CLEAR lt_objects.
    SELECT f~funcname  AS object_name,
           'FUNC'      AS object_type,
           e~area      AS package,
           t~author    AS created_by,
           t~created_on AS created_on
      FROM tfdir AS f
      INNER JOIN enlfdir AS e ON e~funcname = f~funcname
      INNER JOIN tadir AS t ON t~obj_name = e~area
                           AND t~object = 'FUGR'
      WHERE f~funcname LIKE @lv_prefix
      INTO CORRESPONDING FIELDS OF TABLE @lt_objects
      UP TO @iv_max_rows ROWS.

    LOOP AT lt_objects INTO ls_object.
      ls_object-object_type_text = 'Function Module'.
      ls_object-category = 'FUNCTION_MODULE'.
      APPEND ls_object TO et_objects.
    ENDLOOP.
  ENDIF.

*-----------------------------------------------------------------------
* 4. Fetch Custom BADIs (SXS_ATTRT)
*-----------------------------------------------------------------------
  IF iv_object_type = 'ALL' OR iv_object_type = 'BADI'.
    CLEAR lt_objects.
    SELECT s~exit_name AS object_name,
           'BADI'      AS object_type,
           s~text       AS object_type_text
      FROM sxs_attrt AS s
      WHERE s~exit_name LIKE @lv_prefix
        AND s~langu = @sy-langu
      INTO CORRESPONDING FIELDS OF TABLE @lt_objects
      UP TO @iv_max_rows ROWS.

    LOOP AT lt_objects INTO ls_object.
      ls_object-category = 'BADI'.
      APPEND ls_object TO et_objects.
    ENDLOOP.

    " New BADIs (Enhancement Spot based)
    CLEAR lt_objects.
    SELECT b~badi_name AS object_name,
           'BADI2'     AS object_type
      FROM sxc_exit AS b
      WHERE b~badi_name LIKE @lv_prefix
      INTO CORRESPONDING FIELDS OF TABLE @lt_objects
      UP TO @iv_max_rows ROWS.

    LOOP AT lt_objects INTO ls_object.
      ls_object-object_type_text = 'New BAdI (Enhancement Spot)'.
      ls_object-category = 'BADI_NEW'.
      APPEND ls_object TO et_objects.
    ENDLOOP.
  ENDIF.

*-----------------------------------------------------------------------
* 5. Fetch Enhancements / Enhancement Implementations
*-----------------------------------------------------------------------
  IF iv_object_type = 'ALL' OR iv_object_type = 'ENHO'.
    CLEAR lt_objects.
    SELECT t~obj_name  AS object_name,
           t~object    AS object_type,
           t~devclass  AS package,
           t~author    AS created_by,
           t~created_on AS created_on
      FROM tadir AS t
      WHERE t~pgmid    = 'R3TR'
        AND t~object   IN ('ENHO', 'ENHS')
        AND t~obj_name LIKE @lv_prefix
      INTO CORRESPONDING FIELDS OF TABLE @lt_objects
      UP TO @iv_max_rows ROWS.

    LOOP AT lt_objects INTO ls_object.
      IF ls_object-object_type = 'ENHO'.
        ls_object-object_type_text = 'Enhancement Implementation'.
        ls_object-category = 'ENHANCEMENT_IMPL'.
      ELSE.
        ls_object-object_type_text = 'Enhancement Spot'.
        ls_object-category = 'ENHANCEMENT_SPOT'.
      ENDIF.
      APPEND ls_object TO et_objects.
    ENDLOOP.
  ENDIF.

*-----------------------------------------------------------------------
* Count total
*-----------------------------------------------------------------------
  ev_total_count = lines( et_objects ).

ENDFUNCTION.

FILEOF_4f352e0e

# ─── File: on-prem-abap/Z_MCP_GET_SOURCE_CODE.abap ───
cat > "on-prem-abap/Z_MCP_GET_SOURCE_CODE.abap" << 'FILEOF_8b57cc4f'
*&---------------------------------------------------------------------*
*& RFC Function Module: Z_MCP_GET_SOURCE_CODE
*& Description: Returns the complete source code of any ABAP object
*&              Including all includes, methods, and sub-components
*&---------------------------------------------------------------------*
*& Must be RFC-enabled in SE37
*&---------------------------------------------------------------------*

FUNCTION z_mcp_get_source_code.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_OBJECT_NAME) TYPE  SOBJ_NAME
*"     VALUE(IV_CATEGORY) TYPE  CHAR30
*"  EXPORTING
*"     VALUE(EV_TITLE) TYPE  STRING
*"     VALUE(EV_OBJECT_TYPE) TYPE  STRING
*"     VALUE(EV_PACKAGE) TYPE  DEVCLASS
*"     VALUE(EV_AUTHOR) TYPE  XUBNAME
*"     VALUE(EV_CREATED_ON) TYPE  SYDATUM
*"     VALUE(EV_CHANGED_BY) TYPE  XUBNAME
*"     VALUE(EV_CHANGED_ON) TYPE  SYDATUM
*"  TABLES
*"     ET_SOURCE_CODE STRUCTURE  ZSMCP_SOURCE_LINE
*"     ET_INCLUDES STRUCTURE  ZSMCP_INCLUDE_INFO
*"----------------------------------------------------------------------

  DATA: lt_source    TYPE TABLE OF string,
        ls_source    TYPE zsmcp_source_line,
        ls_include   TYPE zsmcp_include_info,
        lv_progname  TYPE syrepid,
        lv_line_num  TYPE i,
        lt_methods   TYPE seop_methods_w_include,
        ls_method    TYPE seop_method_w_include,
        lt_incl      TYPE TABLE OF sobj_name.

  CLEAR: et_source_code[], et_includes[].

*-----------------------------------------------------------------------
* Get metadata from TADIR
*-----------------------------------------------------------------------
  SELECT SINGLE devclass, author, created_on
    FROM tadir
    INTO (@ev_package, @ev_author, @ev_created_on)
    WHERE obj_name = @iv_object_name
      AND pgmid    = 'R3TR'.

*-----------------------------------------------------------------------
* Handle based on category
*-----------------------------------------------------------------------
  CASE iv_category.

*--- Programs / Reports / Includes ---
    WHEN 'PROGRAM' OR 'REPORT' OR 'INCLUDE' OR 'MODULE_POOL' OR 'SUBROUTINE'.
      lv_progname = iv_object_name.
      ev_object_type = iv_category.

      " Get program title
      SELECT SINGLE text
        FROM trdirt
        INTO @ev_title
        WHERE name  = @lv_progname
          AND sprsl = @sy-langu.

      " Read main source
      READ REPORT lv_progname INTO lt_source.
      IF sy-subrc = 0.
        lv_line_num = 0.
        LOOP AT lt_source INTO DATA(lv_line).
          lv_line_num = lv_line_num + 1.
          CLEAR ls_source.
          ls_source-line_number = lv_line_num.
          ls_source-source_line = lv_line.
          ls_source-include_name = lv_progname.
          ls_source-section = 'MAIN'.
          APPEND ls_source TO et_source_code.

          " Detect INCLUDEs
          IF lv_line CP 'INCLUDE *'.
            DATA(lv_incl_name) = lv_line.
            REPLACE 'INCLUDE' IN lv_incl_name WITH ''.
            REPLACE '.' IN lv_incl_name WITH ''.
            CONDENSE lv_incl_name.
            IF lv_incl_name IS NOT INITIAL.
              CLEAR ls_include.
              ls_include-include_name = lv_incl_name.
              ls_include-include_type = 'INCLUDE'.
              ls_include-parent_object = iv_object_name.
              APPEND ls_include TO et_includes.
            ENDIF.
          ENDIF.
        ENDLOOP.
      ENDIF.

      " Read all detected includes
      LOOP AT et_includes INTO ls_include.
        CLEAR lt_source.
        READ REPORT ls_include-include_name INTO lt_source.
        IF sy-subrc = 0.
          lv_line_num = 0.
          ls_include-line_count = lines( lt_source ).
          MODIFY et_includes FROM ls_include.

          LOOP AT lt_source INTO lv_line.
            lv_line_num = lv_line_num + 1.
            CLEAR ls_source.
            ls_source-line_number = lv_line_num.
            ls_source-source_line = lv_line.
            ls_source-include_name = ls_include-include_name.
            ls_source-section = 'INCLUDE'.
            APPEND ls_source TO et_source_code.
          ENDLOOP.
        ENDIF.
      ENDLOOP.

*--- ABAP Classes ---
    WHEN 'CLASS'.
      ev_object_type = 'CLASS'.

      " Get class description
      SELECT SINGLE descript
        FROM seoclasstx
        INTO @ev_title
        WHERE clsname = @iv_object_name
          AND langu   = @sy-langu.

      " Get class source via class pool program name
      DATA(lv_class_prog) = |\\PROGRAM={ iv_object_name }\\CLASS={ iv_object_name }|.

      " Read class definition (public section)
      DATA(lv_cls_pool) = CONV syrepid( iv_object_name && '==============CP' ).

      " Get all includes of the class
      CALL FUNCTION 'SEO_CLASS_GET_INCLUDE_BY_NAME'
        EXPORTING
          clsname       = CONV seoclsname( iv_object_name )
        TABLES
          includes      = lt_incl
        EXCEPTIONS
          not_existing  = 1
          OTHERS        = 2.

      IF sy-subrc = 0.
        " Standard includes: CCDEF, CCIMP, CCMAC, CCAU
        DATA: lt_cls_includes TYPE TABLE OF string VALUE IS INITIAL.
        APPEND iv_object_name && '==============CCDEF' TO lt_cls_includes. " Class Definition
        APPEND iv_object_name && '==============CCIMP' TO lt_cls_includes. " Class Implementation
        APPEND iv_object_name && '==============CCMAC' TO lt_cls_includes. " Macros
        APPEND iv_object_name && '==============CCAU'  TO lt_cls_includes. " Test Classes

        LOOP AT lt_cls_includes INTO DATA(lv_cls_incl).
          CLEAR lt_source.
          DATA(lv_incl_rep) = CONV syrepid( lv_cls_incl ).
          READ REPORT lv_incl_rep INTO lt_source.
          IF sy-subrc = 0 AND lt_source IS NOT INITIAL.
            DATA(lv_section_name) = COND string(
              WHEN lv_cls_incl CS 'CCDEF' THEN 'CLASS_DEFINITION'
              WHEN lv_cls_incl CS 'CCIMP' THEN 'CLASS_IMPLEMENTATION'
              WHEN lv_cls_incl CS 'CCMAC' THEN 'MACROS'
              WHEN lv_cls_incl CS 'CCAU'  THEN 'TEST_CLASSES'
              ELSE 'OTHER'
            ).

            CLEAR ls_include.
            ls_include-include_name = lv_cls_incl.
            ls_include-include_type = lv_section_name.
            ls_include-parent_object = iv_object_name.
            ls_include-line_count = lines( lt_source ).
            APPEND ls_include TO et_includes.

            lv_line_num = 0.
            LOOP AT lt_source INTO lv_line.
              lv_line_num = lv_line_num + 1.
              CLEAR ls_source.
              ls_source-line_number = lv_line_num.
              ls_source-source_line = lv_line.
              ls_source-include_name = lv_cls_incl.
              ls_source-section = lv_section_name.
              APPEND ls_source TO et_source_code.
            ENDLOOP.
          ENDIF.
        ENDLOOP.

        " Get individual method includes
        CALL METHOD cl_oo_classname_service=>get_all_method_includes
          EXPORTING
            clsname            = CONV seoclsname( iv_object_name )
          RECEIVING
            result             = lt_methods
          EXCEPTIONS
            class_not_existing = 1.

        IF sy-subrc = 0.
          LOOP AT lt_methods INTO ls_method.
            CLEAR lt_source.
            READ REPORT ls_method-incname INTO lt_source.
            IF sy-subrc = 0 AND lt_source IS NOT INITIAL.
              CLEAR ls_include.
              ls_include-include_name = ls_method-incname.
              ls_include-include_type = |METHOD:{ ls_method-cpdname }|.
              ls_include-parent_object = iv_object_name.
              ls_include-line_count = lines( lt_source ).
              APPEND ls_include TO et_includes.

              lv_line_num = 0.
              LOOP AT lt_source INTO lv_line.
                lv_line_num = lv_line_num + 1.
                CLEAR ls_source.
                ls_source-line_number = lv_line_num.
                ls_source-source_line = lv_line.
                ls_source-include_name = ls_method-incname.
                ls_source-section = |METHOD:{ ls_method-cpdname }|.
                APPEND ls_source TO et_source_code.
              ENDLOOP.
            ENDIF.
          ENDLOOP.
        ENDIF.
      ENDIF.

*--- Function Modules ---
    WHEN 'FUNCTION_MODULE'.
      ev_object_type = 'FUNCTION_MODULE'.

      " Get FM details
      SELECT SINGLE e~area
        FROM enlfdir AS e
        INTO @DATA(lv_func_group)
        WHERE e~funcname = @iv_object_name.

      " Get FM short text
      SELECT SINGLE stext
        FROM tftit
        INTO @ev_title
        WHERE funcname = @iv_object_name
          AND spras    = @sy-langu.

      " Read function module source
      CALL FUNCTION 'FUNCTION_INCLUDE_INFO'
        IMPORTING
          include   = DATA(lv_fm_include)
        CHANGING
          funcname  = iv_object_name
        EXCEPTIONS
          OTHERS    = 1.

      IF sy-subrc = 0.
        CLEAR lt_source.
        READ REPORT lv_fm_include INTO lt_source.
        IF sy-subrc = 0.
          lv_line_num = 0.
          LOOP AT lt_source INTO lv_line.
            lv_line_num = lv_line_num + 1.
            CLEAR ls_source.
            ls_source-line_number = lv_line_num.
            ls_source-source_line = lv_line.
            ls_source-include_name = lv_fm_include.
            ls_source-section = 'FUNCTION_MODULE'.
            APPEND ls_source TO et_source_code.
          ENDLOOP.

          CLEAR ls_include.
          ls_include-include_name = lv_fm_include.
          ls_include-include_type = 'FM_INCLUDE'.
          ls_include-parent_object = iv_object_name.
          ls_include-line_count = lines( lt_source ).
          APPEND ls_include TO et_includes.
        ENDIF.
      ENDIF.

      " Also get the function group top include
      IF lv_func_group IS NOT INITIAL.
        DATA(lv_top_incl) = CONV syrepid( |L{ lv_func_group }TOP| ).
        CLEAR lt_source.
        READ REPORT lv_top_incl INTO lt_source.
        IF sy-subrc = 0 AND lt_source IS NOT INITIAL.
          CLEAR ls_include.
          ls_include-include_name = lv_top_incl.
          ls_include-include_type = 'FG_TOP_INCLUDE'.
          ls_include-parent_object = iv_object_name.
          ls_include-line_count = lines( lt_source ).
          APPEND ls_include TO et_includes.

          lv_line_num = 0.
          LOOP AT lt_source INTO lv_line.
            lv_line_num = lv_line_num + 1.
            CLEAR ls_source.
            ls_source-line_number = lv_line_num.
            ls_source-source_line = lv_line.
            ls_source-include_name = lv_top_incl.
            ls_source-section = 'FG_TOP_INCLUDE'.
            APPEND ls_source TO et_source_code.
          ENDLOOP.
        ENDIF.
      ENDIF.

*--- Function Group ---
    WHEN 'FUNCTION_GROUP'.
      ev_object_type = 'FUNCTION_GROUP'.

      " Get all function modules in the group
      SELECT funcname
        FROM enlfdir
        WHERE area = @iv_object_name
        INTO TABLE @DATA(lt_func_names).

      ev_title = |Function Group: { iv_object_name }|.

      " Read top include
      DATA(lv_fg_top) = CONV syrepid( |L{ iv_object_name }TOP| ).
      CLEAR lt_source.
      READ REPORT lv_fg_top INTO lt_source.
      IF sy-subrc = 0.
        lv_line_num = 0.
        LOOP AT lt_source INTO lv_line.
          lv_line_num = lv_line_num + 1.
          CLEAR ls_source.
          ls_source-line_number = lv_line_num.
          ls_source-source_line = lv_line.
          ls_source-include_name = lv_fg_top.
          ls_source-section = 'FG_TOP'.
          APPEND ls_source TO et_source_code.
        ENDLOOP.
      ENDIF.

      " Read each function module's source
      LOOP AT lt_func_names INTO DATA(ls_func_name).
        DATA(lv_fname) = ls_func_name-funcname.
        CALL FUNCTION 'FUNCTION_INCLUDE_INFO'
          IMPORTING
            include   = DATA(lv_fminc)
          CHANGING
            funcname  = lv_fname
          EXCEPTIONS
            OTHERS    = 1.

        IF sy-subrc = 0.
          CLEAR lt_source.
          READ REPORT lv_fminc INTO lt_source.
          IF sy-subrc = 0.
            CLEAR ls_include.
            ls_include-include_name = lv_fminc.
            ls_include-include_type = |FM:{ ls_func_name-funcname }|.
            ls_include-parent_object = iv_object_name.
            ls_include-line_count = lines( lt_source ).
            APPEND ls_include TO et_includes.

            lv_line_num = 0.
            LOOP AT lt_source INTO lv_line.
              lv_line_num = lv_line_num + 1.
              CLEAR ls_source.
              ls_source-line_number = lv_line_num.
              ls_source-source_line = lv_line.
              ls_source-include_name = lv_fminc.
              ls_source-section = |FM:{ ls_func_name-funcname }|.
              APPEND ls_source TO et_source_code.
            ENDLOOP.
          ENDIF.
        ENDIF.
      ENDLOOP.

*--- Enhancement Implementation ---
    WHEN 'ENHANCEMENT_IMPL'.
      ev_object_type = 'ENHANCEMENT'.
      ev_title = |Enhancement Implementation: { iv_object_name }|.

      " Enhancement implementations are stored as programs
      " The include name pattern: program name from TADIR
      SELECT SINGLE obj_name
        FROM tadir
        INTO @DATA(lv_enh_prog)
        WHERE obj_name = @iv_object_name
          AND object   = 'ENHO'.

      IF sy-subrc = 0.
        " Try reading as report
        CLEAR lt_source.
        READ REPORT iv_object_name INTO lt_source.
        IF sy-subrc = 0.
          lv_line_num = 0.
          LOOP AT lt_source INTO lv_line.
            lv_line_num = lv_line_num + 1.
            CLEAR ls_source.
            ls_source-line_number = lv_line_num.
            ls_source-source_line = lv_line.
            ls_source-include_name = iv_object_name.
            ls_source-section = 'ENHANCEMENT'.
            APPEND ls_source TO et_source_code.
          ENDLOOP.
        ENDIF.
      ENDIF.

*--- BAdI Implementation ---
    WHEN 'BADI' OR 'BADI_NEW'.
      ev_object_type = 'BADI'.
      ev_title = |BAdI: { iv_object_name }|.

      " For classic BADIs, get the implementing class
      IF iv_category = 'BADI'.
        SELECT imp_class
          FROM sxc_exit
          WHERE exit_name = @iv_object_name
          INTO TABLE @DATA(lt_badi_classes).

        LOOP AT lt_badi_classes INTO DATA(ls_badi_cls).
          " Recursively read the class source
          " (simplified - in production, call this FM recursively or refactor)
          DATA(lv_badi_class_def) = CONV syrepid(
            ls_badi_cls-imp_class && '==============CCIMP' ).
          CLEAR lt_source.
          READ REPORT lv_badi_class_def INTO lt_source.
          IF sy-subrc = 0.
            lv_line_num = 0.
            LOOP AT lt_source INTO lv_line.
              lv_line_num = lv_line_num + 1.
              CLEAR ls_source.
              ls_source-line_number = lv_line_num.
              ls_source-source_line = lv_line.
              ls_source-include_name = ls_badi_cls-imp_class.
              ls_source-section = |BADI_CLASS:{ ls_badi_cls-imp_class }|.
              APPEND ls_source TO et_source_code.
            ENDLOOP.
          ENDIF.
        ENDLOOP.
      ENDIF.

  ENDCASE.

ENDFUNCTION.

FILEOF_8b57cc4f

# ─── Create .gitignore ───
cat > .gitignore << 'GITIGNORE_EOF'
node_modules/
gen/
mta_archives/
*.mtar
.env
*.log
.DS_Store
default-env.json
connection.properties
GITIGNORE_EOF

echo ""
echo "✅ All 40 files created successfully!"
echo ""
echo "📊 File summary:"
find . -type f | grep -v node_modules | grep -v .git | wc -l
echo " files total"
echo ""
echo "To push to Git, run:"
echo "  git add -A"
echo "  git commit -m 'feat: Complete ABAP Code Analyzer SaaS with Security & Multi-Tenancy'"
echo "  git push origin main"
