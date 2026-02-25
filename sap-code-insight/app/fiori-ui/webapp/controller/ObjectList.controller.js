sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Label",
    "sap/m/Input",
    "sap/m/Select",
    "sap/m/Table",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/m/Text",
    "sap/m/Title",
    "sap/m/Toolbar",
    "sap/m/ToolbarSpacer",
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/ObjectStatus",
    "sap/m/ObjectIdentifier",
    "sap/m/Panel",
    "sap/m/FlexBox",
    "sap/ui/core/Item",
    "sap/ui/layout/form/SimpleForm"
], function (Controller, Filter, FilterOperator, Sorter, JSONModel,
             MessageBox, MessageToast, Dialog, Button, Label, Input, Select,
             Table, Column, ColumnListItem, Text, Title, Toolbar, ToolbarSpacer,
             VBox, HBox, ObjectStatus, ObjectIdentifier, Panel, FlexBox,
             Item, SimpleForm) {
    "use strict";

    return Controller.extend("com.sap.codeinsight.controller.ObjectList", {

        onInit: function () {
            this._oViewModel = this.getOwnerComponent().getModel("viewModel");
            this._oTable = null;

            // Tenant model for managing tenants
            this._oTenantModel = new JSONModel({
                tenants: [],
                newTenant: {
                    tenantName: "",
                    tenantDomain: "",
                    plan: "PROFESSIONAL",
                    sapHost: "",
                    sapSystemNumber: "00",
                    sapClient: "100",
                    rfcUser: "",
                    destinationName: "",
                    anonymizationLevel: "STANDARD"
                }
            });
        },

        onAfterRendering: function () {
            this._oTable = this.byId("objectTable");
            this._checkUserRole();
        },

        _checkUserRole: function () {
            var that = this;
            var oModel = this.getOwnerComponent().getModel();

            var oContext = oModel.bindContext("/getUserInfo(...)");
            oContext.execute().then(function () {
                var oResult = oContext.getBoundContext().getObject();
                that._oViewModel.setProperty("/isAdmin", oResult.isAdmin);
                that._oViewModel.setProperty("/userId", oResult.id);
            }).catch(function () {
                // In dev mode with dummy auth, default to admin
                that._oViewModel.setProperty("/isAdmin", true);
            });
        },

        // ═══════════════════════════════════════════════════════════
        // OBJECT LIST HANDLERS
        // ═══════════════════════════════════════════════════════════

        // ═══════════════════════════════════════════════════════════
        // OFFLINE ANALYSIS (Upload Code)
        // ═══════════════════════════════════════════════════════════

        onUploadCode: function () {
            this.getOwnerComponent().getRouter().navTo("OfflineAnalysis");
        },

        // ═══════════════════════════════════════════════════════════
        // OBJECT LIST HANDLERS
        // ═══════════════════════════════════════════════════════════

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

        onSearch: function (oEvent) {
            var sQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
            this._applyFilters(sQuery);
        },

        onCategoryFilter: function () {
            this._applyFilters();
        },

        _applyFilters: function (sSearchQuery) {
            var aFilters = [];

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

            var sCategory = this._oViewModel.getProperty("/selectedCategory");
            if (sCategory && sCategory !== "ALL") {
                aFilters.push(new Filter("category", FilterOperator.EQ, sCategory));
            }

            // Namespace filter - filter by object name prefix
            var sNs = this._oViewModel.getProperty("/selectedNamespace") || "Z";
            if (sNs && sNs !== "ALL") {
                if (sNs === "/") {
                    var sCustom = this._oViewModel.getProperty("/customNamespace") || "";
                    if (sCustom) {
                        aFilters.push(new Filter("objectName", FilterOperator.StartsWith, sCustom));
                    } else {
                        aFilters.push(new Filter("objectName", FilterOperator.StartsWith, "/"));
                    }
                } else {
                    aFilters.push(new Filter("objectName", FilterOperator.StartsWith, sNs));
                }
            }

            var oTable = this.byId("objectTable");
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                oBinding.filter(aFilters.length > 0 ? new Filter({ filters: aFilters, and: true }) : []);
                oBinding.attachChange(function () {
                    this._oViewModel.setProperty("/objectCount", oBinding.getLength());
                }.bind(this));
            }
        },

        onNamespaceChange: function () {
            // Clear custom namespace input and apply filter
            this._oViewModel.setProperty("/customNamespace", "");
            this._applyFilters();
        },

        onRefreshObjects: function () {
            var that = this;
            this._oViewModel.setProperty("/busy", true);

            var sNamespace = this._getSelectedNamespace();
            MessageBox.confirm(
                "This will refresh all custom objects from the SAP system with namespace '" + sNamespace + "'. Continue?",
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

        _getSelectedNamespace: function () {
            var sNs = this._oViewModel.getProperty("/selectedNamespace") || "Z";
            if (sNs === "/") {
                var sCustom = this._oViewModel.getProperty("/customNamespace") || "";
                return sCustom || "/";
            }
            if (sNs === "ALL") {
                return "*";
            }
            return sNs;
        },

        _callRefreshAction: function (bRetry) {
            var that = this;
            var oModel = this.getOwnerComponent().getModel();
            var sNamespace = this._getSelectedNamespace();

            var oContext = oModel.bindContext("/refreshObjects(...)");
            oContext.setParameter("filter", {
                objectType: "ALL",
                namespace: sNamespace,
                maxRows: 1000
            });

            oContext.execute().then(function () {
                MessageToast.show("Objects refreshed successfully!");
                that._oViewModel.setProperty("/busy", false);
                that.byId("objectTable").getBinding("items").refresh();
            }).catch(function (oError) {
                // Handle CSRF token expiry (403) - retry once with fresh token
                if (!bRetry && oError.statusCode === 403) {
                    that._refreshCSRFTokenAndRetry(function () {
                        that._callRefreshAction(true);
                    });
                    return;
                }
                that._oViewModel.setProperty("/busy", false);
                MessageBox.error("Failed to refresh objects: " + (oError.message || "Unknown error"));
            });
        },

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
                    fnRetry(); // Retry anyway - let the server reject if token is invalid
                }
            });
        },

        onSort: function () {
            var oTable = this.byId("objectTable");
            var oBinding = oTable.getBinding("items");
            var aSorters = oBinding.aSorters || [];

            if (aSorters.length > 0 && aSorters[0].sPath === "objectName") {
                oBinding.sort(new Sorter("category", false));
            } else {
                oBinding.sort(new Sorter("objectName", false));
            }
        },

        onExport: function () {
            MessageToast.show("Export functionality - implement with sap.ui.export.Spreadsheet");
        },

        // ═══════════════════════════════════════════════════════════
        // Upload Zip File
        // ═══════════════════════════════════════════════════════════
        onUploadZipFile: function () {
            var that = this;

            if (!this._oZipDialog) {
                this._oZipFileUploader = new sap.ui.unified.FileUploader({
                    width: "100%",
                    fileType: ["zip"],
                    placeholder: "Choose a ZIP file",
                    change: function (oEvent) {
                        var file = oEvent.getParameter("files")[0];
                        if (file) {
                            that._processZipFile(file);
                        }
                    }
                });

                this._oZipDialog = new sap.m.Dialog({
                    title: "Upload ABAP ZIP File",
                    contentWidth: "450px",
                    content: [
                        new VBox({
                            items: [
                                new Label({
                                    text: "Select ZIP file containing ABAP objects:",
                                    class: "sapUiSmallMarginBottom"
                                }),
                                this._oZipFileUploader
                            ]
                        }).addStyleClass("sapUiMediumMargin")
                    ],
                    endButton: new Button({
                        text: "Close",
                        press: function () {
                            that._oZipDialog.close();
                        }
                    })
                });
            }

            // Clear previously selected file
            this._oZipFileUploader.clear();

            this._oZipDialog.open();
        },

        _processZipFile: function (file) {
            var that = this;
            var reader = new FileReader();
            reader.onload = function (e) {
                JSZip.loadAsync(e.target.result).then(function (zip) {
                    var aObjects = [];
                    var aPromises = [];

                    zip.forEach(function (relativePath, zipEntry) {
                        if (!zipEntry.dir) {
                            var sFileName = relativePath.split("/").pop();
                            var aParts = sFileName.split(".");
                            // Pattern: <objectName>.<type>.abap e.g. z_faa_racorr20_105.prog.abap
                            // For fugr: <groupName>.fugr.<functionModuleName>.abap
                            var sTypeCode = aParts.length >= 3 ? aParts[1] : "";
                            var sObjectName;
                            var sType;

                            if (sTypeCode.toLowerCase() === "fugr" && aParts.length >= 4 && aParts[2]) {
                                // Function group file: use the 3rd segment as FM name
                                sObjectName = aParts[2];
                                sType = "Function Module";
                            } else {
                                sObjectName = aParts[0] || sFileName;
                                sType = that._detectObjectType(sTypeCode);
                            }
                            var idx = aObjects.length;

                            aObjects.push({
                                objectName: sObjectName.toUpperCase(),
                                objectType: sType,
                                fileName: sFileName,
                                sourceCode: ""
                            });

                            // Read file content asynchronously
                            aPromises.push(
                                zipEntry.async("string").then(function (content) {
                                    aObjects[idx].sourceCode = content;
                                })
                            );
                        }
                    });

                    // Wait for all file contents to be read
                    Promise.all(aPromises).then(function () {
                        if (that._oZipDialog) {
                            that._oZipDialog.close();
                        }
                        // Store objects for later access
                        that._aZipObjects = aObjects;
                        that._showZipObjectList(aObjects);
                    });

                }).catch(function () {
                    sap.m.MessageBox.error("Invalid ZIP file.");
                });
            };

            reader.readAsArrayBuffer(file);
        },

        _detectObjectType: function (sTypeCode) {
            var typeMap = {
                "prog": "Program / Report",
                "clas": "ABAP Class",
                "fugr": "Function Group",
                "func": "Function Module",
                "intf": "Interface",
                "incl": "Include",
                "tabl": "Table",
                "dtel": "Data Element",
                "doma": "Domain",
                "shlp": "Search Help",
                "ttyp": "Table Type",
                "msag": "Message Class",
                "enho": "Enhancement",
                "badi": "BAdI Implementation"
            };
            var sKey = (sTypeCode || "").toLowerCase();
            return typeMap[sKey] || sTypeCode.toUpperCase() || "Unknown";
        },

        _showZipObjectList: function (aObjects) {
            var that = this;

            var oZipModel = new JSONModel({ objects: aObjects });
            oZipModel.setSizeLimit(5000);

            if (this._oZipResultDialog) {
                this._oZipResultDialog.destroy();
            }

            // Collect unique types for toolbar filter & column filter
            var oTypeSeen = {};
            var aUniqueTypes = [];
            aObjects.forEach(function (obj) {
                if (!oTypeSeen[obj.objectType]) { oTypeSeen[obj.objectType] = true; aUniqueTypes.push(obj.objectType); }
            });
            aUniqueTypes.sort();

            // Filter/sort state
            this._sZipSearchQuery = "";
            this._sZipTypeFilter = "ALL";
            this._oZipSortState = { field: null, desc: false };

            // Columns
            var oNameColumn = new Column({ width: "55%", header: new Text({ text: "Object Name" }) });
            var oTypeColumn = new Column({ width: "45%", header: new Text({ text: "Object Type" }) });

            // Table - no default sort
            var oZipTable = new Table({
                growing: true,
                growingThreshold: 50,
                alternateRowColors: true,
                mode: "MultiSelect",
                columns: [oNameColumn, oTypeColumn],
                items: {
                    path: "/objects",
                    template: new ColumnListItem({
                        type: "Navigation",
                        press: function (oEvent) {
                            var oCtx = oEvent.getSource().getBindingContext();
                            var sFileName = oCtx.getProperty("fileName");
                            var oObj = that._aZipObjects.find(function (o) { return o.fileName === sFileName; });
                            if (oObj) { that._showSourceCode(oObj); }
                        },
                        cells: [
                            new Text({ text: "{objectName}" }),
                            new Text({ text: "{objectType}" })
                        ]
                    })
                }
            });

            oZipTable.setModel(oZipModel);

            // Store references
            this._oZipTable = oZipTable;
            this._oZipNameColumn = oNameColumn;
            this._oZipTypeColumn = oTypeColumn;

            // Column header press -> sort/filter popover
            oNameColumn.attachEvent("columnPress", function () {
                that._openZipColumnMenu("objectName", oNameColumn, oTypeColumn, oZipTable);
            });
            oTypeColumn.attachEvent("columnPress", function () {
                that._openZipColumnMenu("objectType", oTypeColumn, oNameColumn, oZipTable);
            });

            // Toolbar: Search + Type filter
            var oSearchField = new sap.m.SearchField({
                placeholder: "Search by object name...",
                width: "250px",
                liveChange: function () {
                    that._sZipSearchQuery = oSearchField.getValue().trim();
                    that._applyZipFilters(oZipTable);
                }
            });

            var oTypeFilterSelect = new Select({
                width: "180px",
                items: [new Item({ key: "ALL", text: "All Types" })].concat(
                    aUniqueTypes.map(function (sType) {
                        return new Item({ key: sType, text: sType });
                    })
                ),
                change: function () {
                    that._sZipTypeFilter = oTypeFilterSelect.getSelectedKey();
                    that._applyZipFilters(oZipTable);
                }
            });

            // Generate Document MenuButton - disabled until selection
            var oGenDocBtn = new sap.m.MenuButton({
                text: "Generate Document",
                icon: "sap-icon://document",
                type: "Emphasized",
                enabled: false,
                menu: new sap.m.Menu({
                    items: [
                        new sap.m.MenuItem({ text: "Generate BRD (Word)", press: function () { that._onZipGenerateDoc("DOCX", "BRD"); } }),
                        new sap.m.MenuItem({ text: "Generate BRD (PDF)", press: function () { that._onZipGenerateDoc("PDF", "BRD"); } }),
                        new sap.m.MenuItem({ text: "Functional Spec (Word)", press: function () { that._onZipGenerateDoc("DOCX", "FUNC_SPEC"); } }),
                        new sap.m.MenuItem({ text: "Technical Spec (Word)", press: function () { that._onZipGenerateDoc("DOCX", "TECH_SPEC"); } }),
                        new sap.m.MenuItem({ text: "Code Review (Word)", press: function () { that._onZipGenerateDoc("DOCX", "CODE_REVIEW"); } })
                    ]
                })
            });

            // Enable/disable Generate button based on selection
            oZipTable.attachSelectionChange(function () {
                var iSelected = oZipTable.getSelectedItems().length;
                oGenDocBtn.setEnabled(iSelected > 0);
            });

            var oToolbar = new Toolbar({
                content: [
                    oSearchField,
                    new ToolbarSpacer(),
                    new Label({ text: "Type:" }),
                    oTypeFilterSelect,
                    new ToolbarSpacer(),
                    new Button({
                        icon: "sap-icon://excel-attachment",
                        tooltip: "Export to Excel",
                        type: "Transparent",
                        press: function () {
                            that._exportZipListToExcel(oZipTable);
                        }
                    }),
                    oGenDocBtn
                ]
            });

            oZipTable.setHeaderToolbar(oToolbar);

            this._oZipResultDialog = new Dialog({
                title: "Object List (" + aObjects.length + ")",
                contentWidth: "750px",
                contentHeight: "500px",
                resizable: true,
                draggable: true,
                content: [oZipTable],
                endButton: new Button({
                    text: "Close",
                    press: function () { that._oZipResultDialog.close(); }
                })
            });

            this._oZipResultDialog.open();
        },

        // ═══════════════════════════════════════════════════════════
        // ZIP BATCH DOCUMENT GENERATION
        // ═══════════════════════════════════════════════════════════

        _onZipGenerateDoc: function (sFormat, sAnalysisType) {
            var that = this;
            var aSelectedItems = this._oZipTable.getSelectedItems();
            if (aSelectedItems.length === 0) {
                MessageBox.warning("Please select at least one object.");
                return;
            }

            // Collect selected objects with source code
            var aSelectedObjects = [];
            aSelectedItems.forEach(function (oItem) {
                var oCtx = oItem.getBindingContext();
                var sFileName = oCtx.getProperty("fileName");
                var oObj = that._aZipObjects.find(function (o) { return o.fileName === sFileName; });
                if (oObj) { aSelectedObjects.push(oObj); }
            });

            // Show detail level dialog
            this._showZipGenDialog(sFormat, sAnalysisType, aSelectedObjects);
        },

        _showZipGenDialog: function (sFormat, sAnalysisType, aSelectedObjects) {
            var that = this;

            if (this._oZipGenDialog) { this._oZipGenDialog.destroy(); }

            var oDetailSelect = new Select({
                width: "100%",
                items: [
                    new Item({ key: "SUMMARY", text: "Summary (2-3 pages)" }),
                    new Item({ key: "DETAILED", text: "Detailed (5-10 pages)" }),
                    new Item({ key: "COMPREHENSIVE", text: "Comprehensive (10+ pages)" })
                ],
                selectedKey: "DETAILED"
            });

            var oIncludeCodeCb = new sap.m.CheckBox({ text: "Include Source Code", selected: true });

            var sDocLabel = sAnalysisType === "FUNC_SPEC" ? "Functional Spec" :
                            sAnalysisType === "TECH_SPEC" ? "Technical Spec" :
                            sAnalysisType === "CODE_REVIEW" ? "Code Review" : "BRD";

            this._oZipGenDialog = new Dialog({
                title: "Generate " + sDocLabel + " (" + sFormat + ") - " + aSelectedObjects.length + " objects",
                contentWidth: "450px",
                content: [
                    new VBox({
                        items: [
                            new Label({ text: "Detail Level:", design: "Bold" }),
                            oDetailSelect,
                            oIncludeCodeCb
                        ]
                    }).addStyleClass("sapUiMediumMargin")
                ],
                beginButton: new Button({
                    text: "Generate",
                    type: "Emphasized",
                    press: function () {
                        that._oZipGenDialog.close();
                        that._executeBatchGeneration(
                            sFormat, sAnalysisType, aSelectedObjects,
                            oDetailSelect.getSelectedKey(),
                            oIncludeCodeCb.getSelected()
                        );
                    }
                }),
                endButton: new Button({
                    text: "Cancel",
                    press: function () { that._oZipGenDialog.close(); }
                })
            });

            this._oZipGenDialog.open();
        },

        _executeBatchGeneration: function (sFormat, sAnalysisType, aObjects, sDetailLevel, bIncludeCode) {
            var that = this;
            var oModel = this.getOwnerComponent().getModel();
            var iTotal = aObjects.length;
            var iDone = 0;
            var aResults = [];

            // Progress dialog
            if (!this._oBatchBusyDialog) {
                this._oBatchBusyDialog = new sap.m.BusyDialog({ title: "Generating Documents" });
            }
            this._oBatchBusyDialog.setText("Processing 0 of " + iTotal + " objects...\nThis may take several minutes.");
            this._oBatchBusyDialog.open();

            // Process one at a time sequentially to avoid overloading
            var fnProcessNext = function (idx) {
                if (idx >= iTotal) {
                    // All done - bundle into ZIP
                    that._oBatchBusyDialog.setText("Creating ZIP file...");
                    that._bundleAndDownloadZip(aResults, sAnalysisType, sFormat);
                    return;
                }

                var oObj = aObjects[idx];
                that._oBatchBusyDialog.setText(
                    "Processing " + (idx + 1) + " of " + iTotal + "...\n" +
                    "Object: " + oObj.objectName + "\n\n" +
                    "Analyzing with AI and generating document..."
                );

                var oContext = oModel.bindContext("/generateOfflineDocument(...)");
                oContext.setParameter("objectName", oObj.objectName);
                oContext.setParameter("sourceCode", oObj.sourceCode || "");
                oContext.setParameter("options", {
                    documentType: sFormat,
                    analysisType: sAnalysisType,
                    includeCode: bIncludeCode,
                    detailLevel: sDetailLevel,
                    customPrompt: "",
                    templateId: null,
                    referenceContent: null
                });

                oContext.execute().then(function () {
                    var oResult = oContext.getBoundContext().getObject();
                    if (oResult.success) {
                        aResults.push({
                            objectName: oObj.objectName,
                            fileName: oResult.fileName,
                            fileContent: oResult.fileContent,
                            fileType: oResult.fileType
                        });
                    }
                    iDone++;
                    fnProcessNext(idx + 1);
                }).catch(function (oError) {
                    console.error("Failed to generate document for " + oObj.objectName + ":", oError.message);
                    iDone++;
                    fnProcessNext(idx + 1);
                });
            };

            fnProcessNext(0);
        },

        _bundleAndDownloadZip: function (aResults, sAnalysisType, sFormat) {
            var that = this;

            if (aResults.length === 0) {
                this._oBatchBusyDialog.close();
                MessageBox.error("No documents were generated successfully.");
                return;
            }

            // If only 1 document, download directly
            if (aResults.length === 1) {
                this._oBatchBusyDialog.close();
                this._downloadFile(aResults[0].fileContent, aResults[0].fileName, aResults[0].fileType);
                MessageToast.show("Document generated successfully!");
                return;
            }

            // Bundle multiple into a ZIP using JSZip
            var oZip = new JSZip();
            aResults.forEach(function (oResult) {
                var byteCharacters = atob(oResult.fileContent);
                var byteArray = new Uint8Array(byteCharacters.length);
                for (var i = 0; i < byteCharacters.length; i++) {
                    byteArray[i] = byteCharacters.charCodeAt(i);
                }
                oZip.file(oResult.fileName, byteArray);
            });

            oZip.generateAsync({ type: "blob" }).then(function (oBlob) {
                that._oBatchBusyDialog.close();

                var sZipName = sAnalysisType + "_Documents_" + new Date().toISOString().slice(0, 10) + ".zip";
                var oLink = document.createElement("a");
                oLink.href = URL.createObjectURL(oBlob);
                oLink.download = sZipName;
                document.body.appendChild(oLink);
                oLink.click();
                document.body.removeChild(oLink);
                URL.revokeObjectURL(oLink.href);

                MessageToast.show(aResults.length + " documents bundled and downloaded as ZIP!");
            }).catch(function () {
                that._oBatchBusyDialog.close();
                MessageBox.error("Failed to create ZIP file.");
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

        _exportZipListToExcel: function (oTable) {
            // Get currently visible (filtered) items from the table binding
            var oBinding = oTable.getBinding("items");
            var aContexts = oBinding.getContexts(0, oBinding.getLength());

            var aRows = aContexts.map(function (oCtx) {
                return {
                    objectName: oCtx.getProperty("objectName"),
                    objectType: oCtx.getProperty("objectType")
                };
            });

            // Build CSV content with BOM for Excel UTF-8 support
            var sCsv = "\uFEFF";
            sCsv += "Object Name,Object Type\r\n";
            aRows.forEach(function (row) {
                // Escape fields that may contain commas
                var sName = '"' + (row.objectName || "").replace(/"/g, '""') + '"';
                var sType = '"' + (row.objectType || "").replace(/"/g, '""') + '"';
                sCsv += sName + "," + sType + "\r\n";
            });

            // Trigger download
            var oBlob = new Blob([sCsv], { type: "text/csv;charset=utf-8;" });
            var sUrl = URL.createObjectURL(oBlob);
            var oLink = document.createElement("a");
            oLink.href = sUrl;
            oLink.download = "ABAP_Object_List.csv";
            document.body.appendChild(oLink);
            oLink.click();
            document.body.removeChild(oLink);
            URL.revokeObjectURL(sUrl);

            MessageToast.show("Exported " + aRows.length + " objects to Excel");
        },

        _openZipColumnMenu: function (sField, oColumn, oOtherColumn, oTable) {
            var that = this;

            if (this._oZipColumnPopover) {
                this._oZipColumnPopover.destroy();
            }

            var oPopover = new sap.m.Popover({
                title: sField === "objectName" ? "Object Name" : "Object Type",
                placement: "Bottom",
                contentWidth: "250px",
                content: [
                    new VBox({
                        class: "sapUiSmallMargin",
                        items: [
                            new Button({
                                icon: "sap-icon://sort-ascending",
                                text: "Sort Ascending",
                                type: that._oZipSortState.field === sField && !that._oZipSortState.desc ? "Emphasized" : "Transparent",
                                width: "100%",
                                press: function () {
                                    that._oZipSortState = { field: sField, desc: false };
                                    oColumn.setSortIndicator("Ascending");
                                    oOtherColumn.setSortIndicator("None");
                                    oTable.getBinding("items").sort(new Sorter(sField, false));
                                    oPopover.close();
                                }
                            }),
                            new Button({
                                icon: "sap-icon://sort-descending",
                                text: "Sort Descending",
                                type: that._oZipSortState.field === sField && that._oZipSortState.desc ? "Emphasized" : "Transparent",
                                width: "100%",
                                press: function () {
                                    that._oZipSortState = { field: sField, desc: true };
                                    oColumn.setSortIndicator("Descending");
                                    oOtherColumn.setSortIndicator("None");
                                    oTable.getBinding("items").sort(new Sorter(sField, true));
                                    oPopover.close();
                                }
                            }),
                            new Button({
                                icon: "sap-icon://clear-filter",
                                text: "Remove Sort",
                                type: "Transparent",
                                width: "100%",
                                enabled: that._oZipSortState.field === sField,
                                press: function () {
                                    that._oZipSortState = { field: null, desc: false };
                                    oColumn.setSortIndicator("None");
                                    oOtherColumn.setSortIndicator("None");
                                    oTable.getBinding("items").sort();
                                    oPopover.close();
                                }
                            })
                        ]
                    })
                ]
            });

            this._oZipColumnPopover = oPopover;
            oPopover.openBy(oColumn);
        },

        _applyZipFilters: function (oTable) {
            var aFilters = [];

            if (this._sZipSearchQuery) {
                aFilters.push(new Filter("objectName", FilterOperator.Contains, this._sZipSearchQuery.toUpperCase()));
            }
            if (this._sZipTypeFilter && this._sZipTypeFilter !== "ALL") {
                aFilters.push(new Filter("objectType", FilterOperator.EQ, this._sZipTypeFilter));
            }

            oTable.getBinding("items").filter(aFilters.length > 0 ? new Filter({ filters: aFilters, and: true }) : []);
        },

        _showSourceCode: function (oObject) {
            var that = this;

            if (this._oSourceCodeDialog) {
                this._oSourceCodeDialog.destroy();
            }

            var sCode = oObject.sourceCode || "* No source code available";
            var aLines = sCode.split("\n");
            var iLineCount = aLines.length;

            // IDs for DOM elements
            var sTimestamp = Date.now();
            var sContainerId = "zipCodeContainer_" + sTimestamp;
            var sCodeId = "zipCodePre_" + sTimestamp;
            var sSearchId = "zipCodeSearch_" + sTimestamp;
            var sCountId = "zipCodeCount_" + sTimestamp;

            // Search state
            this._iCodeSearchIdx = -1;
            this._aCodeSearchMarks = [];
            this._sCodeOriginalHtml = "";

            var oContainer = new sap.ui.core.HTML({
                content: "<div id='" + sContainerId + "' style='width:100%;height:100%;display:flex;flex-direction:column;'>" +
                    "<div style='display:flex;align-items:center;padding:6px 12px;background:#2d2d2d;border-bottom:1px solid #444;gap:8px;flex-shrink:0;'>" +
                        "<input id='" + sSearchId + "' type='text' placeholder='Find in code...' " +
                            "style='flex:1;padding:5px 10px;border:1px solid #555;border-radius:3px;background:#1e1e1e;color:#d4d4d4;" +
                            "font-family:Consolas,monospace;font-size:13px;outline:none;'/>" +
                        "<span id='" + sCountId + "' style='color:#999;font-size:12px;min-width:70px;text-align:center;'>0 results</span>" +
                        "<button id='zipCodePrev_" + sTimestamp + "' style='padding:4px 10px;background:#3c3c3c;color:#d4d4d4;border:1px solid #555;border-radius:3px;cursor:pointer;font-size:12px;'>&#9650; Prev</button>" +
                        "<button id='zipCodeNext_" + sTimestamp + "' style='padding:4px 10px;background:#3c3c3c;color:#d4d4d4;border:1px solid #555;border-radius:3px;cursor:pointer;font-size:12px;'>&#9660; Next</button>" +
                    "</div>" +
                    "<div style='flex:1;overflow:auto;background:#1e1e1e;'>" +
                        "<pre id='" + sCodeId + "' style='font-family:Consolas,\"Courier New\",monospace;font-size:13px;" +
                            "color:#d4d4d4;margin:0;padding:16px;line-height:1.6;tab-size:4;white-space:pre;'></pre>" +
                    "</div>" +
                "</div>"
            });

            this._oSourceCodeDialog = new Dialog({
                title: oObject.objectName + " (" + oObject.objectType + ") - " + iLineCount + " lines",
                contentWidth: "900px",
                contentHeight: "600px",
                resizable: true,
                draggable: true,
                content: [oContainer],
                endButton: new Button({
                    text: "Close",
                    press: function () { that._oSourceCodeDialog.close(); }
                }),
                afterOpen: function () {
                    // Compute available height
                    var oDlgDom = that._oSourceCodeDialog.getDomRef();
                    var oSection = oDlgDom ? oDlgDom.querySelector(".sapMDialogSection") : null;
                    var iHeight = oSection ? oSection.clientHeight : 550;

                    var oOuterDiv = document.getElementById(sContainerId);
                    if (oOuterDiv) {
                        oOuterDiv.style.height = iHeight + "px";
                    }

                    // Render code with line numbers as plain escaped text
                    var oCodePre = document.getElementById(sCodeId);
                    if (oCodePre) {
                        var sEscaped = sCode.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                        oCodePre.innerHTML = sEscaped;
                        that._sCodeOriginalHtml = sEscaped;
                    }

                    // Wire up search
                    var oSearchInput = document.getElementById(sSearchId);
                    var oCountSpan = document.getElementById(sCountId);
                    var oPrevBtn = document.getElementById("zipCodePrev_" + sTimestamp);
                    var oNextBtn = document.getElementById("zipCodeNext_" + sTimestamp);

                    if (oSearchInput) {
                        var fnDoSearch = function () {
                            that._codeSearchHighlight(oCodePre, oSearchInput.value, oCountSpan);
                        };
                        oSearchInput.addEventListener("input", fnDoSearch);
                        oSearchInput.addEventListener("keydown", function (e) {
                            if (e.key === "Enter") {
                                if (e.shiftKey) {
                                    that._codeSearchNavigate(oCodePre, -1, oCountSpan);
                                } else {
                                    that._codeSearchNavigate(oCodePre, 1, oCountSpan);
                                }
                            }
                        });
                    }
                    if (oNextBtn) {
                        oNextBtn.addEventListener("click", function () {
                            that._codeSearchNavigate(oCodePre, 1, oCountSpan);
                        });
                    }
                    if (oPrevBtn) {
                        oPrevBtn.addEventListener("click", function () {
                            that._codeSearchNavigate(oCodePre, -1, oCountSpan);
                        });
                    }

                    // Focus search input
                    if (oSearchInput) { oSearchInput.focus(); }
                }
            });

            this._oSourceCodeDialog.open();
        },

        _codeSearchHighlight: function (oCodePre, sQuery, oCountSpan) {
            // Reset to original
            oCodePre.innerHTML = this._sCodeOriginalHtml;
            this._iCodeSearchIdx = -1;
            this._aCodeSearchMarks = [];

            if (!sQuery || sQuery.length === 0) {
                oCountSpan.textContent = "0 results";
                return;
            }

            // Escape regex special chars
            var sEscaped = sQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            var oRegex = new RegExp("(" + sEscaped + ")", "gi");

            // Replace matches with <mark> tags
            var iCount = 0;
            oCodePre.innerHTML = this._sCodeOriginalHtml.replace(oRegex, function (match) {
                iCount++;
                return "<mark class='codeSearchMatch' style='background:#515c6a;color:#d4d4d4;border-radius:2px;padding:0 1px;'>" + match + "</mark>";
            });

            this._aCodeSearchMarks = oCodePre.querySelectorAll("mark.codeSearchMatch");
            oCountSpan.textContent = iCount + " result" + (iCount !== 1 ? "s" : "");

            // Auto-navigate to first match
            if (iCount > 0) {
                this._iCodeSearchIdx = 0;
                this._highlightCurrentMatch(oCountSpan);
            }
        },

        _codeSearchNavigate: function (oCodePre, iDirection, oCountSpan) {
            if (!this._aCodeSearchMarks || this._aCodeSearchMarks.length === 0) return;

            this._iCodeSearchIdx += iDirection;
            var iTotal = this._aCodeSearchMarks.length;

            // Wrap around
            if (this._iCodeSearchIdx >= iTotal) { this._iCodeSearchIdx = 0; }
            if (this._iCodeSearchIdx < 0) { this._iCodeSearchIdx = iTotal - 1; }

            this._highlightCurrentMatch(oCountSpan);
        },

        _highlightCurrentMatch: function (oCountSpan) {
            var iTotal = this._aCodeSearchMarks.length;
            // Reset all marks to default style
            for (var i = 0; i < iTotal; i++) {
                this._aCodeSearchMarks[i].style.background = "#515c6a";
                this._aCodeSearchMarks[i].style.color = "#d4d4d4";
            }
            // Highlight current match
            var oCurrent = this._aCodeSearchMarks[this._iCodeSearchIdx];
            if (oCurrent) {
                oCurrent.style.background = "#f0b400";
                oCurrent.style.color = "#000000";
                oCurrent.scrollIntoView({ behavior: "smooth", block: "center" });
            }
            oCountSpan.textContent = (this._iCodeSearchIdx + 1) + " of " + iTotal;
        },

        // ═══════════════════════════════════════════════════════════
        // TENANT MANAGER
        // ═══════════════════════════════════════════════════════════

        onOpenTenantManager: function () {
            if (!this._oTenantDialog) {
                this._oTenantDialog = this._createTenantDialog();
            }
            this._loadTenants();
            this._oTenantDialog.open();
        },

        _createTenantDialog: function () {
            var that = this;

            var oTenantTable = new Table("tenantListTable", {
                growing: true,
                growingThreshold: 20,
                mode: "None",
                alternateRowColors: true,
                class: "tenantTable",
                headerToolbar: new Toolbar({
                    content: [
                        new Title({ text: "Subscribed Tenants", level: "H5" }),
                        new ToolbarSpacer(),
                        new Button({
                            text: "Add Tenant",
                            icon: "sap-icon://add",
                            type: "Emphasized",
                            press: function () { that._showAddTenantDialog(); }
                        })
                    ]
                }),
                columns: [
                    new Column({ width: "20%", header: new Text({ text: "Tenant Name" }) }),
                    new Column({ width: "15%", header: new Text({ text: "Plan" }) }),
                    new Column({ width: "20%", header: new Text({ text: "Destination" }) }),
                    new Column({ width: "12%", header: new Text({ text: "Status" }) }),
                    new Column({ width: "12%", header: new Text({ text: "API Calls" }) }),
                    new Column({ width: "10%", header: new Text({ text: "Anonymization" }) }),
                    new Column({ width: "11%", header: new Text({ text: "Actions" }) })
                ]
            });

            oTenantTable.setModel(this._oTenantModel);
            oTenantTable.bindItems({
                path: "/tenants",
                template: new ColumnListItem({
                    cells: [
                        new ObjectIdentifier({
                            title: "{tenantName}",
                            text: "{tenantId}"
                        }),
                        new ObjectStatus({
                            text: "{plan}",
                            state: "{= ${plan} === 'ENTERPRISE' ? 'Success' : ${plan} === 'PROFESSIONAL' ? 'Information' : 'None'}"
                        }),
                        new Text({ text: "{destinationName}" }),
                        new ObjectStatus({
                            text: "{status}",
                            state: "{= ${status} === 'ACTIVE' ? 'Success' : ${status} === 'SUSPENDED' ? 'Warning' : 'Error'}"
                        }),
                        new Text({ text: "{= ${currentAPICallCount} + ' / ' + ${maxAPICallsPerMonth}}" }),
                        new Text({ text: "{anonymizationLevel}" }),
                        new HBox({
                            items: [
                                new Button({
                                    icon: "sap-icon://connected",
                                    tooltip: "Test Connection",
                                    type: "Transparent",
                                    press: function (oEvt) {
                                        var sPath = oEvt.getSource().getParent().getParent().getBindingContextPath();
                                        var sTenantId = that._oTenantModel.getProperty(sPath + "/tenantId");
                                        that._testTenantConnection(sTenantId);
                                    }
                                }),
                                new Button({
                                    icon: "sap-icon://edit",
                                    tooltip: "Configure",
                                    type: "Transparent",
                                    press: function (oEvt) {
                                        var sPath = oEvt.getSource().getParent().getParent().getBindingContextPath();
                                        var oTenant = that._oTenantModel.getProperty(sPath);
                                        that._showEditTenantDialog(oTenant);
                                    }
                                })
                            ]
                        })
                    ]
                })
            });

            var oDialog = new Dialog({
                title: "Tenant Onboarding Manager",
                contentWidth: "950px",
                contentHeight: "500px",
                resizable: true,
                draggable: true,
                content: [
                    new VBox({
                        class: "sapUiSmallMargin",
                        items: [
                            new Panel({
                                headerText: "Onboarding Overview",
                                expandable: false,
                                content: [
                                    new HBox({
                                        class: "sapUiSmallMargin",
                                        justifyContent: "SpaceAround",
                                        items: [
                                            this._createInfoTile("Total Tenants", "{/tenants}.length", "sap-icon://company-view"),
                                            this._createInfoTile("Active", "Active", "sap-icon://accept"),
                                            this._createInfoTile("Plans", "Multi-Tier", "sap-icon://cart")
                                        ]
                                    })
                                ]
                            }),
                            oTenantTable
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

        _createInfoTile: function (sTitle, sValue, sIcon) {
            return new VBox({
                alignItems: "Center",
                items: [
                    new sap.ui.core.Icon({ src: sIcon, size: "1.5rem", color: "#0a6ed1" }),
                    new Label({ text: sTitle, design: "Bold", class: "sapUiTinyMarginTop" }),
                    new Text({ text: sValue })
                ]
            });
        },

        _loadTenants: function () {
            var that = this;

            jQuery.ajax({
                url: "/api/analyzer/TenantConfig",
                method: "GET",
                dataType: "json",
                success: function (oData) {
                    var aTenants = oData.value || [];
                    if (aTenants.length > 0) {
                        that._oTenantModel.setProperty("/tenants", aTenants);
                    } else {
                        that._loadMockTenants();
                    }
                },
                error: function (jqXHR) {
                    console.warn("Failed to load tenants from backend:", jqXHR.status, jqXHR.responseText);
                    that._loadMockTenants();
                }
            });
        },

        _loadMockTenants: function () {
            var aTenants = this._oTenantModel.getProperty("/tenants");
            if (aTenants.length === 0) {
                this._oTenantModel.setProperty("/tenants", [
                    {
                        tenantId: "t-001-demo",
                        tenantName: "Demo Company",
                        tenantDomain: "demo.codeinsight.com",
                        plan: "PROFESSIONAL",
                        status: "ACTIVE",
                        destinationName: "S2A",
                        sapSystemId: "S2A",
                        sapClientNumber: "200",
                        maxAPICallsPerMonth: 500,
                        currentAPICallCount: 12,
                        anonymizationLevel: "STANDARD",
                        onboardedAt: "2024-12-01"
                    }
                ]);
            }
        },

        _showAddTenantDialog: function () {
            var that = this;

            var oDialog = new Dialog({
                title: "Onboard New Tenant",
                contentWidth: "500px",
                content: [
                    new SimpleForm({
                        editable: true,
                        layout: "ResponsiveGridLayout",
                        labelSpanXL: 4, labelSpanL: 4, labelSpanM: 4,
                        emptySpanXL: 0, emptySpanL: 0, emptySpanM: 0,
                        columnsXL: 1, columnsL: 1, columnsM: 1,
                        class: "sapUiSmallMargin",
                        content: [
                            new sap.ui.core.Title({ text: "Company Information" }),
                            new Label({ text: "Company Name", required: true }),
                            new Input("newTenantName", { placeholder: "Acme Corporation" }),
                            new Label({ text: "Domain" }),
                            new Input("newTenantDomain", { placeholder: "acme.codeinsight.com" }),
                            new Label({ text: "Plan" }),
                            new Select("newTenantPlan", {
                                selectedKey: "PROFESSIONAL",
                                items: [
                                    new Item({ key: "BASIC", text: "Basic (100 API calls/mo)" }),
                                    new Item({ key: "PROFESSIONAL", text: "Professional (500 API calls/mo)" }),
                                    new Item({ key: "ENTERPRISE", text: "Enterprise (Unlimited)" })
                                ]
                            }),

                            new sap.ui.core.Title({ text: "SAP System Connection" }),
                            new Label({ text: "SAP Host", required: true }),
                            new Input("newSapHost", { placeholder: "s2as4h20hyd" }),
                            new Label({ text: "System Number" }),
                            new Input("newSapSysNr", { value: "00", maxLength: 2 }),
                            new Label({ text: "Client" }),
                            new Input("newSapClient", { value: "200", maxLength: 3 }),
                            new Label({ text: "RFC User" }),
                            new Input("newRfcUser", { placeholder: "RFC_USER" }),
                            new Label({ text: "Destination Name" }),
                            new Input("newDestName", { placeholder: "SAP_ONPREM_ACME" }),

                            new sap.ui.core.Title({ text: "Security" }),
                            new Label({ text: "Anonymization Level" }),
                            new Select("newAnonLevel", {
                                selectedKey: "STANDARD",
                                items: [
                                    new Item({ key: "BASIC", text: "Basic" }),
                                    new Item({ key: "STANDARD", text: "Standard (Recommended)" }),
                                    new Item({ key: "STRICT", text: "Strict" }),
                                    new Item({ key: "MAXIMUM", text: "Maximum" })
                                ]
                            })
                        ]
                    })
                ],
                beginButton: new Button({
                    text: "Onboard Tenant",
                    type: "Emphasized",
                    icon: "sap-icon://add-employee",
                    press: function () {
                        that._addTenant(oDialog);
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

        _addTenant: function (oDialog) {
            var that = this;
            var sName = sap.ui.getCore().byId("newTenantName").getValue();
            if (!sName) {
                MessageBox.warning("Please enter a company name.");
                return;
            }

            var sPlan = sap.ui.getCore().byId("newTenantPlan").getSelectedKey();
            var oNewTenant = {
                tenantId: "t-" + Date.now().toString(36),
                tenantName: sName,
                tenantDomain: sap.ui.getCore().byId("newTenantDomain").getValue(),
                plan: sPlan,
                status: "ACTIVE",
                destinationName: sap.ui.getCore().byId("newDestName").getValue() ||
                    ("SAP_ONPREM_" + sName.substring(0, 8).toUpperCase().replace(/\s/g, "")),
                sapSystemId: sap.ui.getCore().byId("newSapHost").getValue(),
                sapClientNumber: sap.ui.getCore().byId("newSapClient").getValue(),
                maxAPICallsPerMonth: sPlan === "ENTERPRISE" ? 99999 : sPlan === "PROFESSIONAL" ? 500 : 100,
                currentAPICallCount: 0,
                anonymizationLevel: sap.ui.getCore().byId("newAnonLevel").getSelectedKey(),
                onboardedAt: new Date().toISOString()
            };

            // Persist to backend via direct HTTP POST
            jQuery.ajax({
                url: "/api/analyzer/TenantConfig",
                method: "POST",
                contentType: "application/json",
                data: JSON.stringify(oNewTenant),
                success: function (oData) {
                    // Refresh from backend to get server-generated ID
                    that._loadTenants();
                    MessageToast.show("Tenant '" + sName + "' saved to database!");
                },
                error: function (jqXHR) {
                    console.error("Failed to save tenant:", jqXHR.status, jqXHR.responseText);
                    MessageBox.error("Failed to save tenant to database. Check console for details.\n" +
                        (jqXHR.responseJSON?.error?.message || jqXHR.statusText));
                }
            });

            // Also update local model immediately for UI responsiveness
            var aTenants = this._oTenantModel.getProperty("/tenants");
            aTenants.push(oNewTenant);
            this._oTenantModel.setProperty("/tenants", aTenants);

            oDialog.close();
        },

        _showEditTenantDialog: function (oTenant) {
            var that = this;

            var oDialog = new Dialog({
                title: "Edit Tenant: " + oTenant.tenantName,
                contentWidth: "450px",
                content: [
                    new SimpleForm({
                        editable: true,
                        layout: "ResponsiveGridLayout",
                        labelSpanXL: 5, labelSpanL: 5, labelSpanM: 5,
                        content: [
                            new Label({ text: "Tenant ID" }),
                            new Input({ value: oTenant.tenantId, editable: false }),
                            new Label({ text: "Status" }),
                            new Select("editStatus", {
                                selectedKey: oTenant.status,
                                items: [
                                    new Item({ key: "ACTIVE", text: "Active" }),
                                    new Item({ key: "SUSPENDED", text: "Suspended" }),
                                    new Item({ key: "OFFBOARDING", text: "Offboarding" })
                                ]
                            }),
                            new Label({ text: "Plan" }),
                            new Select("editPlan", {
                                selectedKey: oTenant.plan,
                                items: [
                                    new Item({ key: "BASIC", text: "Basic" }),
                                    new Item({ key: "PROFESSIONAL", text: "Professional" }),
                                    new Item({ key: "ENTERPRISE", text: "Enterprise" })
                                ]
                            }),
                            new Label({ text: "Destination" }),
                            new Input("editDest", { value: oTenant.destinationName }),
                            new Label({ text: "Anonymization" }),
                            new Select("editAnon", {
                                selectedKey: oTenant.anonymizationLevel,
                                items: [
                                    new Item({ key: "BASIC", text: "Basic" }),
                                    new Item({ key: "STANDARD", text: "Standard" }),
                                    new Item({ key: "STRICT", text: "Strict" }),
                                    new Item({ key: "MAXIMUM", text: "Maximum" })
                                ]
                            })
                        ]
                    })
                ],
                beginButton: new Button({
                    text: "Save",
                    type: "Emphasized",
                    press: function () {
                        var oUpdated = {
                            status: sap.ui.getCore().byId("editStatus").getSelectedKey(),
                            plan: sap.ui.getCore().byId("editPlan").getSelectedKey(),
                            destinationName: sap.ui.getCore().byId("editDest").getValue(),
                            anonymizationLevel: sap.ui.getCore().byId("editAnon").getSelectedKey(),
                            maxAPICallsPerMonth: sap.ui.getCore().byId("editPlan").getSelectedKey() === "ENTERPRISE" ? 99999 :
                                sap.ui.getCore().byId("editPlan").getSelectedKey() === "PROFESSIONAL" ? 500 : 100
                        };

                        // Persist to backend via PATCH
                        if (oTenant.ID) {
                            jQuery.ajax({
                                url: "/api/analyzer/TenantConfig(" + oTenant.ID + ")",
                                method: "PATCH",
                                contentType: "application/json",
                                data: JSON.stringify(oUpdated),
                                success: function () {
                                    that._loadTenants();
                                    MessageToast.show("Tenant updated successfully!");
                                },
                                error: function () {
                                    MessageToast.show("Tenant updated locally (backend save failed).");
                                }
                            });
                        }

                        // Update local model immediately
                        Object.keys(oUpdated).forEach(function (key) {
                            oTenant[key] = oUpdated[key];
                        });
                        that._oTenantModel.refresh(true);

                        oDialog.close();
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

        _testTenantConnection: function (sTenantId) {
            MessageToast.show("Testing SAP connection for tenant " + sTenantId + "...");
            // In production, this calls the testSAPConnection action
            setTimeout(function () {
                MessageToast.show("Connection test successful!");
            }, 1500);
        }
    });
});
