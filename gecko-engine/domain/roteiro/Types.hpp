#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace speculum::roteiro {

enum class LineKind : uint8_t { In = 0, Out = 1, Time = 2, Directive = 3, Comment = 4 };

// Closed set — unknown name = parse error (no generic event).
enum class EventName : uint16_t {
  Unknown = 0,
  // input
  LinkIn,
  LinkRaw,
  LinkWritable,
  LinkBroken,
  HostProcessAttach,
  HostProcessGone,
  HostViewportOpen,
  HostViewportClose,
  HostFrameAttach,
  HostFrameDetach,
  FrameLoadStart,
  FrameLoadStop,
  FrameLocation,
  FrameDocumentInstall,
  FrameDocumentDiscard,
  FramePromptRequest,
  FramePromptAbandon,
  DocChildInsert,
  DocChildRemoving,
  DocAttr,
  DocText,
  DocNodeDestroy,
  DocShadowAttach,
  DocSheetAdd,
  DocSheetRemove,
  DocSheetApplicable,
  DocRuleAdd,
  DocRuleRemove,
  DocRuleText,
  DocChildframeAttach,
  DocChildframeDetach,
  DocClosing,
  ClockFire,
  AssetChunk,
  AssetEnd,
  AssetError,
  // output
  LinkOut,
  Patch,
  Fault,
  ClockArm,
  ClockCancel,
  AssetOpen,
  AssetCancel,
};

enum class DirKind : uint8_t { Roteiro = 1, Schema = 2, Seed = 3 };

struct SpecLine {
  LineKind kind{};
  int lineNo{0};
  uint32_t spanId{0};  // assigned by CauseSpan when processing
  // Time
  uint64_t timeMs{0};
  // Directive
  DirKind dir{};
  std::string dirValue;
  // Comment
  std::string comment;
  // Event
  EventName event{EventName::Unknown};
  std::string eventName;   // canonical dotted name
  std::string args;        // remainder of line after event name
  std::string raw;         // full original line body (without > < @ ! # prefix)
};

struct SpecFile {
  int version{1};
  std::string schemaHash;
  uint64_t seed{0};
  std::vector<SpecLine> lines;
};

inline const char* eventNameStr(EventName e) {
  switch (e) {
    case EventName::LinkIn: return "link.in";
    case EventName::LinkRaw: return "link.raw";
    case EventName::LinkWritable: return "link.writable";
    case EventName::LinkBroken: return "link.broken";
    case EventName::HostProcessAttach: return "host.process.attach";
    case EventName::HostProcessGone: return "host.process.gone";
    case EventName::HostViewportOpen: return "host.viewport.open";
    case EventName::HostViewportClose: return "host.viewport.close";
    case EventName::HostFrameAttach: return "host.frame.attach";
    case EventName::HostFrameDetach: return "host.frame.detach";
    case EventName::FrameLoadStart: return "frame.load.start";
    case EventName::FrameLoadStop: return "frame.load.stop";
    case EventName::FrameLocation: return "frame.location";
    case EventName::FrameDocumentInstall: return "frame.document.install";
    case EventName::FrameDocumentDiscard: return "frame.document.discard";
    case EventName::FramePromptRequest: return "frame.prompt.request";
    case EventName::FramePromptAbandon: return "frame.prompt.abandon";
    case EventName::DocChildInsert: return "doc.child.insert";
    case EventName::DocChildRemoving: return "doc.child.removing";
    case EventName::DocAttr: return "doc.attr";
    case EventName::DocText: return "doc.text";
    case EventName::DocNodeDestroy: return "doc.node.destroy";
    case EventName::DocShadowAttach: return "doc.shadow.attach";
    case EventName::DocSheetAdd: return "doc.sheet.add";
    case EventName::DocSheetRemove: return "doc.sheet.remove";
    case EventName::DocSheetApplicable: return "doc.sheet.applicable";
    case EventName::DocRuleAdd: return "doc.rule.add";
    case EventName::DocRuleRemove: return "doc.rule.remove";
    case EventName::DocRuleText: return "doc.rule.text";
    case EventName::DocChildframeAttach: return "doc.childframe.attach";
    case EventName::DocChildframeDetach: return "doc.childframe.detach";
    case EventName::DocClosing: return "doc.closing";
    case EventName::ClockFire: return "clock.fire";
    case EventName::AssetChunk: return "asset.chunk";
    case EventName::AssetEnd: return "asset.end";
    case EventName::AssetError: return "asset.error";
    case EventName::LinkOut: return "link.out";
    case EventName::Patch: return "patch";
    case EventName::Fault: return "fault";
    case EventName::ClockArm: return "clock.arm";
    case EventName::ClockCancel: return "clock.cancel";
    case EventName::AssetOpen: return "asset.open";
    case EventName::AssetCancel: return "asset.cancel";
    default: return "";
  }
}

inline EventName parseEventName(std::string_view name) {
  static const EventName kAll[] = {
      EventName::LinkIn,           EventName::LinkRaw,         EventName::LinkWritable,
      EventName::LinkBroken,       EventName::HostProcessAttach, EventName::HostProcessGone,
      EventName::HostViewportOpen, EventName::HostViewportClose, EventName::HostFrameAttach,
      EventName::HostFrameDetach,  EventName::FrameLoadStart,  EventName::FrameLoadStop,
      EventName::FrameLocation,    EventName::FrameDocumentInstall, EventName::FrameDocumentDiscard,
      EventName::FramePromptRequest, EventName::FramePromptAbandon, EventName::DocChildInsert,
      EventName::DocChildRemoving, EventName::DocAttr,         EventName::DocText,
      EventName::DocNodeDestroy,   EventName::DocShadowAttach, EventName::DocSheetAdd,
      EventName::DocSheetRemove,   EventName::DocSheetApplicable, EventName::DocRuleAdd,
      EventName::DocRuleRemove,    EventName::DocRuleText,     EventName::DocChildframeAttach,
      EventName::DocChildframeDetach, EventName::DocClosing,   EventName::ClockFire,
      EventName::AssetChunk,       EventName::AssetEnd,        EventName::AssetError,
      EventName::LinkOut,          EventName::Patch,           EventName::Fault,
      EventName::ClockArm,         EventName::ClockCancel,     EventName::AssetOpen,
      EventName::AssetCancel,
  };
  for (auto e : kAll) {
    if (name == eventNameStr(e)) return e;
  }
  return EventName::Unknown;
}

inline bool isInputEvent(EventName e) {
  return e >= EventName::LinkIn && e <= EventName::AssetError;
}
inline bool isOutputEvent(EventName e) {
  return e >= EventName::LinkOut && e <= EventName::AssetCancel;
}

}  // namespace speculum::roteiro
