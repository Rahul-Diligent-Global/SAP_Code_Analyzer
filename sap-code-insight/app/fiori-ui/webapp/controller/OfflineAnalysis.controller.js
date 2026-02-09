sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/BusyDialog"
], function (Controller, JSONModel, MessageBox, MessageToast, BusyDialog) {
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
                analysisHtml: ""
            });
            this.getView().setModel(this._oModel, "offlineModel");

            this._oBusyDialog = new BusyDialog({
                title: "Analyzing Code",
                text: "Sending code to Claude AI for analysis...\n\nThis may take a moment..."
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

            if (!sCode || sCode.trim().length === 0) {
                MessageBox.warning("Please load code first.");
                return;
            }

            var that = this;
            this._oBusyDialog.open();

            var oODataModel = this.getOwnerComponent().getModel();
            var oContext = oODataModel.bindContext("/analyzeOfflineCode(...)");
            oContext.setParameter("objectName", sName || "UPLOADED_CODE");
            oContext.setParameter("sourceCode", sCode);
            oContext.setParameter("analysisType", "BRD");

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

        // ═══════════════════════════════════════════════════════════
        // ANALYSIS DISPLAY (same as ObjectDetail)
        // ═══════════════════════════════════════════════════════════

        _displayAnalysis: function (oAnalysis) {
            var aHtml = [];

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

            if (oAnalysis.executiveSummary) {
                aHtml.push(this._sectionHeader("Executive Summary"));
                aHtml.push("<p style='line-height:1.6;'>" + this._escapeHtml(oAnalysis.executiveSummary) + "</p>");
            }

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

            if (oAnalysis.functionalRequirements && oAnalysis.functionalRequirements.length > 0) {
                aHtml.push(this._sectionHeader("Functional Requirements"));
                aHtml.push(this._htmlTable(
                    ["ID", "Title", "Description", "Business Rule", "Priority"],
                    oAnalysis.functionalRequirements.map(function (r) { return [r.reqId, r.title, r.description, r.businessRule, r.priority]; }),
                    ["8%", "15%", "32%", "30%", "10%"]
                ));
            }

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
            }

            if (oAnalysis.businessRules && oAnalysis.businessRules.length > 0) {
                aHtml.push(this._sectionHeader("Business Rules"));
                aHtml.push(this._htmlTable(
                    ["Rule ID", "Rule Name", "Description", "Condition", "Action"],
                    oAnalysis.businessRules.map(function (r) { return [r.ruleId, r.ruleName, r.description, r.condition, r.action]; }),
                    ["10%", "15%", "30%", "20%", "25%"]
                ));
            }

            if (oAnalysis.errorHandling && oAnalysis.errorHandling.length > 0) {
                aHtml.push(this._sectionHeader("Error Handling"));
                aHtml.push(this._htmlTable(
                    ["Error Code", "Description", "Business Impact", "Resolution"],
                    oAnalysis.errorHandling.map(function (e) { return [e.errorCode, e.description, e.businessImpact, e.resolution]; }),
                    ["12%", "28%", "30%", "30%"]
                ));
            }

            if (oAnalysis.testScenarios && oAnalysis.testScenarios.length > 0) {
                aHtml.push(this._sectionHeader("Test Scenarios"));
                aHtml.push(this._htmlTable(
                    ["ID", "Title", "Precondition", "Steps", "Expected Result"],
                    oAnalysis.testScenarios.map(function (t) { return [t.scenarioId, t.title, t.precondition, t.steps, t.expectedResult]; }),
                    ["8%", "15%", "22%", "28%", "27%"]
                ));
            }

            if (oAnalysis.appendix) {
                aHtml.push(this._sectionHeader("Appendix"));
                if (oAnalysis.appendix.technicalNotes) {
                    aHtml.push("<p style='color:#555;'>" + this._escapeHtml(oAnalysis.appendix.technicalNotes) + "</p>");
                }
                if (oAnalysis.appendix.assumptions && oAnalysis.appendix.assumptions.length > 0) {
                    aHtml.push("<h4 style='color:#404040;'>Assumptions</h4><ul>");
                    oAnalysis.appendix.assumptions.forEach(function (a) { aHtml.push("<li>" + this._escapeHtml(a) + "</li>"); }.bind(this));
                    aHtml.push("</ul>");
                }
            }

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
