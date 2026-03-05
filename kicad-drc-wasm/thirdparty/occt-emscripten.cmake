# OCCT 7.6.3 Emscripten build configuration
# Builds minimal OCCT toolkits as static libraries for STEP export support

set(OCCT_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/thirdparty/occt-7.6.3")
set(OCCT_SRC "${OCCT_ROOT}/src")

# Global OCCT include directories: each package is its own include dir
# We collect all package directories under src/
file(GLOB OCCT_PACKAGE_DIRS "${OCCT_SRC}/*/")
set(OCCT_INCLUDE_DIRS)
foreach(pkg_dir ${OCCT_PACKAGE_DIRS})
    if(IS_DIRECTORY "${pkg_dir}")
        list(APPEND OCCT_INCLUDE_DIRS "${pkg_dir}")
    endif()
endforeach()

# OCCT compile definitions for Emscripten static build
set(OCCT_COMPILE_DEFS
    OCCT_NO_PLUGINS
    HAVE_IOSTREAM
    HAVE_FSTREAM
    HAVE_IOMANIP
    HAVE_LIMITS_H
    __EMSCRIPTEN__
)

# Function: Read PACKAGES file for a toolkit and collect all .cxx source files
function(occt_collect_toolkit_sources TOOLKIT_NAME OUT_SOURCES)
    set(PACKAGES_FILE "${OCCT_SRC}/${TOOLKIT_NAME}/PACKAGES")
    if(NOT EXISTS "${PACKAGES_FILE}")
        message(FATAL_ERROR "OCCT toolkit ${TOOLKIT_NAME}: PACKAGES file not found at ${PACKAGES_FILE}")
    endif()

    file(STRINGS "${PACKAGES_FILE}" PACKAGES)
    set(ALL_SOURCES)
    foreach(PKG ${PACKAGES})
        string(STRIP "${PKG}" PKG)
        if("${PKG}" STREQUAL "")
            continue()
        endif()
        # Collect all .cxx files from this package
        file(GLOB PKG_SOURCES "${OCCT_SRC}/${PKG}/*.cxx")
        list(APPEND ALL_SOURCES ${PKG_SOURCES})
    endforeach()
    set(${OUT_SOURCES} ${ALL_SOURCES} PARENT_SCOPE)
endfunction()

# Function: Build an OCCT toolkit as a static library
function(occt_add_toolkit TOOLKIT_NAME)
    occt_collect_toolkit_sources(${TOOLKIT_NAME} TOOLKIT_SOURCES)

    # Exclude Windows-specific files (WNT suffix)
    set(FILTERED_SOURCES)
    foreach(src ${TOOLKIT_SOURCES})
        get_filename_component(fname "${src}" NAME)
        # Skip Windows-only files
        if(fname MATCHES "_WNT\\.cxx$" OR fname MATCHES "WNT_" OR fname MATCHES "W32_")
            continue()
        endif()
        # Skip Cocoa/macOS files
        if(fname MATCHES "_Cocoa\\.cxx$" OR fname MATCHES "Cocoa_")
            continue()
        endif()
        # Skip X11 files
        if(fname MATCHES "_Xw\\.cxx$" OR fname MATCHES "Xw_Window")
            continue()
        endif()
        # Skip TBB-specific parallel impl (we don't use TBB)
        if(fname STREQUAL "OSD_Parallel_TBB.cxx")
            continue()
        endif()
        # Skip D3D/OpenGL-related files
        if(fname MATCHES "D3DHost" OR fname MATCHES "OpenGl" OR fname MATCHES "OpenGles")
            continue()
        endif()
        list(APPEND FILTERED_SOURCES "${src}")
    endforeach()

    if(NOT FILTERED_SOURCES)
        message(WARNING "OCCT toolkit ${TOOLKIT_NAME}: no source files found!")
        return()
    endif()

    add_library(${TOOLKIT_NAME} STATIC ${FILTERED_SOURCES})
    target_include_directories(${TOOLKIT_NAME} PUBLIC ${OCCT_INCLUDE_DIRS})
    target_compile_definitions(${TOOLKIT_NAME} PRIVATE ${OCCT_COMPILE_DEFS})
    target_compile_options(${TOOLKIT_NAME} PRIVATE
        # Undo the global __linux__ define that KiCad needs — OCCT should use its
        # own __EMSCRIPTEN__ paths for platform-specific code (signal, FPE, etc.)
        -U__linux__
        -Wno-deprecated-declarations
        -Wno-unused-variable
        -Wno-unused-function
        -Wno-sign-compare
        -Wno-missing-field-initializers
        -Wno-deprecated-copy
        -Wno-extra
        -Wno-reorder
        -Wno-parentheses
        -Wno-implicit-fallthrough
        -Wno-unknown-pragmas
        -Wno-unused-but-set-variable
        -Wno-comment
    )
endfunction()

# ── Define all needed toolkits ──────────────────────────────────────────────

# Foundation
occt_add_toolkit(TKernel)
occt_add_toolkit(TKMath)

# Modeling Data
occt_add_toolkit(TKG2d)
occt_add_toolkit(TKG3d)
occt_add_toolkit(TKGeomBase)
occt_add_toolkit(TKBRep)

# Modeling Algorithms
occt_add_toolkit(TKGeomAlgo)
occt_add_toolkit(TKTopAlgo)
occt_add_toolkit(TKShHealing)
occt_add_toolkit(TKBool)
occt_add_toolkit(TKBO)
occt_add_toolkit(TKPrim)
occt_add_toolkit(TKFillet)
occt_add_toolkit(TKOffset)
occt_add_toolkit(TKFeat)
occt_add_toolkit(TKHLR)
occt_add_toolkit(TKMesh)
occt_add_toolkit(TKXMesh)

# Visualization (minimal — needed by TKXCAF)
occt_add_toolkit(TKService)
occt_add_toolkit(TKV3d)

# Application Framework
occt_add_toolkit(TKCDF)
occt_add_toolkit(TKLCAF)
occt_add_toolkit(TKCAF)
occt_add_toolkit(TKTObj)
occt_add_toolkit(TKBinL)
occt_add_toolkit(TKBin)
occt_add_toolkit(TKBinTObj)

# Data Exchange
occt_add_toolkit(TKXSBase)
occt_add_toolkit(TKSTEPBase)
occt_add_toolkit(TKSTEPAttr)
occt_add_toolkit(TKSTEP209)
occt_add_toolkit(TKSTEP)
occt_add_toolkit(TKIGES)
occt_add_toolkit(TKXCAF)
occt_add_toolkit(TKXDESTEP)
occt_add_toolkit(TKXDEIGES)
occt_add_toolkit(TKBinXCAF)
occt_add_toolkit(TKSTL)
occt_add_toolkit(TKVRML)
occt_add_toolkit(TKRWMesh)

# Collect all OCCT library targets for linking
set(OCCT_LIBRARIES
    TKernel TKMath
    TKG2d TKG3d TKGeomBase TKBRep
    TKGeomAlgo TKTopAlgo TKShHealing TKBool TKBO TKPrim TKFillet TKOffset TKFeat TKHLR TKMesh TKXMesh
    TKService TKV3d
    TKCDF TKLCAF TKCAF TKTObj TKBinL TKBin TKBinTObj
    TKXSBase TKSTEPBase TKSTEPAttr TKSTEP209 TKSTEP
    TKIGES TKXCAF TKXDESTEP TKXDEIGES TKBinXCAF
    TKSTL TKVRML TKRWMesh
)
