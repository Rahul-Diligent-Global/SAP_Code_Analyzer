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

