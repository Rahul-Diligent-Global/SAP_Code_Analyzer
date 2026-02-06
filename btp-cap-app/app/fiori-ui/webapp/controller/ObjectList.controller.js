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

