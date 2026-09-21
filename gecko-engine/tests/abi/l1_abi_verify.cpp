/* L1 (lado C++) — o mesmo contrato binário do doc 18, provado contra os MESMOS
 * vetores de ouro que o lado C#.
 *
 * Compila o codec REAL de produção (SpeculumControlAbi.cpp) fora do Gecko, via
 * shims mínimos de nsACString e mozilla::LittleEndian. Se os dois lados produzem
 * e aceitam exatamente estes bytes, o contrato está provado nas duas linguagens
 * — e divergência aqui é defeito de contrato, não de implementação.
 *
 * Saída: o veredito. Em falha, o byte, a posição, o esperado e o recebido —
 * quem lê conserta, não investiga (doc 19 §1). */

#include "SpeculumControlAbi.h"

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <map>
#include <string>
#include <vector>

namespace {

int gChecks = 0;
int gFailures = 0;

using Bytes = std::vector<uint8_t>;

std::string Hex(const uint8_t* data, size_t len) {
  static const char* digits = "0123456789abcdef";
  std::string out;
  for (size_t i = 0; i < len; ++i) {
    if (i) out.push_back(' ');
    out.push_back(digits[data[i] >> 4]);
    out.push_back(digits[data[i] & 0xf]);
  }
  return out;
}

std::string Hex(const Bytes& b) { return Hex(b.data(), b.size()); }

void Pass(const std::string& what) {
  ++gChecks;
  printf("  ok   %s\n", what.c_str());
}

void Fail(const std::string& what, const std::string& expected,
          const std::string& actual, const std::string& extra = "") {
  ++gChecks;
  ++gFailures;
  printf("  FALHOU %s\n", what.c_str());
  printf("    esperado: %s\n", expected.c_str());
  printf("    recebido: %s\n", actual.c_str());
  if (!extra.empty()) printf("    %s\n", extra.c_str());
}

void CompareBytes(const std::string& what, const Bytes& expected,
                  const uint8_t* actual, size_t actualLen) {
  bool same = expected.size() == actualLen &&
              memcmp(expected.data(), actual, actualLen) == 0;
  if (same) {
    Pass(what + " (" + std::to_string(expected.size()) + " bytes)");
    return;
  }
  size_t limit = expected.size() < actualLen ? expected.size() : actualLen;
  std::string detail;
  long at = -1;
  for (size_t i = 0; i < limit; ++i) {
    if (expected[i] != actual[i]) { at = static_cast<long>(i); break; }
  }
  char buf[128];
  if (at >= 0) {
    snprintf(buf, sizeof(buf),
             "primeira divergencia no byte %ld: esperado 0x%02x, recebido 0x%02x",
             at, expected[at], actual[at]);
  } else {
    snprintf(buf, sizeof(buf), "tamanhos diferentes: esperado %zu, recebido %zu",
             expected.size(), actualLen);
  }
  detail = buf;
  Fail(what, Hex(expected), Hex(actual, actualLen), detail);
}

template <typename T>
void Equal(const std::string& what, T expected, T actual) {
  ++gChecks;
  if (expected == actual) {
    printf("  ok   %s = %lld\n", what.c_str(), static_cast<long long>(actual));
    return;
  }
  ++gFailures;
  printf("  FALHOU %s\n", what.c_str());
  printf("    esperado: %lld\n", static_cast<long long>(expected));
  printf("    recebido: %lld\n", static_cast<long long>(actual));
}

void EqualStr(const std::string& what, const std::string& expected,
              const std::string& actual) {
  ++gChecks;
  if (expected == actual) {
    printf("  ok   %s = %s\n", what.c_str(), actual.c_str());
    return;
  }
  ++gFailures;
  printf("  FALHOU %s\n", what.c_str());
  printf("    esperado: %s\n", expected.c_str());
  printf("    recebido: %s\n", actual.c_str());
}

Bytes ParseHex(const std::string& text) {
  Bytes out;
  for (size_t i = 0; i + 1 < text.size();) {
    while (i < text.size() && text[i] == ' ') ++i;
    if (i + 1 >= text.size()) break;
    auto nyb = [](char c) -> int {
      if (c >= '0' && c <= '9') return c - '0';
      if (c >= 'a' && c <= 'f') return c - 'a' + 10;
      if (c >= 'A' && c <= 'F') return c - 'A' + 10;
      return 0;
    };
    out.push_back(static_cast<uint8_t>((nyb(text[i]) << 4) | nyb(text[i + 1])));
    i += 2;
  }
  return out;
}

std::string Trim(const std::string& s) {
  size_t a = s.find_first_not_of(" \t\r\n");
  size_t b = s.find_last_not_of(" \t\r\n");
  if (a == std::string::npos) return "";
  return s.substr(a, b - a + 1);
}

std::map<std::string, Bytes> LoadGolden(const char* path) {
  std::map<std::string, Bytes> vectors;
  FILE* f = fopen(path, "rb");
  if (!f) return vectors;
  char line[8192];
  while (fgets(line, sizeof(line), f)) {
    std::string s = Trim(line);
    if (s.empty() || s[0] == '#') continue;
    size_t p1 = s.find('|');
    if (p1 == std::string::npos) continue;
    size_t p2 = s.find('|', p1 + 1);
    if (p2 == std::string::npos) continue;
    std::string name = Trim(s.substr(0, p1));
    std::string payload = Trim(s.substr(p1 + 1, p2 - p1 - 1));
    vectors[name] = ParseHex(payload);
  }
  fclose(f);
  return vectors;
}

// ---- construção dos comandos, espelhando ControlCommand do C# ----

Bytes BuildContextCreate(uint32_t corr, uint32_t ctx, int32_t w, int32_t h) {
  uint8_t buf[64];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::ContextCreate, corr);
  wtr.WriteUInt32(ctx);
  wtr.WriteInt32(w);
  wtr.WriteInt32(h);
  return Bytes(buf, buf + wtr.Length());
}

Bytes BuildContextDestroy(uint32_t corr, uint32_t ctx) {
  uint8_t buf[64];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::ContextDestroy, corr);
  wtr.WriteUInt32(ctx);
  return Bytes(buf, buf + wtr.Length());
}

Bytes BuildNavigate(uint32_t corr, uint32_t ctx, const char* url) {
  uint8_t buf[256];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::Navigate, corr);
  wtr.WriteUInt32(ctx);
  nsACString u(url, strlen(url));
  wtr.WriteString(u);
  return Bytes(buf, buf + wtr.Length());
}

Bytes BuildShutdown(uint32_t corr) {
  uint8_t buf[16];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::Shutdown, corr);
  return Bytes(buf, buf + wtr.Length());
}

Bytes BuildResync(uint32_t corr, uint32_t ctx, uint8_t force) {
  uint8_t buf[16];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::Resync, corr);
  wtr.WriteUInt32(ctx);
  wtr.WriteUInt8(force);
  return Bytes(buf, buf + wtr.Length());
}

Bytes BuildHaltClocks(uint32_t corr) {
  uint8_t buf[16];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::HaltClocks, corr);
  return Bytes(buf, buf + wtr.Length());
}

Bytes BuildResumeClocks(uint32_t corr) {
  uint8_t buf[16];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::ResumeClocks, corr);
  return Bytes(buf, buf + wtr.Length());
}

Bytes BuildFlushFrame(uint32_t corr, uint32_t ctx) {
  uint8_t buf[16];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::FlushFrame, corr);
  wtr.WriteUInt32(ctx);
  return Bytes(buf, buf + wtr.Length());
}

Bytes BuildSnapshot(uint32_t corr, uint32_t ctx) {
  uint8_t buf[16];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::Snapshot, corr);
  wtr.WriteUInt32(ctx);
  return Bytes(buf, buf + wtr.Length());
}

Bytes BuildSnapshotServed(uint32_t corr, uint32_t seq, uint32_t gen, uint32_t ctx,
                          uint64_t hash) {
  uint8_t buf[64];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::SnapshotServed, corr);
  wtr.WriteUInt32(seq);
  wtr.WriteUInt32(gen);
  wtr.WriteUInt32(ctx);
  wtr.WriteUInt64(hash);
  nsACString empty("", 0);
  wtr.WriteBytes(empty);
  return Bytes(buf, buf + wtr.Length());
}

Bytes BuildReload(uint32_t corr, uint32_t ctx) {
  uint8_t buf[16];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::Reload, corr);
  wtr.WriteUInt32(ctx);
  return Bytes(buf, buf + wtr.Length());
}

Bytes BuildStop(uint32_t corr, uint32_t ctx) {
  uint8_t buf[16];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::Stop, corr);
  wtr.WriteUInt32(ctx);
  return Bytes(buf, buf + wtr.Length());
}

Bytes BuildHistoryGo(uint32_t corr, uint32_t ctx, int32_t delta) {
  uint8_t buf[16];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::HistoryGo, corr);
  wtr.WriteUInt32(ctx);
  wtr.WriteInt32(delta);
  return Bytes(buf, buf + wtr.Length());
}

Bytes BuildViewportSet(uint32_t corr, uint32_t ctx, int32_t w, int32_t h) {
  uint8_t buf[32];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::ViewportSet, corr);
  wtr.WriteUInt32(ctx);
  wtr.WriteInt32(w);
  wtr.WriteInt32(h);
  return Bytes(buf, buf + wtr.Length());
}

Bytes BuildInput(uint32_t corr, uint32_t ctx) {
  uint8_t buf[32];
  SpeculumControlWriter wtr(buf, sizeof(buf), SpeculumControlOpCode::Input, corr);
  wtr.WriteUInt32(ctx);
  wtr.WriteUInt8(1);
  wtr.WriteUInt32(5);
  wtr.WriteUInt16(32768);
  wtr.WriteUInt16(32768);
  wtr.WriteUInt8(0);
  return Bytes(buf, buf + wtr.Length());
}

void CheckCommand(std::map<std::string, Bytes>& vectors, const std::string& name,
                  const Bytes& produced) {
  auto it = vectors.find(name);
  if (it == vectors.end()) {
    Fail("vetor " + name, "presente no arquivo", "ausente");
    return;
  }
  CompareBytes("codifica " + name, it->second, produced.data(), produced.size());
}

}  // namespace

int main(int argc, char** argv) {
  const char* golden = argc > 1 ? argv[1] : "control-abi.golden";
  printf("L1 (C++) — ABI de controle (vetores de ouro)\n");

  auto vectors = LoadGolden(golden);
  if (vectors.empty()) {
    Fail("vetores de ouro", golden, "arquivo nao encontrado ou vazio");
    printf("\nL1 (C++): 1 de 1 FALHARAM\n");
    return 1;
  }
  Equal<int>("vetores carregados", 22, static_cast<int>(vectors.size()));

  // ---- codificacao ----
  CheckCommand(vectors, "ContextCreate", BuildContextCreate(1, 1, 1280, 800));
  CheckCommand(vectors, "ContextDestroy", BuildContextDestroy(7, 1));
  CheckCommand(vectors, "Navigate", BuildNavigate(2, 1, "https://example.com"));
  CheckCommand(vectors, "Navigate-utf8",
               BuildNavigate(3, 1, "https://pt.wikipedia.org/wiki/A\xc3\xa7\xc3\xa3o"));
  CheckCommand(vectors, "Shutdown", BuildShutdown(9));
  CheckCommand(vectors, "Resync", BuildResync(4, 1, 0));
  CheckCommand(vectors, "HaltClocks", BuildHaltClocks(1));
  CheckCommand(vectors, "ResumeClocks", BuildResumeClocks(2));
  CheckCommand(vectors, "FlushFrame", BuildFlushFrame(3, 1));
  CheckCommand(vectors, "Snapshot", BuildSnapshot(4, 1));
  CheckCommand(vectors, "SnapshotServed", BuildSnapshotServed(4, 1, 0, 1, 0));
  CheckCommand(vectors, "Reload", BuildReload(1, 1));
  CheckCommand(vectors, "Stop", BuildStop(1, 1));
  CheckCommand(vectors, "HistoryGo", BuildHistoryGo(13, 1, -1));
  CheckCommand(vectors, "ViewportSet", BuildViewportSet(12, 1, 800, 600));
  CheckCommand(vectors, "Input", BuildInput(11, 1));

  // ---- decodificacao ----
  {
    const Bytes& v = vectors["Ready"];
    SpeculumControlReader r(v.data(), v.size());
    Equal<int>("Ready.ok", 1, r.Ok() ? 1 : 0);
    Equal<uint32_t>("Ready.opcode", 0x0201, r.OpCode());
    Equal<uint32_t>("Ready.correlationId", 0, r.CorrelationId());
  }
  {
    const Bytes& v = vectors["Heartbeat"];
    SpeculumControlReader r(v.data(), v.size());
    uint64_t monotonic = 0;
    r.ReadUInt64(&monotonic);
    Equal<uint32_t>("Heartbeat.opcode", 0x0202, r.OpCode());
    Equal<uint64_t>("Heartbeat.monotonicMs", 1234567890123ULL, monotonic);
  }
  {
    const Bytes& v = vectors["ContextCreated"];
    SpeculumControlReader r(v.data(), v.size());
    uint32_t ctx = 0, parent = 0;
    uint64_t bc = 0;
    r.ReadUInt32(&ctx);
    r.ReadUInt64(&bc);
    r.ReadUInt32(&parent);
    Equal<uint32_t>("ContextCreated.contextId", 1, ctx);
    Equal<uint64_t>("ContextCreated.browsingContextId", 42, bc);
    Equal<uint32_t>("ContextCreated.parentContextId", 0, parent);
  }
  {
    const Bytes& v = vectors["ContextDestroyed"];
    SpeculumControlReader r(v.data(), v.size());
    uint32_t ctx = 0;
    r.ReadUInt32(&ctx);
    Equal<uint32_t>("ContextDestroyed.contextId", 1, ctx);
  }
  {
    const Bytes& v = vectors["Navigated"];
    SpeculumControlReader r(v.data(), v.size());
    uint32_t ctx = 0;
    nsACString url;
    r.ReadUInt32(&ctx);
    r.ReadString(url);
    Equal<uint32_t>("Navigated.contextId", 1, ctx);
    EqualStr("Navigated.url", "https://example.com/",
             std::string(url.Data(), url.Length()));
  }
  {
    const Bytes& v = vectors["Fault"];
    SpeculumControlReader r(v.data(), v.size());
    uint32_t ctx = 0;
    nsACString reason;
    r.ReadUInt32(&ctx);
    r.ReadString(reason);
    Equal<uint32_t>("Fault.contextId", 0, ctx);
    EqualStr("Fault.reason", "contexto desconhecido",
             std::string(reason.Data(), reason.Length()));
  }

  // ---- bordas ----
  {
    // 5 bytes < cabecalho de 6: o leitor tem que recusar.
    const uint8_t short5[5] = {0x01, 0x01, 0x01, 0x00, 0x00};
    SpeculumControlReader r(short5, sizeof(short5));
    if (!r.Ok()) {
      Pass("mensagem truncada recusada (5 bytes < cabecalho de 6)");
    } else {
      Fail("mensagem truncada recusada", "Ok()==false", "aceitou 5 bytes");
    }
  }
  {
    // Opcode desconhecido nunca derruba a ponte (doc 18 §4): decodifica e
    // preserva o correlationId.
    const uint8_t unknown[6] = {0xff, 0x7f, 0x2a, 0x00, 0x00, 0x00};
    SpeculumControlReader r(unknown, sizeof(unknown));
    Equal<int>("opcode desconhecido: ok", 1, r.Ok() ? 1 : 0);
    Equal<uint32_t>("opcode desconhecido preserva correlationId", 42, r.CorrelationId());
  }

  printf("\n");
  if (gFailures == 0) {
    printf("L1 (C++): %d/%d OK\n", gChecks, gChecks);
    return 0;
  }
  printf("L1 (C++): %d de %d FALHARAM\n", gFailures, gChecks);
  return 1;
}
