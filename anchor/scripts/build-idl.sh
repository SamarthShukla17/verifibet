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

(
  cd "$PROGRAM_DIR"
  ANCHOR_IDL_BUILD_NO_DOCS=FALSE \
  ANCHOR_IDL_BUILD_RESOLUTION=TRUE \
  ANCHOR_IDL_BUILD_SKIP_LINT=FALSE \
  ANCHOR_IDL_BUILD_PROGRAM_PATH="$(pwd)" \
  RUSTFLAGS="-A warnings" \
  cargo test __anchor_private_print_idl --features idl-build -- --show-output --quiet
) >"$RAW_OUT" 2>&1 || { cat "$RAW_OUT"; exit 1; }

python3 - "$RAW_OUT" "$OUT_JSON" <<'PY'
import re, sys, json

raw_path, out_path = sys.argv[1], sys.argv[2]
text = open(raw_path).read()

addr_match = re.search(r'--- IDL begin address ---\n(.*?)\n--- IDL end address ---', text, re.S)
prog_match = re.search(r'--- IDL begin program ---\n(.*?)\n--- IDL end program ---', text, re.S)
if not addr_match or not prog_match:
    sys.exit(f"Could not find IDL markers in build output:\n{text}")

address = json.loads(json.loads(addr_match.group(1).strip()))
idl = json.loads(prog_match.group(1))
idl["address"] = address

with open(out_path, "w") as f:
    json.dump(idl, f, indent=2)
    f.write("\n")
PY

rm -f "$RAW_OUT"

anchor idl type "$OUT_JSON" -o "$OUT_TS"

echo "Wrote $OUT_JSON and $OUT_TS"
