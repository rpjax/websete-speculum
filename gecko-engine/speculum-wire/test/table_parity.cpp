// Paridade da tabela replicada: roda o roteiro compartilhado e grava o tableHash apos cada
// comando (mais a ordem de filhos onde o roteiro pedir). O lado TS roda o MESMO roteiro no
// ReplicatedTable de producao; compare.py confere passo a passo.
#include "speculum/Table.h"

#include <fstream>
#include <iostream>
#include <sstream>

using namespace speculum;

static std::vector<std::string> tokens(const std::string& line) {
  std::vector<std::string> out;
  std::istringstream is(line);
  std::string t;
  while (is >> t) out.push_back(t);
  return out;
}

static AttrPair parseAttr(const std::string& tok) {
  auto eq = tok.find('=');
  if (eq == std::string::npos) return AttrPair{tok, ""};
  return AttrPair{tok.substr(0, eq), tok.substr(eq + 1)};
}

static std::string restAfter(const std::string& line, size_t skipTokens) {
  std::istringstream is(line);
  std::string t;
  for (size_t i = 0; i < skipTokens; ++i) is >> t;
  std::string rest;
  std::getline(is, rest);
  if (!rest.empty() && rest[0] == ' ') rest.erase(0, 1);
  return rest;
}

int main(int argc, char** argv) {
  const std::string scriptPath = argc > 1 ? argv[1] : "table_script.txt";
  const std::string outPath = argc > 2 ? argv[2] : "/tmp/speculum-wire/table_cpp.json";

  std::ifstream in(scriptPath);
  if (!in) {
    std::cerr << "nao abriu " << scriptPath << "\n";
    return 1;
  }

  ReplicatedTable t;
  std::ostringstream j;
  j << "[\n";
  bool first = true;
  std::string line;
  int lineNo = 0;

  while (std::getline(in, line)) {
    ++lineNo;
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty() || line[0] == '#') continue;
    auto tk = tokens(line);
    const std::string& cmd = tk[0];
    std::string childrenJson = "null";

    if (cmd == "seq") {
      t.setSequence(static_cast<uint32_t>(std::stoul(tk[1])));
    } else if (cmd == "elem") {
      std::vector<AttrPair> attrs;
      for (size_t i = 4; i < tk.size(); ++i) attrs.push_back(parseAttr(tk[i]));
      auto ns = static_cast<ElementNs>(std::stoul(tk[2]));
      std::string uri = ns == ElementNs::Custom ? "urn:speculum:test" : "";
      t.createElementRow(static_cast<uint32_t>(std::stoul(tk[1])), tk[3], attrs, ns, uri);
    } else if (cmd == "leaf") {
      t.createLeafRow(static_cast<uint32_t>(std::stoul(tk[1])),
                      static_cast<NodeKind>(std::stoul(tk[2])), restAfter(line, 3));
    } else if (cmd == "shadow") {
      t.createShadowRootRow(static_cast<uint32_t>(std::stoul(tk[1])),
                            static_cast<uint32_t>(std::stoul(tk[2])),
                            static_cast<uint8_t>(std::stoul(tk[3])),
                            static_cast<uint8_t>(std::stoul(tk[4])));
    } else if (cmd == "attrset") {
      std::vector<AttrPair> attrs;
      for (size_t i = 2; i < tk.size(); ++i) attrs.push_back(parseAttr(tk[i]));
      t.setAttrs(static_cast<uint32_t>(std::stoul(tk[1])), attrs);
    } else if (cmd == "attrdel") {
      std::vector<std::string> names(tk.begin() + 2, tk.end());
      t.delAttrs(static_cast<uint32_t>(std::stoul(tk[1])), names);
    } else if (cmd == "text") {
      t.setValue(static_cast<uint32_t>(std::stoul(tk[1])), restAfter(line, 2));
    } else if (cmd == "propstr") {
      t.setProp(static_cast<uint32_t>(std::stoul(tk[1])),
                static_cast<uint8_t>(std::stoul(tk[2])), PropValue::str(restAfter(line, 3)));
    } else if (cmd == "propbool") {
      t.setProp(static_cast<uint32_t>(std::stoul(tk[1])),
                static_cast<uint8_t>(std::stoul(tk[2])), PropValue::boolean(tk[3] == "1"));
    } else if (cmd == "insert") {
      std::vector<uint32_t> ids;
      for (size_t i = 3; i < tk.size(); ++i) ids.push_back(static_cast<uint32_t>(std::stoul(tk[i])));
      t.insertBatch(static_cast<uint32_t>(std::stoul(tk[1])),
                    static_cast<uint32_t>(std::stoul(tk[2])), ids);
    } else if (cmd == "remove") {
      std::vector<uint32_t> ids;
      for (size_t i = 2; i < tk.size(); ++i) ids.push_back(static_cast<uint32_t>(std::stoul(tk[i])));
      t.removeBatch(static_cast<uint32_t>(std::stoul(tk[1])), ids);
    } else if (cmd == "drop") {
      t.dropSubtree(static_cast<uint32_t>(std::stoul(tk[1])));
    } else if (cmd == "children") {
      auto kids = t.orderedChildIds(static_cast<uint32_t>(std::stoul(tk[1])));
      std::ostringstream c;
      c << "[";
      for (size_t i = 0; i < kids.size(); ++i) c << (i ? "," : "") << kids[i];
      c << "]";
      childrenJson = c.str();
    } else {
      std::cerr << "comando desconhecido na linha " << lineNo << ": " << cmd << "\n";
      return 1;
    }

    if (!first) j << ",\n";
    first = false;
    j << "  {\"line\": " << lineNo << ", \"cmd\": \"" << line << "\", \"tableHash\": \""
      << t.tableHash() << "\", \"size\": " << t.size() << ", \"children\": " << childrenJson
      << "}";
  }
  j << "\n]\n";

  std::ofstream out(outPath);
  out << j.str();
  std::cout << "table: " << t.size() << " linhas, tableHash=" << t.tableHash() << "\n";
  return 0;
}
