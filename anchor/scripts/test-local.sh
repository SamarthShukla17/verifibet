#!/usr/bin/env bash
# Builds both on-chain programs for the local validator and runs `anchor
# test` against them.
#
# Two things plain `anchor build`/`anchor test` can't do unchanged, both
# documented in CLAUDE.md and in programs/verifibet/src/lib.rs:
#
# 1. `anchor build`'s own IDL-generation pass reliably fails on this
#    machine's rustc (`ark-bn254`/`ark-ff-macros` + the CLI's hardcoded
#    `--cfg procmacro2_semver_exempt`) — `--no-idl` skips that pass
#    entirely. Neither program's IDL is needed for the test run itself:
#    `verifibet`'s IDL is generated separately (`./scripts/build-idl.sh`)
#    and `mock-txline` never had a real IDL in the first place (it exists
#    only to be CPI'd into via a hand-written trimmed copy of TxLINE's own
#    IDL, `idls/txline_validate_mock.json` — see lib.rs).
# 2. `verifibet` must be compiled with `--features test-mock-txline` for
#    local tests, so `resolve_market`'s CPI targets `mock-txline`'s program
#    id instead of the real TxLINE devnet program (which doesn't exist on a
#    local validator). This feature must never be part of a devnet/mainnet
#    build — CLAUDE.md's documented deploy command
#    (`anchor build --no-idl -- --tools-version v1.52`) never passes it.
#
# `--provider.cluster localnet` on the final `anchor test` below is required,
# not cosmetic: Anchor.toml's `[provider] cluster = "Devnet"` is the correct
# default for `anchor deploy` (see CLAUDE.md — devnet is this project's
# default cluster), but `anchor test` honors that same setting for itself and,
# when it's anything other than localnet, skips spinning up a local validator
# and runs the test suite against that cluster directly instead — it doesn't
# just default to local. Without this override, `anchor test` deploys
# straight to real devnet (confirmed the hard way: it did exactly this once
# during development, deploying both programs to devnet before failing on the
# public devnet faucet's rate limit) instead of the disposable local
# validator this whole mock-CPI setup exists to test against.
#
# `target/` is entirely gitignored (build artifacts), which includes both
# programs' deploy keypairs — deliberately NOT the same handling for each:
#
# - mock-txline is a disposable test fixture with zero real-world value (it
#   only ever runs against ephemeral local validators, never deployed
#   anywhere durable), so its keypair is checked into
#   `program-keypairs/mock_txline-keypair.json` and copied into place below,
#   guaranteeing it always deploys at the address its `declare_id!` and
#   `idls/txline_validate_mock.json` already hardcode, on any fresh checkout
#   (including CI).
# - verifibet's keypair is the real upgrade authority for the actual
#   devnet-deployed program (CLAUDE.md's documented
#   `CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw`) and is deliberately never
#   committed. On a machine that already has it (this one), builds just use
#   it as-is. On a from-scratch checkout (CI) where it doesn't exist yet,
#   `anchor build` generates a fresh one whose address won't match the
#   hardcoded `declare_id!` in source — harmless for a local-validator-only
#   test run, but the mismatch has to be reconciled (rewriting `declare_id!`
#   and `Anchor.toml`'s `[programs.localnet]` entry to the fresh keypair's
#   real pubkey, then rebuilding) or the compiled binary's own embedded ID
#   disagrees with where it's actually deployed. This reconciliation is done
#   by hand below rather than via `anchor keys sync`: that command's choice
#   of which `[programs.<cluster>]` section to update turned out to depend
#   on `[provider] cluster`'s value at invocation time in a way that didn't
#   reliably target `[programs.localnet]` even with `--provider.cluster
#   localnet` passed (confirmed empirically by simulating a from-scratch
#   checkout — not guessed). It only ever touches the CI runner's working
#   copy, never anything committed.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

mkdir -p target/deploy
cp program-keypairs/mock_txline-keypair.json target/deploy/mock_txline-keypair.json
fresh_verifibet_keypair=false
if [ ! -f target/deploy/verifibet-keypair.json ]; then
  fresh_verifibet_keypair=true
fi

anchor build --no-idl -p mock-txline -- --tools-version v1.52
anchor build --no-idl -p verifibet -- --tools-version v1.52 --features test-mock-txline

if [ "$fresh_verifibet_keypair" = true ]; then
  new_verifibet_id="$(solana-keygen pubkey target/deploy/verifibet-keypair.json)"
  sed -i "s/^declare_id!(\"[^\"]*\");/declare_id!(\"${new_verifibet_id}\");/" \
    programs/verifibet/src/lib.rs
  python3 - "$new_verifibet_id" <<'PY'
import re, sys

new_id = sys.argv[1]
path = "Anchor.toml"
text = open(path).read()
pattern = re.compile(r'(\[programs\.localnet\][^\[]*?verifibet\s*=\s*")[^"]*(")', re.S)
text, count = pattern.subn(lambda m: m.group(1) + new_id + m.group(2), text, count=1)
assert count == 1, "expected exactly one [programs.localnet] verifibet entry to update"
open(path, "w").write(text)
PY
  anchor build --no-idl -p verifibet -- --tools-version v1.52 --features test-mock-txline
fi

./scripts/build-idl.sh

# mock-txline has no idl-build machinery of its own (see mock-txline/src/lib.rs
# — it never needs to be CPI'd into via a generated client, only called
# directly from tests), so its one small, stable IDL is hand-written and
# checked in at idls/mock_txline.json rather than regenerated on every build;
# copy it into place for `anchor.workspace.MockTxline` (see @coral-xyz/anchor's
# workspace.js, which reads target/idl/<name>.json).
cp idls/mock_txline.json target/idl/mock_txline.json
cp target/idl/verifibet.json ../idls/verifibet.json

anchor test --skip-build --provider.cluster localnet "$@"
