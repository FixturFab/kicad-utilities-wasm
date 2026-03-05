#pragma once
// Stub schematic_types.pb.h for WASM build
// Provides minimal types for Serialize/Deserialize methods to compile
#include <string>
#include <google/protobuf/message.h>
#include <api/common/types/base_types.pb.h>

namespace kiapi {
namespace schematic {
namespace types {

enum SchematicLayer {
    SL_UNKNOWN = 0
};

class Line : public google::protobuf::Message {
public:
    kiapi::common::types::KIID* mutable_id() { return &m_id; }
    const kiapi::common::types::KIID& id() const { return m_id; }
    kiapi::common::types::Vector2* mutable_start() { return &m_start; }
    const kiapi::common::types::Vector2& start() const { return m_start; }
    kiapi::common::types::Vector2* mutable_end() { return &m_end; }
    const kiapi::common::types::Vector2& end() const { return m_end; }
    void set_layer(SchematicLayer) {}
    SchematicLayer layer() const { return SL_UNKNOWN; }
private:
    kiapi::common::types::KIID m_id;
    kiapi::common::types::Vector2 m_start;
    kiapi::common::types::Vector2 m_end;
};

class LocalLabel : public google::protobuf::Message {
public:
    kiapi::common::types::KIID* mutable_id() { return &m_id; }
    const kiapi::common::types::KIID& id() const { return m_id; }
    kiapi::common::types::Vector2* mutable_position() { return &m_position; }
    const kiapi::common::types::Vector2& position() const { return m_position; }
    void set_name(const std::string&) {}
    std::string name() const { return ""; }
    void set_layer(SchematicLayer) {}
    SchematicLayer layer() const { return SL_UNKNOWN; }
private:
    kiapi::common::types::KIID m_id;
    kiapi::common::types::Vector2 m_position;
};

}  // namespace types
}  // namespace schematic
}  // namespace kiapi
