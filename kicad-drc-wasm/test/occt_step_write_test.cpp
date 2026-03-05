// OCCT Stage 3e validation test: create document, add shape, write STEP to virtual FS
#include <STEPCAFControl_Writer.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <TDocStd_Document.hxx>
#include <TDataStd_Name.hxx>
#include <Quantity_Color.hxx>
#include <TopoDS_Shape.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <string>

int main()
{
    printf("OCCT STEP Write Test: creating XDE document with colored box...\n");

    // Create application and document
    Handle(XCAFApp_Application) app = XCAFApp_Application::GetApplication();
    Handle(TDocStd_Document) doc;
    app->NewDocument("MDTV-XCAF", doc);

    if (doc.IsNull()) {
        printf("FAIL: Could not create XDE document.\n");
        return 1;
    }

    // Get shape and color tools
    Handle(XCAFDoc_ShapeTool) shapeTool = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
    Handle(XCAFDoc_ColorTool) colorTool = XCAFDoc_DocumentTool::ColorTool(doc->Main());

    // Create a box shape
    TopoDS_Shape box = BRepPrimAPI_MakeBox(20.0, 15.0, 5.0).Shape();
    printf("Box shape created.\n");

    // Add shape to document
    TDF_Label shapeLabel = shapeTool->AddShape(box);
    TDataStd_Name::Set(shapeLabel, "TestBox");

    // Add color
    Quantity_Color green(0.0, 0.8, 0.0, Quantity_TOC_RGB);
    colorTool->SetColor(shapeLabel, green, XCAFDoc_ColorGen);
    printf("Shape added to XDE document with color.\n");

    // Write STEP file
    const char* outputPath = "/tmp/occt_step_test.step";
    STEPCAFControl_Writer writer;
    writer.SetColorMode(Standard_True);
    writer.SetNameMode(Standard_True);

    if (!writer.Transfer(doc, STEPControl_AsIs)) {
        printf("FAIL: STEP transfer failed.\n");
        return 1;
    }

    IFSelect_ReturnStatus status = writer.Write(outputPath);
    if (status != IFSelect_RetDone) {
        printf("FAIL: STEP write failed with status %d.\n", (int)status);
        return 1;
    }

    printf("STEP file written to %s\n", outputPath);

    // Read back and verify ISO-10303 header
    std::ifstream ifs(outputPath);
    if (!ifs.is_open()) {
        printf("FAIL: Could not open written STEP file.\n");
        return 1;
    }

    std::string content((std::istreambuf_iterator<char>(ifs)),
                         std::istreambuf_iterator<char>());
    ifs.close();

    printf("STEP file size: %zu bytes\n", content.size());

    // Check for ISO-10303-21 header
    if (content.find("ISO-10303-21") == std::string::npos) {
        printf("FAIL: STEP file does not contain ISO-10303-21 header.\n");
        return 1;
    }
    printf("ISO-10303-21 header found.\n");

    // Check for PRODUCT entity (should contain our box name)
    if (content.find("PRODUCT") == std::string::npos) {
        printf("WARNING: No PRODUCT entity found in STEP file.\n");
    } else {
        printf("PRODUCT entity found.\n");
    }

    // Check for color data
    if (content.find("COLOUR_RGB") != std::string::npos ||
        content.find("DRAUGHTING_PRE_DEFINED_COLOUR") != std::string::npos) {
        printf("Color data found in STEP file.\n");
    } else {
        printf("WARNING: No color data found in STEP file.\n");
    }

    printf("PASS: OCCT STEP write works correctly under Emscripten.\n");
    return 0;
}
