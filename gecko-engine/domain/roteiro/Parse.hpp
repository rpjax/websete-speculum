#pragma once

#include <cctype>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include "domain/roteiro/Types.hpp"

namespace speculum::roteiro {

struct ParseError {
  int lineNo{0};
  std::string message;
};

struct ParseResult {
  SpecFile file;
  bool ok{true};
  ParseError error;
};

inline std::string_view trim(std::string_view s) {
  while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) s.remove_prefix(1);
  while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.remove_suffix(1);
  return s;
}

inline ParseResult parseSpec(std::string_view text) {
  ParseResult r;
  int lineNo = 0;
  size_t pos = 0;
  while (pos <= text.size()) {
    size_t end = text.find('\n', pos);
    if (end == std::string_view::npos) end = text.size();
    std::string_view line = text.substr(pos, end - pos);
    if (!line.empty() && line.back() == '\r') line.remove_suffix(1);
    pos = end + 1;
    ++lineNo;
    if (line.empty()) {
      if (pos > text.size()) break;
      continue;
    }

    SpecLine sl;
    sl.lineNo = lineNo;
    char prefix = line.front();
    std::string_view body = trim(line.substr(1));

    if (prefix == '#') {
      sl.kind = LineKind::Comment;
      sl.comment = std::string(body);
      r.file.lines.push_back(std::move(sl));
    } else if (prefix == '!') {
      sl.kind = LineKind::Directive;
      auto sp = body.find_first_of(" \t");
      std::string_view key = sp == std::string_view::npos ? body : body.substr(0, sp);
      std::string_view val = sp == std::string_view::npos ? std::string_view{} : trim(body.substr(sp));
      if (key == "roteiro") {
        sl.dir = DirKind::Roteiro;
        sl.dirValue = std::string(val);
        r.file.version = std::atoi(sl.dirValue.c_str());
      } else if (key == "schema") {
        sl.dir = DirKind::Schema;
        sl.dirValue = std::string(val);
        r.file.schemaHash = sl.dirValue;
      } else if (key == "seed") {
        sl.dir = DirKind::Seed;
        sl.dirValue = std::string(val);
        r.file.seed = std::strtoull(sl.dirValue.c_str(), nullptr, 10);
      } else {
        r.ok = false;
        r.error = {lineNo, "unknown directive: " + std::string(key)};
        return r;
      }
      r.file.lines.push_back(std::move(sl));
    } else if (prefix == '@') {
      sl.kind = LineKind::Time;
      sl.timeMs = std::strtoull(std::string(body).c_str(), nullptr, 10);
      sl.raw = std::string(body);
      r.file.lines.push_back(std::move(sl));
    } else if (prefix == '>' || prefix == '<') {
      sl.kind = prefix == '>' ? LineKind::In : LineKind::Out;
      // event name = first token
      auto sp = body.find_first_of(" \t");
      std::string_view ename = sp == std::string_view::npos ? body : body.substr(0, sp);
      std::string_view args = sp == std::string_view::npos ? std::string_view{} : trim(body.substr(sp));
      sl.eventName = std::string(ename);
      sl.event = parseEventName(ename);
      if (sl.event == EventName::Unknown) {
        r.ok = false;
        r.error = {lineNo, "unknown event: " + sl.eventName};
        return r;
      }
      if (prefix == '>' && !isInputEvent(sl.event)) {
        r.ok = false;
        r.error = {lineNo, "output event on > line: " + sl.eventName};
        return r;
      }
      if (prefix == '<' && !isOutputEvent(sl.event)) {
        r.ok = false;
        r.error = {lineNo, "input event on < line: " + sl.eventName};
        return r;
      }
      sl.args = std::string(args);
      sl.raw = std::string(body);
      r.file.lines.push_back(std::move(sl));
    } else {
      r.ok = false;
      r.error = {lineNo, "line must start with > < @ ! or #" };
      return r;
    }
    if (pos > text.size()) break;
  }
  return r;
}

inline std::string formatLine(const SpecLine& sl) {
  switch (sl.kind) {
    case LineKind::Comment:
      return "# " + sl.comment;
    case LineKind::Directive: {
      const char* k = sl.dir == DirKind::Roteiro   ? "roteiro"
                      : sl.dir == DirKind::Schema ? "schema"
                                                   : "seed";
      return std::string("!") + k + "  " + sl.dirValue;
    }
    case LineKind::Time:
      return "@" + std::to_string(sl.timeMs);
    case LineKind::In:
      return "> " + sl.eventName + (sl.args.empty() ? "" : "  " + sl.args);
    case LineKind::Out:
      return "< " + sl.eventName + (sl.args.empty() ? "" : "  " + sl.args);
  }
  return {};
}

inline std::string writeSpec(const SpecFile& f) {
  std::ostringstream os;
  // Ensure directives first if not already present in lines
  bool hasRoteiro = false, hasSchema = false, hasSeed = false;
  for (const auto& l : f.lines) {
    if (l.kind == LineKind::Directive) {
      if (l.dir == DirKind::Roteiro) hasRoteiro = true;
      if (l.dir == DirKind::Schema) hasSchema = true;
      if (l.dir == DirKind::Seed) hasSeed = true;
    }
  }
  if (!hasRoteiro) os << "!roteiro " << f.version << "\n";
  if (!hasSchema && !f.schemaHash.empty()) os << "!schema  " << f.schemaHash << "\n";
  if (!hasSeed) os << "!seed    " << f.seed << "\n";
  if (!hasRoteiro || !hasSchema || !hasSeed) os << "\n";

  for (const auto& l : f.lines) {
    os << formatLine(l) << "\n";
  }
  return os.str();
}

}  // namespace speculum::roteiro
