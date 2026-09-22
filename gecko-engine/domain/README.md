# Redesign C++ — greenfield tree (docs/gecko-engine/redesign/).
# Old code under speculum-wire/ is treated as nonexistent until final cutover.

domain/     logic — zero engine includes
ports/      interfaces only
engines/    gecko + sim (empty until later phases)
host/       composition root (skeleton)
tools/      wiregen
wire-clients/  generated TS + C# codecs
scripts/phase1/  Fase 1 acceptance gate
