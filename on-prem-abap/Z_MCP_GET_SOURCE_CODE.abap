*&---------------------------------------------------------------------*
*& RFC Function Module: Z_MCP_GET_SOURCE_CODE
*& Description: Returns the complete source code of any ABAP object
*&              Including all includes, methods, and sub-components
*&---------------------------------------------------------------------*
*& Must be RFC-enabled in SE37
*&---------------------------------------------------------------------*

FUNCTION z_mcp_get_source_code.
*"----------------------------------------------------------------------
*"*"Local Interface:
*"  IMPORTING
*"     VALUE(IV_OBJECT_NAME) TYPE  SOBJ_NAME
*"     VALUE(IV_CATEGORY) TYPE  CHAR30
*"  EXPORTING
*"     VALUE(EV_TITLE) TYPE  STRING
*"     VALUE(EV_OBJECT_TYPE) TYPE  STRING
*"     VALUE(EV_PACKAGE) TYPE  DEVCLASS
*"     VALUE(EV_AUTHOR) TYPE  XUBNAME
*"     VALUE(EV_CREATED_ON) TYPE  SYDATUM
*"     VALUE(EV_CHANGED_BY) TYPE  XUBNAME
*"     VALUE(EV_CHANGED_ON) TYPE  SYDATUM
*"  TABLES
*"     ET_SOURCE_CODE STRUCTURE  ZSMCP_SOURCE_LINE
*"     ET_INCLUDES STRUCTURE  ZSMCP_INCLUDE_INFO
*"----------------------------------------------------------------------

  DATA: lt_source    TYPE TABLE OF string,
        lv_src_line  TYPE string,
        ls_source    TYPE zsmcp_source_line,
        ls_include   TYPE zsmcp_include_info,
        lv_progname  TYPE syrepid,
        lv_line_num  TYPE i,
        lt_methods   TYPE seop_methods_w_include,
        ls_method    TYPE seop_method_w_include,
        lt_incl      TYPE TABLE OF sobj_name.

  CLEAR: et_source_code[], et_includes[].

*-----------------------------------------------------------------------
* Get metadata from TADIR
*-----------------------------------------------------------------------
  SELECT SINGLE devclass, author, created_on
    FROM tadir
    INTO (@ev_package, @ev_author, @ev_created_on)
    WHERE obj_name = @iv_object_name
      AND pgmid    = 'R3TR'.

*-----------------------------------------------------------------------
* Handle based on category
*-----------------------------------------------------------------------
  CASE iv_category.

*--- Programs / Reports / Includes ---
    WHEN 'PROGRAM' OR 'REPORT' OR 'INCLUDE' OR 'MODULE_POOL' OR 'SUBROUTINE'.
      lv_progname = iv_object_name.
      ev_object_type = iv_category.

      " Get program title
      SELECT SINGLE text
        FROM trdirt
        INTO @ev_title
        WHERE name  = @lv_progname
          AND sprsl = @sy-langu.

      " Read main source
      READ REPORT lv_progname INTO lt_source.
      IF sy-subrc = 0.
        lv_line_num = 0.
        LOOP AT lt_source INTO DATA(lv_line).
          lv_line_num = lv_line_num + 1.
          CLEAR ls_source.
          ls_source-line_number = lv_line_num.
          ls_source-source_line = lv_line.
          ls_source-include_name = lv_progname.
          ls_source-section = 'MAIN'.
          APPEND ls_source TO et_source_code.

          " Detect INCLUDEs
          IF lv_line CP 'INCLUDE *'.
            DATA(lv_incl_name) = lv_line.
            REPLACE 'INCLUDE' IN lv_incl_name WITH ''.
            REPLACE '.' IN lv_incl_name WITH ''.
            CONDENSE lv_incl_name.
            IF lv_incl_name IS NOT INITIAL.
              CLEAR ls_include.
              ls_include-include_name = lv_incl_name.
              ls_include-include_type = 'INCLUDE'.
              ls_include-parent_object = iv_object_name.
              APPEND ls_include TO et_includes.
            ENDIF.
          ENDIF.
        ENDLOOP.
      ENDIF.

      " Read all detected includes
      LOOP AT et_includes INTO ls_include.
        CLEAR lt_source.
        READ REPORT ls_include-include_name INTO lt_source.
        IF sy-subrc = 0.
          lv_line_num = 0.
          ls_include-line_count = lines( lt_source ).
          MODIFY et_includes FROM ls_include.

          LOOP AT lt_source INTO lv_line.
            lv_line_num = lv_line_num + 1.
            CLEAR ls_source.
            ls_source-line_number = lv_line_num.
            ls_source-source_line = lv_line.
            ls_source-include_name = ls_include-include_name.
            ls_source-section = 'INCLUDE'.
            APPEND ls_source TO et_source_code.
          ENDLOOP.
        ENDIF.
      ENDLOOP.

*--- ABAP Classes ---
    WHEN 'CLASS'.
      ev_object_type = 'CLASS'.

      " Get class description
      SELECT SINGLE descript
        FROM seoclasstx
        INTO @ev_title
        WHERE clsname = @iv_object_name
          AND langu   = @sy-langu.

      " Get class source via class pool program name
      DATA(lv_class_prog) = |\\PROGRAM={ iv_object_name }\\CLASS={ iv_object_name }|.

      " Read class definition (public section)
      DATA(lv_cls_pool) = CONV syrepid( iv_object_name && '==============CP' ).

      " Get all includes of the class
      CALL FUNCTION 'SEO_CLASS_GET_INCLUDE_BY_NAME'
        EXPORTING
          clsname       = CONV seoclsname( iv_object_name )
        TABLES
          includes      = lt_incl
        EXCEPTIONS
          not_existing  = 1
          OTHERS        = 2.

      IF sy-subrc = 0.
        " Standard includes: CCDEF, CCIMP, CCMAC, CCAU
        DATA: lt_cls_includes TYPE TABLE OF string VALUE IS INITIAL.
        APPEND iv_object_name && '==============CCDEF' TO lt_cls_includes. " Class Definition
        APPEND iv_object_name && '==============CCIMP' TO lt_cls_includes. " Class Implementation
        APPEND iv_object_name && '==============CCMAC' TO lt_cls_includes. " Macros
        APPEND iv_object_name && '==============CCAU'  TO lt_cls_includes. " Test Classes

        LOOP AT lt_cls_includes INTO DATA(lv_cls_incl).
          CLEAR lt_source.
          DATA(lv_incl_rep) = CONV syrepid( lv_cls_incl ).
          READ REPORT lv_incl_rep INTO lt_source.
          IF sy-subrc = 0 AND lt_source IS NOT INITIAL.
            DATA(lv_section_name) = COND string(
              WHEN lv_cls_incl CS 'CCDEF' THEN 'CLASS_DEFINITION'
              WHEN lv_cls_incl CS 'CCIMP' THEN 'CLASS_IMPLEMENTATION'
              WHEN lv_cls_incl CS 'CCMAC' THEN 'MACROS'
              WHEN lv_cls_incl CS 'CCAU'  THEN 'TEST_CLASSES'
              ELSE 'OTHER'
            ).

            CLEAR ls_include.
            ls_include-include_name = lv_cls_incl.
            ls_include-include_type = lv_section_name.
            ls_include-parent_object = iv_object_name.
            ls_include-line_count = lines( lt_source ).
            APPEND ls_include TO et_includes.

            lv_line_num = 0.
            LOOP AT lt_source INTO lv_line.
              lv_line_num = lv_line_num + 1.
              CLEAR ls_source.
              ls_source-line_number = lv_line_num.
              ls_source-source_line = lv_line.
              ls_source-include_name = lv_cls_incl.
              ls_source-section = lv_section_name.
              APPEND ls_source TO et_source_code.
            ENDLOOP.
          ENDIF.
        ENDLOOP.

        " Get individual method includes
        CALL METHOD cl_oo_classname_service=>get_all_method_includes
          EXPORTING
            clsname            = CONV seoclsname( iv_object_name )
          RECEIVING
            result             = lt_methods
          EXCEPTIONS
            class_not_existing = 1.

        IF sy-subrc = 0.
          LOOP AT lt_methods INTO ls_method.
            CLEAR lt_source.
            READ REPORT ls_method-incname INTO lt_source.
            IF sy-subrc = 0 AND lt_source IS NOT INITIAL.
              CLEAR ls_include.
              ls_include-include_name = ls_method-incname.
              ls_include-include_type = |METHOD:{ ls_method-cpdname }|.
              ls_include-parent_object = iv_object_name.
              ls_include-line_count = lines( lt_source ).
              APPEND ls_include TO et_includes.

              lv_line_num = 0.
              LOOP AT lt_source INTO lv_line.
                lv_line_num = lv_line_num + 1.
                CLEAR ls_source.
                ls_source-line_number = lv_line_num.
                ls_source-source_line = lv_line.
                ls_source-include_name = ls_method-incname.
                ls_source-section = |METHOD:{ ls_method-cpdname }|.
                APPEND ls_source TO et_source_code.
              ENDLOOP.
            ENDIF.
          ENDLOOP.
        ENDIF.
      ENDIF.

*--- Function Modules ---
    WHEN 'FUNCTION_MODULE'.
      ev_object_type = 'FUNCTION_MODULE'.

      " Get FM details
      SELECT SINGLE e~area
        FROM enlfdir AS e
        INTO @DATA(lv_func_group)
        WHERE e~funcname = @iv_object_name.

      " Get FM short text
      SELECT SINGLE stext
        FROM tftit
        INTO @ev_title
        WHERE funcname = @iv_object_name
          AND spras    = @sy-langu.

      " Read function module source
      CALL FUNCTION 'FUNCTION_INCLUDE_INFO'
        IMPORTING
          include   = DATA(lv_fm_include)
        CHANGING
          funcname  = iv_object_name
        EXCEPTIONS
          OTHERS    = 1.

      IF sy-subrc = 0.
        CLEAR lt_source.
        READ REPORT lv_fm_include INTO lt_source.
        IF sy-subrc = 0.
          lv_line_num = 0.
          LOOP AT lt_source INTO lv_line.
            lv_line_num = lv_line_num + 1.
            CLEAR ls_source.
            ls_source-line_number = lv_line_num.
            ls_source-source_line = lv_line.
            ls_source-include_name = lv_fm_include.
            ls_source-section = 'FUNCTION_MODULE'.
            APPEND ls_source TO et_source_code.
          ENDLOOP.

          CLEAR ls_include.
          ls_include-include_name = lv_fm_include.
          ls_include-include_type = 'FM_INCLUDE'.
          ls_include-parent_object = iv_object_name.
          ls_include-line_count = lines( lt_source ).
          APPEND ls_include TO et_includes.
        ENDIF.
      ENDIF.

      " Also get the function group top include
      IF lv_func_group IS NOT INITIAL.
        DATA(lv_top_incl) = CONV syrepid( |L{ lv_func_group }TOP| ).
        CLEAR lt_source.
        READ REPORT lv_top_incl INTO lt_source.
        IF sy-subrc = 0 AND lt_source IS NOT INITIAL.
          CLEAR ls_include.
          ls_include-include_name = lv_top_incl.
          ls_include-include_type = 'FG_TOP_INCLUDE'.
          ls_include-parent_object = iv_object_name.
          ls_include-line_count = lines( lt_source ).
          APPEND ls_include TO et_includes.

          lv_line_num = 0.
          LOOP AT lt_source INTO lv_line.
            lv_line_num = lv_line_num + 1.
            CLEAR ls_source.
            ls_source-line_number = lv_line_num.
            ls_source-source_line = lv_line.
            ls_source-include_name = lv_top_incl.
            ls_source-section = 'FG_TOP_INCLUDE'.
            APPEND ls_source TO et_source_code.
          ENDLOOP.
        ENDIF.
      ENDIF.

*--- Function Group ---
    WHEN 'FUNCTION_GROUP'.
      ev_object_type = 'FUNCTION_GROUP'.

      " Get all function modules in the group
      SELECT funcname
        FROM enlfdir
        WHERE area = @iv_object_name
        INTO TABLE @DATA(lt_func_names).

      ev_title = |Function Group: { iv_object_name }|.

      " Read top include
      DATA(lv_fg_top) = CONV syrepid( |L{ iv_object_name }TOP| ).
      CLEAR lt_source.
      READ REPORT lv_fg_top INTO lt_source.
      IF sy-subrc = 0.
        lv_line_num = 0.
        LOOP AT lt_source INTO lv_line.
          lv_line_num = lv_line_num + 1.
          CLEAR ls_source.
          ls_source-line_number = lv_line_num.
          ls_source-source_line = lv_line.
          ls_source-include_name = lv_fg_top.
          ls_source-section = 'FG_TOP'.
          APPEND ls_source TO et_source_code.
        ENDLOOP.
      ENDIF.

      " Read each function module's source
      LOOP AT lt_func_names INTO DATA(ls_func_name).
        DATA(lv_fname) = ls_func_name-funcname.
        CALL FUNCTION 'FUNCTION_INCLUDE_INFO'
          IMPORTING
            include   = DATA(lv_fminc)
          CHANGING
            funcname  = lv_fname
          EXCEPTIONS
            OTHERS    = 1.

        IF sy-subrc = 0.
          CLEAR lt_source.
          READ REPORT lv_fminc INTO lt_source.
          IF sy-subrc = 0.
            CLEAR ls_include.
            ls_include-include_name = lv_fminc.
            ls_include-include_type = |FM:{ ls_func_name-funcname }|.
            ls_include-parent_object = iv_object_name.
            ls_include-line_count = lines( lt_source ).
            APPEND ls_include TO et_includes.

            lv_line_num = 0.
            LOOP AT lt_source INTO lv_line.
              lv_line_num = lv_line_num + 1.
              CLEAR ls_source.
              ls_source-line_number = lv_line_num.
              ls_source-source_line = lv_line.
              ls_source-include_name = lv_fminc.
              ls_source-section = |FM:{ ls_func_name-funcname }|.
              APPEND ls_source TO et_source_code.
            ENDLOOP.
          ENDIF.
        ENDIF.
      ENDLOOP.

*--- Enhancement Implementation ---
    WHEN 'ENHANCEMENT_IMPL'.
      ev_object_type = 'ENHANCEMENT'.
      ev_title = |Enhancement Implementation: { iv_object_name }|.

      " Enhancement implementations are stored as programs
      " The include name pattern: program name from TADIR
      SELECT SINGLE obj_name
        FROM tadir
        INTO @DATA(lv_enh_prog)
        WHERE obj_name = @iv_object_name
          AND object   = 'ENHO'.

      IF sy-subrc = 0.
        " Try reading as report
        CLEAR lt_source.
        READ REPORT iv_object_name INTO lt_source.
        IF sy-subrc = 0.
          lv_line_num = 0.
          LOOP AT lt_source INTO lv_line.
            lv_line_num = lv_line_num + 1.
            CLEAR ls_source.
            ls_source-line_number = lv_line_num.
            ls_source-source_line = lv_line.
            ls_source-include_name = iv_object_name.
            ls_source-section = 'ENHANCEMENT'.
            APPEND ls_source TO et_source_code.
          ENDLOOP.
        ENDIF.
      ENDIF.

*--- BAdI Implementation ---
    WHEN 'BADI' OR 'BADI_NEW'.
      ev_object_type = 'BADI'.
      ev_title = |BAdI: { iv_object_name }|.

      " For classic BADIs, get the implementing class
      IF iv_category = 'BADI'.
        SELECT imp_class
          FROM sxc_exit
          WHERE exit_name = @iv_object_name
          INTO TABLE @DATA(lt_badi_classes).

        LOOP AT lt_badi_classes INTO DATA(ls_badi_cls).
          " Recursively read the class source
          " (simplified - in production, call this FM recursively or refactor)
          DATA(lv_badi_class_def) = CONV syrepid(
            ls_badi_cls-imp_class && '==============CCIMP' ).
          CLEAR lt_source.
          READ REPORT lv_badi_class_def INTO lt_source.
          IF sy-subrc = 0.
            lv_line_num = 0.
            LOOP AT lt_source INTO lv_line.
              lv_line_num = lv_line_num + 1.
              CLEAR ls_source.
              ls_source-line_number = lv_line_num.
              ls_source-source_line = lv_line.
              ls_source-include_name = ls_badi_cls-imp_class.
              ls_source-section = |BADI_CLASS:{ ls_badi_cls-imp_class }|.
              APPEND ls_source TO et_source_code.
            ENDLOOP.
          ENDIF.
        ENDLOOP.
      ENDIF.

  ENDCASE.

ENDFUNCTION.

