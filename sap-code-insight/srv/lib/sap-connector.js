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

