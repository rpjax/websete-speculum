# Generated wire codecs — do not hand-edit `speculum_wire.gen.ts`.
# Regenerate from repo root of gecko-engine:
#   python tools/wiregen/wiregen.py docs/gecko-engine/redesign/schema/speculum.wire.toml
# then copy:
#   cp wire-clients/ts/speculum_wire.gen.ts packages/page-projection/src/wire/
#
# Envelope peel + Patch decode: schemaPatch.ts (uses gen). ISA deltas: core/decode.ts.
