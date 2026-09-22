// Phase 6 — IReconstructor pure unit (no motor / engines).
#include <cstdio>
#include <string>

#include "domain/oracle/Reconstructor.hpp"
#include "domain/oracle/Types.hpp"

using namespace speculum;
using namespace speculum::oracle;

static int g_fails = 0;
#define CHECK(c, m)                                                            \
  do {                                                                         \
    if (!(c)) {                                                                \
      std::fprintf(stderr, "FAIL %s:%d %s\n", __FILE__, __LINE__, m);          \
      ++g_fails;                                                               \
    }                                                                          \
  } while (0)

int main() {
  TableImage table;
  table.host = HostId{7};
  table.generation = Generation{3};
  table.sequence = 11;
  ImageNode a;
  a.id = 1;
  a.name = "div";
  a.parent = 0;
  a.prevSibling = 0;
  a.attrs["class"] = "x";
  a.rowHash = 42;
  table.nodes.push_back(a);
  ImageNode b;
  b.id = 2;
  b.name = "span";
  b.parent = 1;
  b.prevSibling = 0;
  table.nodes.push_back(b);

  Reconstructor recon;
  NaiveImage out = recon.reconstruct(table);
  CHECK(out.host == table.host, "host");
  CHECK(out.nodes.size() == 2, "nodes");
  CHECK(out.nodes[0].id == 1 && out.nodes[0].name == "div", "node0");
  CHECK(out.nodes[1].parent == 1, "topology");
  CHECK(out.nodes[0].attrs["class"] == "x", "attrs");

  if (g_fails) {
    std::fprintf(stderr, "reconstructor_unit FAIL (%d)\n", g_fails);
    return 1;
  }
  std::printf("reconstructor_unit PASS\n");
  return 0;
}
