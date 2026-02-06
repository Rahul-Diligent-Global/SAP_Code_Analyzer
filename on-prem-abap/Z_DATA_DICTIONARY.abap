*&---------------------------------------------------------------------*
*& ABAP Data Dictionary Objects Required
*& Create these in SE11 before activating the RFCs
*&---------------------------------------------------------------------*

*-----------------------------------------------------------------------
* Structure: ZSMCP_CUSTOM_OBJECT
* Used by: Z_MCP_GET_CUSTOM_OBJECTS (ET_OBJECTS parameter)
*-----------------------------------------------------------------------
* Field Name       | Data Element    | Type     | Length | Description
*-----------------------------------------------------------------------
* OBJECT_NAME      | SOBJ_NAME       | CHAR     | 120    | Object Name
* OBJECT_TYPE      | TROBJTYPE       | CHAR     | 4      | Object Type (PROG/CLAS/FUGR)
* OBJECT_TYPE_TEXT  | STRING          | STRING   |        | Readable Type Description
* CATEGORY         | CHAR30          | CHAR     | 30     | Category Key
* SUB_TYPE         | SUBC            | CHAR     | 1      | Program Sub-type
* PACKAGE          | DEVCLASS        | CHAR     | 30     | Development Package
* CREATED_BY       | XUBNAME         | CHAR     | 12     | Created By
* CREATED_ON       | SYDATUM         | DATS     | 8      | Created On
* CHANGED_BY       | XUBNAME         | CHAR     | 12     | Changed By
* CHANGED_ON       | SYDATUM         | DATS     | 8      | Changed On
*-----------------------------------------------------------------------

*-----------------------------------------------------------------------
* Structure: ZSMCP_SOURCE_LINE
* Used by: Z_MCP_GET_SOURCE_CODE (ET_SOURCE_CODE parameter)
*-----------------------------------------------------------------------
* Field Name       | Data Element    | Type     | Length | Description
*-----------------------------------------------------------------------
* LINE_NUMBER      | I               | INT4     | 10     | Line Number
* SOURCE_LINE      | STRING          | STRING   |        | Source Code Line
* INCLUDE_NAME     | SOBJ_NAME       | CHAR     | 120    | Include/Component Name
* SECTION          | STRING          | STRING   |        | Section (MAIN/INCLUDE/METHOD:xxx)
*-----------------------------------------------------------------------

*-----------------------------------------------------------------------
* Structure: ZSMCP_INCLUDE_INFO
* Used by: Z_MCP_GET_SOURCE_CODE (ET_INCLUDES parameter)
*-----------------------------------------------------------------------
* Field Name       | Data Element    | Type     | Length | Description
*-----------------------------------------------------------------------
* INCLUDE_NAME     | SOBJ_NAME       | CHAR     | 120    | Include Name
* INCLUDE_TYPE     | STRING          | STRING   |        | Type (INCLUDE/METHOD/FM)
* PARENT_OBJECT    | SOBJ_NAME       | CHAR     | 120    | Parent Object Name
* LINE_COUNT       | I               | INT4     | 10     | Number of Lines
*-----------------------------------------------------------------------

*-----------------------------------------------------------------------
* Table Type: Z_TT_CUSTOM_OBJECTS
* Line Type: ZSMCP_CUSTOM_OBJECT
*-----------------------------------------------------------------------

