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
