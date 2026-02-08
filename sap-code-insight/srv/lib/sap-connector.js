/**
 * SAP On-Premise Connector (Multi-Tenant Aware)
 *
 * Each tenant has their OWN SAP system + destination.
 * The destination name is resolved from TenantConfig.destinationName
 * which is set during tenant onboarding via SaaS Admin Service.
 *
 * Flow:
 *   Request comes in with JWT containing tenantId (zid claim)
 *   -> Lookup TenantConfig.destinationName for that tenant
 *   -> Call RFC via that tenant-specific BTP Destination
 *   -> Cloud Connector routes to tenant's SAP system
 *
 * Single-tenant fallback: uses SAP_DESTINATION env variable
 */

const cds = require('@sap/cds');
const LOG = cds.log('sap-connector');

class SAPConnector {

    /**
     * Create connector for a specific tenant
     * @param {string} tenantId - optional, for multi-tenant mode
     */
    constructor(tenantId) {
        this.tenantId = tenantId;
        this._destinationName = null; // resolved lazily
    }

    /**
     * Resolve the correct BTP destination for the current tenant
     * Multi-tenant: reads from TenantConfig DB table
     * Single-tenant: falls back to SAP_DESTINATION env variable
     */
    async getDestinationName() {
        if (this._destinationName) return this._destinationName;

        // Multi-tenant: look up tenant-specific destination
        if (this.tenantId) {
            try {
                const db = await cds.connect.to('db');
                const { TenantConfig } = db.entities('abap.analyzer');
                const config = await db.run(
                    SELECT.one.from(TenantConfig)
                        .columns('destinationName')
                        .where({ tenantId: this.tenantId })
                );

                if (config && config.destinationName) {
                    this._destinationName = config.destinationName;
                    LOG.info(`Tenant ${this.tenantId} -> destination: ${this._destinationName}`);
                    return this._destinationName;
                }

                LOG.warn(`No destination configured for tenant ${this.tenantId}, falling back to env`);
            } catch (err) {
                LOG.warn(`Could not resolve tenant destination: ${err.message}, using fallback`);
            }
        }

        // Single-tenant fallback
        this._destinationName = process.env.SAP_DESTINATION || 'S2A';
        return this._destinationName;
    }

    /**
     * Check if running in mock mode (local dev without SAP system)
     */
    get isMockMode() {
        return process.env.MOCK_SAP_DATA === 'true' ||
               (!process.env.SAP_DESTINATION && !this.tenantId && process.env.CDS_ENV === 'development');
    }

    /**
     * Call RFC Z_MCP_GET_CUSTOM_OBJECTS
     */
    async getCustomObjects(params) {
        const { ivObjectType = 'ALL', ivNamespace = 'Z', ivMaxRows = 500 } = params;

        if (this.isMockMode) {
            LOG.info('MOCK MODE: Returning sample ABAP objects');
            return this._getMockObjects(ivObjectType, ivNamespace);
        }

        const destName = await this.getDestinationName();
        LOG.info(`Calling Z_MCP_GET_CUSTOM_OBJECTS via ${destName}: type=${ivObjectType}, ns=${ivNamespace}`);

        return await this._callRFC(destName, 'Z_MCP_GET_CUSTOM_OBJECTS', {
            IV_OBJECT_TYPE: ivObjectType,
            IV_NAMESPACE: ivNamespace,
            IV_MAX_ROWS: ivMaxRows
        }, this._mapObjectsResult);
    }

    /**
     * Call RFC Z_MCP_GET_SOURCE_CODE
     */
    async getSourceCode(objectName, category) {
        if (this.isMockMode) {
            LOG.info(`MOCK MODE: Returning sample source for ${objectName}`);
            return this._getMockSourceCode(objectName, category);
        }

        const destName = await this.getDestinationName();
        LOG.info(`Calling Z_MCP_GET_SOURCE_CODE via ${destName}: name=${objectName}, cat=${category}`);

        return await this._callRFC(destName, 'Z_MCP_GET_SOURCE_CODE', {
            IV_OBJECT_NAME: objectName,
            IV_CATEGORY: category
        }, this._mapSourceCodeResult);
    }

    /**
     * Fetch CSRF token from SAP using GET on /sap/bc/ping
     *
     * The SAP Cloud SDK's built-in CSRF middleware uses HEAD on the same
     * URL as the request, but SOAP/RFC endpoints reject HEAD with 403.
     * Instead, we fetch the token from /sap/bc/ping which supports GET.
     */
    async _fetchCsrfToken(destination) {
        const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

        try {
            const response = await executeHttpRequest(
                destination,
                {
                    method: 'GET',
                    url: '/sap/bc/ping',
                    headers: {
                        'X-CSRF-Token': 'Fetch'
                    }
                },
                { fetchCsrfToken: false }
            );

            const token = response.headers['x-csrf-token'];
            const cookies = response.headers['set-cookie'];
            const cookieStr = Array.isArray(cookies)
                ? cookies.map(c => c.split(';')[0]).join('; ')
                : '';

            if (token) {
                LOG.info('CSRF token fetched successfully from /sap/bc/ping');
            }
            return { token: token || null, cookies: cookieStr };

        } catch (err) {
            LOG.warn(`CSRF token fetch from /sap/bc/ping failed: ${err.message}`);
            return { token: null, cookies: '' };
        }
    }

    /**
     * Call RFC via SOAP over HTTP through BTP Destination + Cloud Connector
     *
     * CSRF handling:
     * - The SDK's built-in CSRF middleware is DISABLED (fetchCsrfToken: false)
     *   because it sends HEAD to the SOAP URL which returns 403
     * - Instead, we manually fetch the CSRF token from /sap/bc/ping (GET)
     *   and include it in the SOAP POST headers
     */
    async _callRFC(destinationName, functionName, params, mapFn) {
        const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
        const { getDestination } = require('@sap-cloud-sdk/connectivity');

        const destination = await getDestination({ destinationName });

        if (!destination) {
            throw new Error(
                `Destination '${destinationName}' not found. ` +
                (this.tenantId
                    ? 'Tenant admin must configure SAP connection via Admin UI.'
                    : 'Configure SAP_DESTINATION env variable or create destination in BTP.')
            );
        }

        // Step 1: Fetch CSRF token from /sap/bc/ping (supports GET)
        const csrf = await this._fetchCsrfToken(destination);

        const rfcUrl = `/sap/bc/srt/rfc/sap/${functionName.toLowerCase()}/`;
        const soapBody = this._buildSOAPEnvelope(functionName, params);

        // Step 2: Build headers with CSRF token + session cookies
        const headers = {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': `urn:sap-com:document:sap:rfc:functions:${functionName}`
        };
        if (csrf.token) {
            headers['X-CSRF-Token'] = csrf.token;
        }
        if (csrf.cookies) {
            headers['Cookie'] = csrf.cookies;
        }

        // Step 3: Execute SOAP POST with SDK CSRF middleware disabled
        const response = await executeHttpRequest(
            destination,
            {
                method: 'POST',
                url: rfcUrl,
                headers,
                data: soapBody
            },
            {
                fetchCsrfToken: false
            }
        );

        if (response.status !== 200) {
            throw new Error(`RFC ${functionName} failed (HTTP ${response.status})`);
        }

        const parsed = await this._parseSOAPResponse(functionName, response.data);
        return mapFn ? mapFn(parsed) : parsed;
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
     * Parse SOAP response
     */
    _parseSOAPResponse(functionName, xmlData) {
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
     * Map RFC result -> normalized custom objects
     */
    _mapObjectsResult(result) {
        const rawObjects = result.EtObjects || result.ET_OBJECTS || [];
        const items = Array.isArray(rawObjects) ? rawObjects : [rawObjects];

        const objects = items
            .filter(obj => obj)
            .map(obj => ({
                objectName: obj.ObjectName || obj.OBJECT_NAME,
                objectType: obj.ObjectType || obj.OBJECT_TYPE,
                objectTypeText: obj.ObjectTypeText || obj.OBJECT_TYPE_TEXT,
                category: obj.Category || obj.CATEGORY,
                subType: obj.SubType || obj.SUB_TYPE,
                package: obj.Package || obj.PACKAGE,
                createdBy: obj.CreatedBy || obj.CREATED_BY,
                createdOn: obj.CreatedOn || obj.CREATED_ON
            }));

        return {
            evTotalCount: result.EvTotalCount || result.EV_TOTAL_COUNT || objects.length,
            etObjects: objects
        };
    }

    /**
     * Map RFC result -> normalized source code
     */
    _mapSourceCodeResult(result) {
        const rawLines = result.EtSourceCode || result.ET_SOURCE_CODE || [];
        const items = Array.isArray(rawLines) ? rawLines : [rawLines];

        const sourceLines = items
            .filter(line => line)
            .map(line => ({
                lineNumber: parseInt(line.LineNumber || line.LINE_NUMBER || 0),
                sourceLine: line.SourceLine || line.SOURCE_LINE || '',
                includeName: line.IncludeName || line.INCLUDE_NAME || '',
                section: line.Section || line.SECTION || ''
            }));

        const rawIncludes = result.EtIncludes || result.ET_INCLUDES || [];
        const includes = (Array.isArray(rawIncludes) ? rawIncludes : [rawIncludes])
            .filter(inc => inc)
            .map(inc => ({
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

    // ═══════════════════════════════════════════════════════════════
    // MOCK DATA (for local development without SAP system)
    // ═══════════════════════════════════════════════════════════════

    _getMockObjects(objectType, namespace) {
        const mockData = [
            { objectName: 'ZSALES_ORDER_PROC', objectType: 'PROG', objectTypeText: 'Program', category: 'PROGRAM', subType: '1', package: 'ZSALES', createdBy: 'DEVELOPER1', createdOn: '2024-01-15' },
            { objectName: 'ZCL_MATERIAL_HELPER', objectType: 'CLAS', objectTypeText: 'Class', category: 'CLASS', subType: '', package: 'ZMATERIAL', createdBy: 'DEVELOPER2', createdOn: '2024-02-20' },
            { objectName: 'ZFM_GET_CUSTOMER', objectType: 'FUGR', objectTypeText: 'Function Group', category: 'FUNCTION', subType: '', package: 'ZCUSTOMER', createdBy: 'DEVELOPER1', createdOn: '2024-03-10' },
            { objectName: 'ZBADI_ORDER_CHECK', objectType: 'BADI', objectTypeText: 'BAdI Implementation', category: 'BADI', subType: '', package: 'ZSALES', createdBy: 'DEVELOPER3', createdOn: '2024-04-05' },
            { objectName: 'ZINVOICE_REPORT', objectType: 'PROG', objectTypeText: 'Program', category: 'PROGRAM', subType: '1', package: 'ZFINANCE', createdBy: 'DEVELOPER2', createdOn: '2024-05-12' },
            { objectName: 'ZCL_API_GATEWAY', objectType: 'CLAS', objectTypeText: 'Class', category: 'CLASS', subType: '', package: 'ZINTEGRATION', createdBy: 'DEVELOPER1', createdOn: '2024-06-01' },
            { objectName: 'ZFM_CALC_PRICING', objectType: 'FUGR', objectTypeText: 'Function Group', category: 'FUNCTION', subType: '', package: 'ZSALES', createdBy: 'DEVELOPER3', createdOn: '2024-06-15' },
            { objectName: 'ZDELIVERY_MONITOR', objectType: 'PROG', objectTypeText: 'Program', category: 'PROGRAM', subType: '1', package: 'ZLOGISTICS', createdBy: 'DEVELOPER2', createdOn: '2024-07-20' },
        ];

        let filtered = mockData;
        if (objectType !== 'ALL') {
            filtered = mockData.filter(o => o.objectType === objectType);
        }

        return {
            evTotalCount: filtered.length,
            etObjects: filtered
        };
    }

    _getMockSourceCode(objectName, category) {
        const mockCode = `REPORT ${objectName}.
*&---------------------------------------------------------------------*
*& Report ${objectName}
*& Sample mock code for local development testing
*&---------------------------------------------------------------------*

DATA: lv_count   TYPE i,
      lt_data    TYPE TABLE OF string,
      lv_message TYPE string.

START-OF-SELECTION.

  WRITE: / 'Starting processing for:', '${objectName}'.

  PERFORM get_data CHANGING lt_data.
  PERFORM process_data USING lt_data CHANGING lv_count.

  lv_message = |Processed { lv_count } records successfully.|.
  WRITE: / lv_message.

*&---------------------------------------------------------------------*
FORM get_data CHANGING ct_data TYPE TABLE.
  " Fetch data from database
  SELECT * FROM mara INTO TABLE @DATA(lt_mara)
    WHERE matnr LIKE 'Z%'
    ORDER BY matnr.

  LOOP AT lt_mara INTO DATA(ls_mara).
    APPEND ls_mara-matnr TO ct_data.
  ENDLOOP.
ENDFORM.

*&---------------------------------------------------------------------*
FORM process_data USING it_data TYPE TABLE
                  CHANGING cv_count TYPE i.
  LOOP AT it_data INTO DATA(lv_entry).
    cv_count = cv_count + 1.
    WRITE: / 'Processing:', lv_entry.
  ENDLOOP.
ENDFORM.`;

        const lines = mockCode.split('\n');
        return {
            evTitle: `Report: ${objectName}`,
            evObjectType: category || 'PROG',
            evPackage: 'ZLOCAL',
            evAuthor: 'DEVELOPER1',
            evCreatedOn: '2024-01-15',
            etSourceCode: lines.map((line, idx) => ({
                lineNumber: idx + 1,
                sourceLine: line,
                includeName: objectName,
                section: 'MAIN'
            })),
            etIncludes: [{
                includeName: objectName,
                includeType: 'MAIN',
                parentObject: objectName,
                lineCount: lines.length
            }]
        };
    }
}

module.exports = SAPConnector;
