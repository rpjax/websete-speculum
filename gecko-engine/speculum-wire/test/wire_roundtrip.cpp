// Prova de paridade C++ <-> TypeScript.
// Emite (a) um frame binario e (b) fixtures de hash. O lado TS decodifica o frame com o
// core/decode.ts REAL do cliente e recomputa os mesmos hashes com core/rowHash.ts.
#include "speculum/Hash.h"
#include "speculum/Wire.h"

#include <cstdio>
#include <fstream>
#include <iostream>

using namespace speculum;

static void writeFile(const std::string& path, const std::vector<uint8_t>& bytes) {
  std::ofstream f(path, std::ios::binary);
  f.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
}

int main(int argc, char** argv) {
  const std::string outDir = argc > 1 ? argv[1] : "/tmp/speculum-wire";

  // ---------- (a) frame ----------
  FramePartBuilder b;
  b.begin();

  // <html lang="pt-BR"> sob o Document
  b.nodeNewElement(2, ElementNs::Html, "html", {{"lang", "pt-BR"}});
  b.insert(kDocumentId, kInsertAtEnd, {2});

  // <body class="x" data-n="1">
  b.nodeNewElement(3, ElementNs::Html, "body", {{"class", "x"}, {"data-n", "1"}});
  b.insert(2, kInsertAtEnd, {3});

  // texto com acento e emoji — prova UTF-8 identico dos dois lados
  b.nodeNewText(4, u8"olá \U0001F600 mundo");
  b.insert(3, kInsertAtEnd, {4});

  b.nodeNewComment(5, " comentario ");
  b.nodeNewDoctype(6, "html");
  b.nodeNewShadowRoot(7, 3, /*mode=*/1, /*initFlags=*/0x03);

  // SVG e namespace custom
  b.nodeNewElement(8, ElementNs::Svg, "svg", {{"viewBox", "0 0 1 1"}});
  b.nodeNewElement(9, ElementNs::Custom, "thing", {}, "urn:speculum:test");

  // host de contexto aninhado
  b.nodeNewElement(10, ElementNs::Html, "iframe", {{"src", "/w7s/x"}}, "", true, 42);

  b.attrSet(3, {{"dir", "ltr"}});
  b.attrDel(3, {"data-n"});
  b.textSet(4, "texto novo");
  b.propSetStr(3, 0x01, "valor");
  b.propSetBool(3, 0x02, true);
  b.remove(3, {4});
  b.nodeDrop({5});

  // CHECK fecha o frame com o tableHash esperado
  TableHashTracker tracker;
  uint64_t contentHtml = hashNs(static_cast<uint8_t>(ElementNs::Html)) + hashName("html") +
                         hashAttr("lang", "pt-BR");
  tracker.upsert(2, computeRowHash(2, static_cast<uint32_t>(NodeKind::Element), kDocumentId, 0,
                                   contentHtml));
  uint64_t contentText = hashValue(u8"olá \U0001F600 mundo");
  tracker.upsert(4, computeRowHash(4, static_cast<uint32_t>(NodeKind::Text), 3, 0, contentText));
  b.check(kCheckScopeTable, 0, 0, tracker.value());

  PartHeader h;
  h.contextId = kContextIdRoot;
  h.generation = 7;
  h.sequence = 1;
  h.preTableHash = 0;
  const auto bytes = b.finish(h);
  writeFile(outDir + "/frame.bin", bytes);

  // ---------- (b) fixtures de hash ----------
  std::ofstream j(outDir + "/hashes_cpp.json");
  j << "{\n";
  j << "  \"h64Str_abc\": \"" << h64Str("abc") << "\",\n";
  j << "  \"h64U32_305419896\": \"" << h64U32(305419896u) << "\",\n";
  j << "  \"hashName_class\": \"" << hashName("class") << "\",\n";
  j << "  \"hashValue_utf8\": \"" << hashValue(u8"olá \U0001F600") << "\",\n";
  j << "  \"hashAttr\": \"" << hashAttr("data-x", "1") << "\",\n";
  j << "  \"hashPropStr\": \"" << hashPropStr(1, "valor") << "\",\n";
  j << "  \"hashPropBool\": \"" << hashPropBool(2, true) << "\",\n";
  j << "  \"hashNs_svg\": \"" << hashNs(static_cast<uint8_t>(ElementNs::Svg)) << "\",\n";
  j << "  \"hashNs_custom\": \"" << hashNs(kElementNsCustom, "urn:speculum:test") << "\",\n";
  j << "  \"hashShadowInit\": \"" << hashShadowInit(1, 3) << "\",\n";
  j << "  \"rowHash\": \"" << computeRowHash(2, 1, 1, 0, contentHtml) << "\",\n";
  j << "  \"tableHash\": \"" << tracker.value() << "\"\n";
  j << "}\n";

  // tracker: subtrai-antigo/soma-novo tem que bater com recomputo do zero
  {
    TableHashTracker t2;
    t2.upsert(1, 111);
    t2.upsert(2, 222);
    t2.upsert(1, 999);
    t2.remove(2);
    if (t2.value() != 999u || t2.size() != 1) {
      std::cerr << "FALHA: TableHashTracker incoerente\n";
      return 1;
    }
  }

  std::cout << "ops=" << b.opCount() << " bytes=" << bytes.size() << "\n";
  return 0;
}
