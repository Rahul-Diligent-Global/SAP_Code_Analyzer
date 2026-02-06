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

