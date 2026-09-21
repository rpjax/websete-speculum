// Falha fatal sem exceções.
//
// O Gecko compila com exceções DESLIGADAS — `throw` ali não é opção. Então esta camada
// não lança: ela aborta com mensagem. O lado do motor pode redefinir a macro antes de
// incluir qualquer header do speculum:
//
//     #define SPECULUM_FATAL(msg) MOZ_CRASH(msg)
//     #include "speculum/Producer.h"
//
// O que chega aqui é violação de invariante do protocolo (frame malformado que nós mesmos
// íamos emitir), não erro de runtime esperado. Seguir adiante corromperia a tabela do
// cliente em silêncio, que é exatamente o que o projeto existe para não fazer.
#pragma once

#ifndef SPECULUM_FATAL
#include <cstdio>
#include <cstdlib>
#define SPECULUM_FATAL(msg)                                   \
  do {                                                        \
    std::fprintf(stderr, "[SPECULUM] FATAL: %s\n", (msg));    \
    std::abort();                                             \
  } while (0)
#endif
