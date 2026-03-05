#pragma once
#include "event.h"
#include "object.h"

class wxValidator : public wxEvtHandler {
public:
    wxValidator() = default;
    virtual ~wxValidator() = default;
    virtual wxObject* Clone() const { return nullptr; }
    virtual bool Validate(class wxWindow*) { return true; }
    virtual bool TransferToWindow() { return true; }
    virtual bool TransferFromWindow() { return true; }
};

extern const wxValidator wxDefaultValidator;
