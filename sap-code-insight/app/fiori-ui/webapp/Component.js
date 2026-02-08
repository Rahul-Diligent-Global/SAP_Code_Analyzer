sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
    "sap/ui/Device"
], function (UIComponent, JSONModel, Device) {
    "use strict";

    return UIComponent.extend("com.sap.codeinsight.Component", {

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
                searchQuery: "",
                objectCount: 0,
                isAdmin: false
            });
            this.setModel(oViewModel, "viewModel");

            // Pre-fetch CSRF token from Application Router
            // This ensures the OData V4 model has a valid token before first POST
            this._prefetchCSRFToken();

            // Initialize routing
            this.getRouter().initialize();
        },

        /**
         * Pre-fetch CSRF token from the Application Router.
         * The SAP Application Router validates CSRF tokens on all
         * state-changing requests (POST/PUT/DELETE/PATCH).
         * OData V4 model handles token refresh automatically after this
         * initial fetch primes the session.
         */
        _prefetchCSRFToken: function () {
            var sServiceUrl = this.getManifestEntry("/sap.app/dataSources/mainService/uri") || "/api/analyzer/";

            jQuery.ajax({
                url: sServiceUrl,
                type: "HEAD",
                headers: {
                    "X-CSRF-Token": "Fetch"
                },
                success: function (data, textStatus, jqXHR) {
                    var sToken = jqXHR.getResponseHeader("X-CSRF-Token");
                    if (sToken) {
                        // Store token for any manual AJAX calls
                        jQuery.ajaxSetup({
                            headers: {
                                "X-CSRF-Token": sToken
                            }
                        });
                    }
                },
                error: function () {
                    // Token fetch failed - OData model will retry on first POST
                    jQuery.sap.log.warning("CSRF token pre-fetch failed. Will retry on first action call.");
                }
            });
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

