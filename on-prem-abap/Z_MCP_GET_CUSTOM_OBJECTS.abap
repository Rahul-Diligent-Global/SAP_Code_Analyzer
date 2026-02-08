*&---------------------------------------------------------------------*
*& RFC Function Module: Z_MCP_GET_CUSTOM_OBJECTS
*& Description: Returns all custom ABAP objects from the SAP system
*&              Supports Programs, Reports, Classes, BADIs, FMs, Enhancements
*&---------------------------------------------------------------------*
*& Must be RFC-enabled in SE37
*& Import Parameters:
*&   IV_OBJECT_TYPE  TYPE CHAR20  (optional: PROG/CLAS/FUGR/BADI/ENHO/ALL)
*&   IV_NAMESPACE    TYPE CHAR10  (optional: Z/Y/ZZ - default Z*)
*&   IV_MAX_ROWS     TYPE I       (optional: default 500)
*& Export Parameters:
*&   EV_TOTAL_COUNT  TYPE I
*& Tables Parameters:
*&   ET_OBJECTS      TYPE Z_TT_CUSTOM_OBJECTS
*&---------------------------------------------------------------------*

FUNCTION z_mcp_get_custom_objects.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_OBJECT_TYPE) TYPE  CHAR20 DEFAULT 'ALL'
*"     VALUE(IV_NAMESPACE) TYPE  CHAR10 DEFAULT 'Z'
*"     VALUE(IV_MAX_ROWS) TYPE  I DEFAULT 500
*"  EXPORTING
*"     VALUE(EV_TOTAL_COUNT) TYPE  I
*"  TABLES
*"     ET_OBJECTS STRUCTURE  ZSMCP_CUSTOM_OBJECT
*"----------------------------------------------------------------------

  DATA: lt_objects TYPE TABLE OF zsmcp_custom_object,
        ls_object  TYPE zsmcp_custom_object,
        lv_prefix  TYPE char50.

  lv_prefix = iv_namespace && '%'.

  CLEAR: et_objects[], ev_total_count.

*-----------------------------------------------------------------------
* 1. Fetch Custom Programs / Reports (TADIR + TRDIR)
*-----------------------------------------------------------------------
  IF iv_object_type = 'ALL' OR iv_object_type = 'PROG'.
    SELECT t~obj_name AS object_name,
           t~object   AS object_type,
           t~devclass AS package,
           t~author   AS created_by,
           r~subc     AS sub_type,
           t~created_on AS created_on
      FROM tadir AS t
      INNER JOIN trdir AS r ON r~name = t~obj_name
      INTO CORRESPONDING FIELDS OF TABLE @lt_objects
      WHERE t~pgmid    = 'R3TR'
        AND t~object   = 'PROG'
        AND t~obj_name LIKE @lv_prefix
      UP TO @iv_max_rows ROWS.

    LOOP AT lt_objects INTO ls_object.
      CASE ls_object-sub_type.
        WHEN '1'.
          ls_object-object_type_text = 'Executable Program (Report)'.
          ls_object-category = 'REPORT'.
        WHEN 'I'.
          ls_object-object_type_text = 'Include Program'.
          ls_object-category = 'INCLUDE'.
        WHEN 'M'.
          ls_object-object_type_text = 'Module Pool'.
          ls_object-category = 'MODULE_POOL'.
        WHEN 'S'.
          ls_object-object_type_text = 'Subroutine Pool'.
          ls_object-category = 'SUBROUTINE'.
        WHEN OTHERS.
          ls_object-object_type_text = 'Program'.
          ls_object-category = 'PROGRAM'.
      ENDCASE.
      APPEND ls_object TO et_objects.
    ENDLOOP.
  ENDIF.

*-----------------------------------------------------------------------
* 2. Fetch Custom Classes (TADIR + SEOCLASS)
*-----------------------------------------------------------------------
  IF iv_object_type = 'ALL' OR iv_object_type = 'CLAS'.
    CLEAR lt_objects.
    SELECT t~obj_name  AS object_name,
           t~object    AS object_type,
           t~devclass  AS package,
           t~author    AS created_by,
           t~created_on AS created_on
      FROM tadir AS t
      INNER JOIN seoclass AS c ON c~clsname = t~obj_name
      INTO CORRESPONDING FIELDS OF TABLE @lt_objects
      WHERE t~pgmid    = 'R3TR'
        AND t~object   = 'CLAS'
        AND t~obj_name LIKE @lv_prefix
      UP TO @iv_max_rows ROWS.

    LOOP AT lt_objects INTO ls_object.
      ls_object-object_type_text = 'ABAP Class'.
      ls_object-category = 'CLASS'.
      APPEND ls_object TO et_objects.
    ENDLOOP.
  ENDIF.

*-----------------------------------------------------------------------
* 3. Fetch Custom Function Modules (TADIR + TFDIR + ENLFDIR)
*-----------------------------------------------------------------------
  IF iv_object_type = 'ALL' OR iv_object_type = 'FUGR'.
    CLEAR lt_objects.
    SELECT t~obj_name  AS object_name,
           'FUNC'      AS object_type,
           t~devclass  AS package,
           t~author    AS created_by,
           t~created_on AS created_on
      FROM tadir AS t
      WHERE t~pgmid    = 'R3TR'
        AND t~object   = 'FUGR'
        AND t~obj_name LIKE @lv_prefix
      INTO CORRESPONDING FIELDS OF TABLE @lt_objects
      UP TO @iv_max_rows ROWS.

    LOOP AT lt_objects INTO ls_object.
      ls_object-object_type_text = 'Function Group'.
      ls_object-category = 'FUNCTION_GROUP'.
      APPEND ls_object TO et_objects.
    ENDLOOP.

    " Also get individual Function Modules
    CLEAR lt_objects.
    SELECT f~funcname  AS object_name,
           'FUNC'      AS object_type,
           e~area      AS package,
           t~author    AS created_by,
           t~created_on AS created_on
      FROM tfdir AS f
      INNER JOIN enlfdir AS e ON e~funcname = f~funcname
      INNER JOIN tadir AS t ON t~obj_name = e~area
                           AND t~object = 'FUGR'
      WHERE f~funcname LIKE @lv_prefix
      INTO CORRESPONDING FIELDS OF TABLE @lt_objects
      UP TO @iv_max_rows ROWS.

    LOOP AT lt_objects INTO ls_object.
      ls_object-object_type_text = 'Function Module'.
      ls_object-category = 'FUNCTION_MODULE'.
      APPEND ls_object TO et_objects.
    ENDLOOP.
  ENDIF.

*-----------------------------------------------------------------------
* 4. Fetch Custom BADIs (SXS_ATTRT)
*-----------------------------------------------------------------------
  IF iv_object_type = 'ALL' OR iv_object_type = 'BADI'.
    CLEAR lt_objects.
    SELECT s~exit_name AS object_name,
           'BADI'      AS object_type,
           s~text       AS object_type_text
      FROM sxs_attrt AS s
      WHERE s~exit_name LIKE @lv_prefix
        AND s~sprsl = @sy-langu
      INTO CORRESPONDING FIELDS OF TABLE @lt_objects
      UP TO @iv_max_rows ROWS.

    LOOP AT lt_objects INTO ls_object.
      ls_object-category = 'BADI'.
      APPEND ls_object TO et_objects.
    ENDLOOP.

    " New BADIs (Enhancement Spot based)
    CLEAR lt_objects.
    SELECT b~exit_name AS object_name,
           'BADI2'     AS object_type
      FROM sxc_exit AS b
      WHERE b~exit_name LIKE @lv_prefix
      INTO CORRESPONDING FIELDS OF TABLE @lt_objects
      UP TO @iv_max_rows ROWS.

    LOOP AT lt_objects INTO ls_object.
      ls_object-object_type_text = 'New BAdI (Enhancement Spot)'.
      ls_object-category = 'BADI_NEW'.
      APPEND ls_object TO et_objects.
    ENDLOOP.
  ENDIF.

*-----------------------------------------------------------------------
* 5. Fetch Enhancements / Enhancement Implementations
*-----------------------------------------------------------------------
  IF iv_object_type = 'ALL' OR iv_object_type = 'ENHO'.
    CLEAR lt_objects.
    SELECT t~obj_name  AS object_name,
           t~object    AS object_type,
           t~devclass  AS package,
           t~author    AS created_by,
           t~created_on AS created_on
      FROM tadir AS t
      WHERE t~pgmid    = 'R3TR'
        AND t~object   IN ('ENHO', 'ENHS')
        AND t~obj_name LIKE @lv_prefix
      INTO CORRESPONDING FIELDS OF TABLE @lt_objects
      UP TO @iv_max_rows ROWS.

    LOOP AT lt_objects INTO ls_object.
      IF ls_object-object_type = 'ENHO'.
        ls_object-object_type_text = 'Enhancement Implementation'.
        ls_object-category = 'ENHANCEMENT_IMPL'.
      ELSE.
        ls_object-object_type_text = 'Enhancement Spot'.
        ls_object-category = 'ENHANCEMENT_SPOT'.
      ENDIF.
      APPEND ls_object TO et_objects.
    ENDLOOP.
  ENDIF.

*-----------------------------------------------------------------------
* Count total
*-----------------------------------------------------------------------
  ev_total_count = lines( et_objects ).

ENDFUNCTION.

