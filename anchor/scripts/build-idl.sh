#!/usr/bin/env bash
# Generates target/idl/<program>.json + target/types/<program>.ts without going
# through `anchor build`'s / `anchor idl build`'s own IDL step.
#
# Why this exists: the installed `anchor` 0.30.1 CLI binary hardcodes
# `RUSTFLAGS="--cfg procmacro2_semver_exempt"` for its IDL-generation pass
# (verified by shimming `cargo` on PATH and logging argv/env). That cfg flips
# proc-macro2 into its "compiler-backed nightly Span" mode, which corrupts the
# invisible-group-wrapping that `ark-ff-macros`' `MontFp!` macro relies on to
# parse its string-literal arguments. `ark-bn254` -> `light-poseidon` is an
# unconditional dependency of `solana-program` (pulled in for the poseidon
# syscall), so it's in the dependency graph of every Anchor 0.30.1 program on
# this machine's rustc version, not just this one. `anchor build`'s IDL step
# reliably fails with "proc macro panicked ... could not parse" inside
# ark-bn254 as a result. Running the same `cargo test` invocation anchor uses
# internally, but with plain `RUSTFLAGS=-A warnings` (no semver_exempt cfg),
# reproduces successfully — we lose the semver_exempt-only cross-file type
# alias resolution in IDL generation, which we don't use.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
PROGRAM_DIR="programs/verifibet"
PROGRAM_NAME="verifibet"
OUT_JSON="target/idl/${PROGRAM_NAME}.json"
OUT_TS="target/types/${PROGRAM_NAME}.ts"
RAW_OUT="$(mktemp)"

mkdir -p target/idl target/types

# EXTRA_FEATURES (comma-separated, optional): additional Cargo features to
# build the IDL with on top of idl-build — e.g.
# `EXTRA_FEATURES=manual-fallback ./scripts/build-idl.sh` to include
# resolve_market_attested in the generated IDL for a manual-fallback deploy.
# Unset for the default submission build.
FEATURES="idl-build${EXTRA_FEATURES:+,$EXTRA_FEATURES}"

(
  cd "$PROGRAM_DIR"
  ANCHOR_IDL_BUILD_NO_DOCS=FALSE \
  ANCHOR_IDL_BUILD_RESOLUTION=TRUE \
  ANCHOR_IDL_BUILD_SKIP_LINT=FALSE \
  ANCHOR_IDL_BUILD_PROGRAM_PATH="$(pwd)" \
  RUSTFLAGS="-A warnings" \
  cargo test __anchor_private_print_idl --features "$FEATURES" -- --show-output --quiet
) >"$RAW_OUT" 2>&1 || { cat "$RAW_OUT"; exit 1; }

python3 - "$RAW_OUT" "$OUT_JSON" <<'PY'
# Mirrors the section-merging algorithm in anchor-lang-idl's own
# `build()` (crates.io anchor-lang-idl 0.1.4, src/build.rs) — cargo test's
# stdout carries the IDL in separate address/const/event/errors/program
# marker blocks, not one JSON blob. An earlier version of this script only
# extracted "address" and "program", which silently dropped errors and
# events (both real sections the program has) from every IDL this produced.
import re, sys, json

raw_path, out_path = sys.argv[1], sys.argv[2]
text = open(raw_path).read()


def blocks(tag):
    return re.findall(
        rf'--- IDL begin {tag} ---\n(.*?)\n--- IDL end {tag} ---', text, re.S
    )


addr_blocks = blocks("address")
prog_blocks = blocks("program")
if not addr_blocks or not prog_blocks:
    sys.exit(f"Could not find IDL address/program markers in build output:\n{text}")

idl = json.loads(prog_blocks[-1])
idl["address"] = json.loads(json.loads(addr_blocks[-1].strip()))
idl["constants"] = [json.loads(b) for b in blocks("const")]
idl["errors"] = json.loads(blocks("errors")[0]) if blocks("errors") else []

types_by_name = {t["name"]: t for t in idl.get("types", [])}
events = []
for b in blocks("event"):
    parsed = json.loads(b)
    events.append(parsed["event"])
    for t in parsed["types"]:
        types_by_name.setdefault(t["name"], t)
idl["events"] = events
idl["types"] = list(types_by_name.values())

with open(out_path, "w") as f:
    json.dump(idl, f, indent=2)
    f.write("\n")
PY

rm -f "$RAW_OUT"

anchor idl type "$OUT_JSON" -o "$OUT_TS"

echo "Wrote $OUT_JSON and $OUT_TS"
