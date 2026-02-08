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
     * Call RFC Z_MCP_GET_CUSTOM_OBJECTS
     */
    async getCustomObjects(params) {
        const { ivObjectType = 'ALL', ivNamespace = 'Z', ivMaxRows = 500 } = params;
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
        const destName = await this.getDestinationName();

        LOG.info(`Calling Z_MCP_GET_SOURCE_CODE via ${destName}: name=${objectName}, cat=${category}`);

        return await this._callRFC(destName, 'Z_MCP_GET_SOURCE_CODE', {
            IV_OBJECT_NAME: objectName,
            IV_CATEGORY: category
        }, this._mapSourceCodeResult);
    }

    /**
     * Call RFC via SOAP over HTTP through BTP Destination + Cloud Connector
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
}

module.exports = SAPConnector;
