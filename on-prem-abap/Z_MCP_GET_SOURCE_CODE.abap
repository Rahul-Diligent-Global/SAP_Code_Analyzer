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

* All variables declared upfront for compatibility
  DATA: lt_source        TYPE TABLE OF string,
        lv_line          TYPE string,
        ls_source        TYPE zsmcp_source_line,
        ls_include       TYPE zsmcp_include_info,
        lv_progname      TYPE syrepid,
        lv_line_num      TYPE i,
        lt_methods       TYPE seop_methods_w_include,
        ls_method        TYPE seop_method_w_include,
        lt_incl          TYPE TABLE OF sobj_name,
        lv_incl_name     TYPE string,
        lv_class_prog    TYPE string,
        lv_cls_pool      TYPE syrepid,
        lt_cls_includes  TYPE TABLE OF string,
        lv_cls_incl      TYPE string,
        lv_incl_rep      TYPE syrepid,
        lv_section_name  TYPE string,
        lv_func_group    TYPE rs38l_area,
        lv_fm_include    TYPE syrepid,
        lv_top_incl      TYPE syrepid,
        lt_func_names    TYPE TABLE OF enlfdir,
        ls_func_name     TYPE enlfdir,
        lv_fname         TYPE rs38l_fnam,
        lv_fminc         TYPE syrepid,
        lv_fg_top        TYPE syrepid,
        lv_enh_prog      TYPE sobj_name,
        lv_badi_class_def TYPE syrepid,
        lv_method_name   TYPE string.

  DATA: lt_badi_impl     TYPE TABLE OF sxc_exit,
        ls_badi_impl     TYPE sxc_exit.

  CLEAR: et_source_code[], et_includes[].

*-----------------------------------------------------------------------
* Get metadata from TADIR
*-----------------------------------------------------------------------
  SELECT SINGLE devclass author created_on
    FROM tadir
    INTO (ev_package, ev_author, ev_created_on)
    WHERE obj_name = iv_object_name
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
        INTO ev_title
        WHERE name  = lv_progname
          AND sprsl = sy-langu.

      " Read main source
      READ REPORT lv_progname INTO lt_source.
      IF sy-subrc = 0.
        lv_line_num = 0.
        LOOP AT lt_source INTO lv_line.
          lv_line_num = lv_line_num + 1.
          CLEAR ls_source.
          ls_source-line_number = lv_line_num.
          ls_source-source_line = lv_line.
          ls_source-include_name = lv_progname.
          ls_source-section = 'MAIN'.
          APPEND ls_source TO et_source_code.

          " Detect INCLUDEs
          IF lv_line CP 'INCLUDE *'.
            lv_incl_name = lv_line.
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
        INTO ev_title
        WHERE clsname = iv_object_name
          AND langu   = sy-langu.

      " Get all includes of the class
      CALL FUNCTION 'SEO_CLASS_GET_INCLUDE_BY_NAME'
        EXPORTING
          clsname       = iv_object_name
        TABLES
          includes      = lt_incl
        EXCEPTIONS
          not_existing  = 1
          OTHERS        = 2.

      IF sy-subrc = 0.
        " Standard includes: CCDEF, CCIMP, CCMAC, CCAU
        CLEAR lt_cls_includes.
        CONCATENATE iv_object_name '==============CCDEF' INTO lv_cls_incl.
        APPEND lv_cls_incl TO lt_cls_includes.
        CONCATENATE iv_object_name '==============CCIMP' INTO lv_cls_incl.
        APPEND lv_cls_incl TO lt_cls_includes.
        CONCATENATE iv_object_name '==============CCMAC' INTO lv_cls_incl.
        APPEND lv_cls_incl TO lt_cls_includes.
        CONCATENATE iv_object_name '==============CCAU' INTO lv_cls_incl.
        APPEND lv_cls_incl TO lt_cls_includes.

        LOOP AT lt_cls_includes INTO lv_cls_incl.
          CLEAR lt_source.
          lv_incl_rep = lv_cls_incl.
          READ REPORT lv_incl_rep INTO lt_source.
          IF sy-subrc = 0 AND lt_source IS NOT INITIAL.
            " Determine section name
            IF lv_cls_incl CS 'CCDEF'.
              lv_section_name = 'CLASS_DEFINITION'.
            ELSEIF lv_cls_incl CS 'CCIMP'.
              lv_section_name = 'CLASS_IMPLEMENTATION'.
            ELSEIF lv_cls_incl CS 'CCMAC'.
              lv_section_name = 'MACROS'.
            ELSEIF lv_cls_incl CS 'CCAU'.
              lv_section_name = 'TEST_CLASSES'.
            ELSE.
              lv_section_name = 'OTHER'.
            ENDIF.

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
            clsname            = iv_object_name
          RECEIVING
            result             = lt_methods
          EXCEPTIONS
            class_not_existing = 1.

        IF sy-subrc = 0.
          LOOP AT lt_methods INTO ls_method.
            CLEAR lt_source.
            READ REPORT ls_method-incname INTO lt_source.
            IF sy-subrc = 0 AND lt_source IS NOT INITIAL.
              " Derive method name from include name
              lv_method_name = ls_method-incname.

              CLEAR ls_include.
              ls_include-include_name = ls_method-incname.
              CONCATENATE 'METHOD:' lv_method_name INTO ls_include-include_type.
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
                CONCATENATE 'METHOD:' lv_method_name INTO ls_source-section.
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
      SELECT SINGLE area
        FROM enlfdir
        INTO lv_func_group
        WHERE funcname = iv_object_name.

      " Get FM short text
      SELECT SINGLE stext
        FROM tftit
        INTO ev_title
        WHERE funcname = iv_object_name
          AND spras    = sy-langu.

      " Read function module source
      lv_fname = iv_object_name.
      CALL FUNCTION 'FUNCTION_INCLUDE_INFO'
        IMPORTING
          include   = lv_fm_include
        CHANGING
          funcname  = lv_fname
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
        CONCATENATE 'L' lv_func_group 'TOP' INTO lv_top_incl.
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
        INTO TABLE lt_func_names
        WHERE area = iv_object_name.

      CONCATENATE 'Function Group:' iv_object_name INTO ev_title SEPARATED BY space.

      " Read top include
      CONCATENATE 'L' iv_object_name 'TOP' INTO lv_fg_top.
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
      LOOP AT lt_func_names INTO ls_func_name.
        lv_fname = ls_func_name-funcname.
        CALL FUNCTION 'FUNCTION_INCLUDE_INFO'
          IMPORTING
            include   = lv_fminc
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
            CONCATENATE 'FM:' ls_func_name-funcname INTO ls_include-include_type.
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
              CONCATENATE 'FM:' ls_func_name-funcname INTO ls_source-section.
              APPEND ls_source TO et_source_code.
            ENDLOOP.
          ENDIF.
        ENDIF.
      ENDLOOP.

*--- Enhancement Implementation ---
    WHEN 'ENHANCEMENT_IMPL'.
      ev_object_type = 'ENHANCEMENT'.
      CONCATENATE 'Enhancement Implementation:' iv_object_name INTO ev_title SEPARATED BY space.

      " Enhancement implementations are stored as programs
      SELECT SINGLE obj_name
        FROM tadir
        INTO lv_enh_prog
        WHERE obj_name = iv_object_name
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
      CONCATENATE 'BAdI:' iv_object_name INTO ev_title SEPARATED BY space.

      " For classic BADIs, get the implementing class
      IF iv_category = 'BADI'.
        SELECT *
          FROM sxc_exit
          INTO TABLE lt_badi_impl
          WHERE exit_name = iv_object_name.

        LOOP AT lt_badi_impl INTO ls_badi_impl.
          CONCATENATE ls_badi_impl-imp_class '==============CCIMP' INTO lv_badi_class_def.
          CLEAR lt_source.
          READ REPORT lv_badi_class_def INTO lt_source.
          IF sy-subrc = 0.
            lv_line_num = 0.
            LOOP AT lt_source INTO lv_line.
              lv_line_num = lv_line_num + 1.
              CLEAR ls_source.
              ls_source-line_number = lv_line_num.
              ls_source-source_line = lv_line.
              ls_source-include_name = ls_badi_impl-imp_class.
              CONCATENATE 'BADI_CLASS:' ls_badi_impl-imp_class INTO ls_source-section.
              APPEND ls_source TO et_source_code.
            ENDLOOP.
          ENDIF.
        ENDLOOP.
      ENDIF.

  ENDCASE.

ENDFUNCTION.
