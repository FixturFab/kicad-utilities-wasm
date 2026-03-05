#pragma once
#include "validate.h"
#include "object.h"

// wxTextValidator stub for WASM - base class for KiCad's validator subclasses
class wxTextValidator : public wxValidator
{
public:
    wxTextValidator(long style = 0, wxString* val = nullptr) {}
    wxTextValidator(const wxTextValidator&) = default;
    virtual ~wxTextValidator() = default;

    virtual wxObject* Clone() const override { return new wxTextValidator(*this); }
    virtual bool Validate(wxWindow*) override { return true; }
    virtual bool TransferToWindow() override { return true; }
    virtual bool TransferFromWindow() override { return true; }
    virtual wxString IsValid(const wxString&) const { return wxString(); }

    void SetCharIncludes(const wxString&) {}
    void SetCharExcludes(const wxString&) {}
    void SetStyle(long) {}
};
