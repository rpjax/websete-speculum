/* Speculum — módulo de log único (MOZ_LOG=Speculum:5).
 * Default off. Não logar por callback de mutação. */
#ifndef DOM_BASE_SPECULUMLOG_H_
#define DOM_BASE_SPECULUMLOG_H_

#include "mozilla/Logging.h"

extern mozilla::LazyLogModule gSpeculumLog;

#define SPECULUM_LOG(...) \
  MOZ_LOG(gSpeculumLog, mozilla::LogLevel::Debug, (__VA_ARGS__))

#endif
