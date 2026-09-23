// GeckoXulGlue — nsI*/mozilla includes ONLY under engines/gecko/ (and xul/).
// Host builds: SPECULUM_HAS_LIBXUL undefined → stub.
// w7s/moz.build: -DSPECULUM_HAS_LIBXUL and compile xul/*.cpp.

#include "engines/gecko/GeckoXulGlue.hpp"

#if defined(SPECULUM_HAS_LIBXUL)

#include "engines/gecko/xul/XulMutationObserver.hpp"

namespace speculum::gecko::xul {

// Defined in XulMutationObserver.cpp
bool xulGlueLinked();

}  // namespace speculum::gecko::xul

#else

namespace speculum::gecko::xul {

bool xulGlueLinked() { return false; }

}  // namespace speculum::gecko::xul

#endif
