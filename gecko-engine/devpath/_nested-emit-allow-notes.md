# Nested emit-allow — caderno de execução

Não é spec. Anotações de trabalho.

## Status

- [x] notepad
- [x] IPDL SpeculumFrame + Allow + Standby
- [x] emitAllowed por C (mapa, não processo)
- [x] bootstrap/tick/resync/flush mudos até allow
- [x] chrome DeliverFrame → NotePublishedNested → TryAllowNested
- [x] producer lastPublishedNestedIds + SendFrameBytes última parte
- [x] L4 ordem + docs 20/21/open
- [x] overlay + mach (libxul ok)
- [x] lab Eneba checkout — gate vivo; never bound residual no bind do Projected

## Decisões

- SpeculumFrame ganha `uint32_t[] aPublishedNestedIds`. Sem mensagem HostsPublished.
- emitAllowed por contextId, não por processo. Allow pode chegar antes do bind.
- C==1 nunca espera. hasMintHold no pai continua.
- RecvAllow só tenta bootstrap se readyState COMPLETE.

## Arquivos

- gecko-engine/patches/dom/ipc/PContent.ipdl
- gecko-engine/patches/dom/ipc/ContentParent.h/.cpp
- gecko-engine/patches/dom/ipc/ContentChild.h/.cpp
- gecko-engine/patches/dom/ipc/SpeculumProjectionRuntime.h/.cpp
- gecko-engine/patches/dom/base/SpeculumMutationObserver.h/.cpp
- gecko-engine/speculum-wire/include/speculum/Producer.h
- gecko-engine/speculum-wire/test/producer_nested.cpp
- gecko-engine/tests/Speculum.Tests/StackTests.cs
- docs/gecko-engine/20-projecao-completa.md
- docs/gecko-engine/21-fluxo-de-entrega-e-epoca.md
- docs/page-projection/spec/open.md

## Sessão / lab

- mach binaries ok (~34 min, libxul.so)
- lab 4077 HEALTH_OK
- sessão `086560142b48` Eneba /br/ → Ver ofertas PSN 150 → Comprar agora → carrinho com campo email
- MOZ: `bootstrap held` / `standby` / `allow sent` ctx 2,4,5,10,15,16,19,20,21,22
- BOOT nested: trustpilot widgets ctx 15, 19, 22
- HUD: checkout visível; DESYNC 1 ainda
- activity: `pending nested frames ctx20 host node 7031 never bound (1 queued)`
- peek: awaiting=[], pendingFrames={20:1}, nested desynced=false
- Conclusão: o filho não emitiu antes do host no socket (gate). O host foi marcado; installNestedHost não ligou ctx20; o audit do Projected ainda derruba o raiz. Fora deste slice.

## Falhas

- producer_nested: ok
- Lab prove “raiz sem never bound”: falhou no bind/audit do cliente, não no C++ emit-allow
