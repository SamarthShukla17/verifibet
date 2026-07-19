/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/verifibet.json`.
 */
export type Verifibet = {
  "address": "CCrrc5cdohor1EGGFkrQ3yKUS3zU9tnU2uzxWRnd2PMw",
  "metadata": {
    "name": "verifibet",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [],
      "args": []
    },
    {
      "name": "initializeMarket",
      "discriminator": [
        35,
        35,
        189,
        193,
        155,
        48,
        170,
        203
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Keeper wallet creating the market. Pays for both the market account",
            "and the vault's rent here, so the first bettor never has to."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "fixtureId"
              }
            ]
          }
        },
        {
          "name": "usdcMint",
          "docs": [
            "Pinned into `market.usdc_mint` below. Every later token-moving",
            "instruction re-checks its own mint account against that field",
            "rather than trusting whatever's passed in — see",
            "`VerifibetError::MintMismatch`."
          ]
        },
        {
          "name": "vault",
          "docs": [
            "The market's escrow. Always the canonical associated token account",
            "of `market` for `usdc_mint` — created here (not lazily on the first",
            "bet) so the first bettor doesn't pay the vault's rent, and so there",
            "is exactly one valid vault address per market by construction."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "fixtureId",
          "type": "u64"
        },
        {
          "name": "home",
          "type": "string"
        },
        {
          "name": "away",
          "type": "string"
        },
        {
          "name": "kickoffTs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "placeBet",
      "discriminator": [
        222,
        62,
        67,
        220,
        63,
        166,
        126,
        33
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "docs": [
            "Re-derived from the market's own stored `fixture_id`/`bump` (not an",
            "instruction arg — `place_bet` doesn't take one) so this is",
            "guaranteed to be the canonical PDA for whatever fixture it claims,",
            "not just any `Market`-typed account."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.fixture_id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "bet",
          "docs": [
            "One position per `(market, user, outcome)`. Re-betting the same",
            "outcome reuses this same PDA and accumulates into `amount`; betting",
            "a different outcome opens a distinct `Bet` PDA (see `state.rs`)."
          ],
          "writable": true
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "docs": [
            "Required by `init_if_needed` on `bet` above, even though it's not",
            "otherwise touched in this instruction."
          ],
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "associatedTokenProgram",
          "docs": [
            "Required by Anchor's `associated_token::*` constraint resolution on",
            "`vault` above (not otherwise touched — the vault already exists)."
          ],
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        }
      ],
      "args": [
        {
          "name": "outcome",
          "type": "u8"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "lockMarket",
      "discriminator": [
        107,
        8,
        184,
        91,
        223,
        13,
        180,
        38
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.fixture_id",
                "account": "market"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "resolveMarket",
      "discriminator": [
        155,
        23,
        80,
        173,
        46,
        74,
        23,
        239
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.fixture_id",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "txlineProgram",
          "docs": [
            "`Program<'info, T>` already enforces this is exactly TxLINE's",
            "deployed program (`txline_validate::ID`, embedded from the IDL's",
            "own `address` field) — no other program can be substituted here."
          ],
          "address": "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"
        },
        {
          "name": "dailyScoresMerkleRoots",
          "docs": [
            "rather than a typed `Account<'info, _>` — we have no (and shouldn't",
            "invent any) view into its internal layout; `validate_stat` is the",
            "only thing that reads it. What *is* checked here: the `seeds` +",
            "`seeds::program` constraint below re-derives this as TxLINE's daily",
            "Merkle-root PDA for the epoch day implied by `ts`, rather than",
            "trusting whatever account the caller passes — TxLINE's own",
            "`validate_stat` independently re-checks this PDA too, but this",
            "closes the gap before a mismatched-day account even reaches the",
            "CPI. `validate_stat`'s own IDL entry has exactly this one account,",
            "confirmed via `cargo expand` — not \"config/root PDAs\" plural, just",
            "this one.",
            "",
            "`.clamp(0, u16::MAX as i64)` (security audit finding, SECURITY.md",
            "§5): `ts` is keeper-supplied and signed i64; an unclamped `ts /",
            "MS_PER_DAY` on a negative or absurdly large `ts` would silently",
            "truncate on the `as u16` cast instead of erroring. Not independently",
            "exploitable (a wrapped epoch day just fails to match any account",
            "TxLINE actually maintains, and `validate_stat` re-derives the same",
            "PDA from the same `ts` independently), but relying on that instead",
            "of well-defined arithmetic here isn't the \"checked arithmetic\"",
            "standard the rest of this program holds to. Clamping makes the",
            "seeds expression itself well-defined for every possible `ts`",
            "without needing a `require!` that Anchor would evaluate too late",
            "anyway (Accounts constraints run before the handler body)."
          ]
        }
      ],
      "args": [
        {
          "name": "outcome",
          "type": "u8"
        },
        {
          "name": "ts",
          "type": "i64"
        },
        {
          "name": "fixtureSummary",
          "type": {
            "defined": {
              "name": "verifibet::txline_validate::types::ScoresBatchSummary"
            }
          }
        },
        {
          "name": "fixtureProof",
          "type": {
            "vec": {
              "defined": {
                "name": "verifibet::txline_validate::types::ProofNode"
              }
            }
          }
        },
        {
          "name": "mainTreeProof",
          "type": {
            "vec": {
              "defined": {
                "name": "verifibet::txline_validate::types::ProofNode"
              }
            }
          }
        },
        {
          "name": "statHome",
          "type": {
            "defined": {
              "name": "verifibet::txline_validate::types::StatTerm"
            }
          }
        },
        {
          "name": "statAway",
          "type": {
            "defined": {
              "name": "verifibet::txline_validate::types::StatTerm"
            }
          }
        }
      ]
    },
    {
      "name": "claimWinnings",
      "discriminator": [
        161,
        215,
        24,
        59,
        14,
        236,
        242,
        221
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true,
          "relations": [
            "bet"
          ]
        },
        {
          "name": "market",
          "docs": [
            "Re-derived from the market's own stored `fixture_id`/`bump`, same",
            "as every other instruction that touches an existing `Market` — see",
            "`resolve_market.rs`. Not `mut`: see the module doc comment."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.fixture_id",
                "account": "market"
              }
            ]
          },
          "relations": [
            "bet"
          ]
        },
        {
          "name": "bet",
          "docs": [
            "Seeds re-derive this from the account's own stored `outcome`",
            "(`claim_winnings` takes no `outcome` argument — there's exactly one",
            "correct value, whatever this specific bet was placed on) against",
            "the *passed-in* `market`/`user` accounts, which already guarantees",
            "this bet belongs to both of them. `has_one = user` / `has_one =",
            "market` re-check the same thing the simpler way — redundant with",
            "the seeds constraint, kept anyway as an independent check that",
            "doesn't rely on the seeds derivation being bug-free."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "The market's escrow — identical constraints to `place_bet`'s",
            "`vault`: always the canonical ATA of `market` for `usdc_mint`, so",
            "there is no account that can redirect the payout elsewhere."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "voidMarket",
      "discriminator": [
        243,
        175,
        46,
        124,
        95,
        101,
        39,
        69
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.fixture_id",
                "account": "market"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "claimRefund",
      "discriminator": [
        15,
        16,
        30,
        161,
        255,
        228,
        97,
        60
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true,
          "relations": [
            "bet"
          ]
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.fixture_id",
                "account": "market"
              }
            ]
          },
          "relations": [
            "bet"
          ]
        },
        {
          "name": "bet",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdcMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "userUsdc",
          "writable": true
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "verifibet::state::Bet",
      "discriminator": [
        147,
        23,
        35,
        59,
        15,
        75,
        155,
        32
      ]
    },
    {
      "name": "verifibet::state::Market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    }
  ],
  "events": [
    {
      "name": "verifibet::instructions::void_and_refund::RefundClaimed",
      "discriminator": [
        136,
        64,
        242,
        99,
        4,
        244,
        208,
        130
      ]
    },
    {
      "name": "verifibet::instructions::place_bet::BetPlaced",
      "discriminator": [
        88,
        88,
        145,
        226,
        126,
        206,
        32,
        0
      ]
    },
    {
      "name": "verifibet::instructions::claim_winnings::WinningsClaimed",
      "discriminator": [
        187,
        184,
        29,
        196,
        54,
        117,
        70,
        150
      ]
    },
    {
      "name": "verifibet::instructions::initialize_market::MarketInitialized",
      "discriminator": [
        134,
        160,
        122,
        87,
        50,
        3,
        255,
        81
      ]
    },
    {
      "name": "verifibet::instructions::void_and_refund::VoidedMarket",
      "discriminator": [
        13,
        3,
        158,
        243,
        9,
        239,
        155,
        224
      ]
    },
    {
      "name": "verifibet::instructions::resolve_market::MarketResolved",
      "discriminator": [
        89,
        67,
        230,
        95,
        143,
        106,
        199,
        202
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "marketNotOpen",
      "msg": "Market is not open"
    },
    {
      "code": 6001,
      "name": "kickoffPassed",
      "msg": "Kickoff has already passed"
    },
    {
      "code": 6002,
      "name": "kickoffNotPassed",
      "msg": "Kickoff has not passed yet"
    },
    {
      "code": 6003,
      "name": "invalidOutcome",
      "msg": "Outcome must be 0 (home), 1 (draw), or 2 (away)"
    },
    {
      "code": 6004,
      "name": "marketNotResolved",
      "msg": "Market is not resolved"
    },
    {
      "code": 6005,
      "name": "marketNotVoided",
      "msg": "Market is not voided"
    },
    {
      "code": 6006,
      "name": "notWinningBet",
      "msg": "Bet did not win"
    },
    {
      "code": 6007,
      "name": "alreadyClaimed",
      "msg": "Bet has already been claimed"
    },
    {
      "code": 6008,
      "name": "unauthorized",
      "msg": "Signer is not authorized for this action"
    },
    {
      "code": 6009,
      "name": "zeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6010,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6011,
      "name": "tooEarlyToVoid",
      "msg": "Too early to void this market"
    },
    {
      "code": 6012,
      "name": "mintMismatch",
      "msg": "Token account mint does not match the market's usdc_mint"
    },
    {
      "code": 6013,
      "name": "nameTooLong",
      "msg": "Team name exceeds 24 bytes"
    },
    {
      "code": 6014,
      "name": "invalidStatProof",
      "msg": "Stat proof does not represent a valid full-time result comparison"
    }
  ],
  "types": [
    {
      "name": "verifibet::state::Bet",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "outcome",
            "docs": [
              "0 = home, 1 = draw, 2 = away — never `OUTCOME_UNSET`; a `Bet`",
              "account only ever exists for a specific staked outcome."
            ],
            "type": "u8"
          },
          {
            "name": "amount",
            "docs": [
              "Cumulative USDC staked on this `(user, outcome)` position, base",
              "units. Re-bets on the same outcome add to this rather than opening",
              "a new account."
            ],
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "verifibet::state::Market",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Keeper authority allowed to lock/resolve/void this market. Checked",
              "per-instruction against this field — never assumed to be a fixed,",
              "program-wide admin key."
            ],
            "type": "pubkey"
          },
          {
            "name": "usdcMint",
            "docs": [
              "USDC mint pinned at `initialize_market`. Every token-moving",
              "instruction re-checks accounts against this field rather than",
              "trusting whatever mint is passed in — see `VerifibetError::MintMismatch`."
            ],
            "type": "pubkey"
          },
          {
            "name": "fixtureId",
            "docs": [
              "TxLINE fixture id. Also the seed that derives this account's own",
              "address, so it's redundant with the PDA itself but kept as a field",
              "for cheap reads without re-deriving."
            ],
            "type": "u64"
          },
          {
            "name": "home",
            "type": "string"
          },
          {
            "name": "away",
            "type": "string"
          },
          {
            "name": "kickoffTs",
            "type": "i64"
          },
          {
            "name": "status",
            "docs": [
              "Open, Locked, Resolved, Voided."
            ],
            "type": {
              "defined": {
                "name": "verifibet::state::MarketStatus"
              }
            }
          },
          {
            "name": "outcome",
            "docs": [
              "0 = home, 1 = draw, 2 = away, 255 = unset (`OUTCOME_UNSET`) —",
              "matches the encoding documented in CLAUDE.md / `lib/types.ts`'s",
              "`Outcome`."
            ],
            "type": "u8"
          },
          {
            "name": "pools",
            "docs": [
              "Total USDC staked per outcome index (0/1/2), base units."
            ],
            "type": {
              "array": [
                "u64",
                3
              ]
            }
          },
          {
            "name": "totalPool",
            "docs": [
              "`pools[0] + pools[1] + pools[2]`, kept redundantly so the frontend",
              "doesn't need to sum on every read. Instructions that mutate `pools`",
              "must keep this in sync in the same transaction."
            ],
            "type": "u64"
          },
          {
            "name": "proofHash",
            "docs": [
              "Settlement proof (e.g. a TxLINE Merkle root) backing the resolved",
              "outcome. All-zero while unresolved."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "resolvedAt",
            "docs": [
              "Unix seconds the market was resolved at; `0` while unresolved."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "verifibet::state::MarketStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "locked"
          },
          {
            "name": "resolved"
          },
          {
            "name": "voided"
          }
        ]
      }
    },
    {
      "name": "verifibet::txline_validate::types::ProofNode",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "isRightSibling",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "verifibet::txline_validate::types::ScoreStat",
      "docs": [
        "The on-chain representation of a single, provable key-value statistic.",
        "This is the leaf of the inner-most Merkle tree."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "key",
            "type": "u32"
          },
          {
            "name": "value",
            "type": "i32"
          },
          {
            "name": "period",
            "type": "i32"
          }
        ]
      }
    },
    {
      "name": "verifibet::txline_validate::types::ScoresBatchSummary",
      "docs": [
        "The summary for a single fixture's scores events within a 5-minute batch.",
        "This contains the root of the sub-tree of all events for that fixture."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fixtureId",
            "type": "i64"
          },
          {
            "name": "updateStats",
            "type": {
              "defined": {
                "name": "verifibet::txline_validate::types::ScoresUpdateStats"
              }
            }
          },
          {
            "name": "eventsSubTreeRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "verifibet::txline_validate::types::ScoresUpdateStats",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "updateCount",
            "type": "i32"
          },
          {
            "name": "minTimestamp",
            "type": "i64"
          },
          {
            "name": "maxTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "verifibet::txline_validate::types::StatTerm",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "statToProve",
            "type": {
              "defined": {
                "name": "verifibet::txline_validate::types::ScoreStat"
              }
            }
          },
          {
            "name": "eventStatRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "statProof",
            "type": {
              "vec": {
                "defined": {
                  "name": "verifibet::txline_validate::types::ProofNode"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "verifibet::instructions::void_and_refund::RefundClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "payout",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "verifibet::instructions::place_bet::BetPlaced",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "outcome",
            "type": "u8"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "pools",
            "type": {
              "array": [
                "u64",
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "verifibet::instructions::claim_winnings::WinningsClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "payout",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "verifibet::instructions::initialize_market::MarketInitialized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fixtureId",
            "type": "u64"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "kickoffTs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "verifibet::instructions::void_and_refund::VoidedMarket",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "fixtureId",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "verifibet::instructions::resolve_market::MarketResolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "fixtureId",
            "type": "u64"
          },
          {
            "name": "outcome",
            "type": "u8"
          },
          {
            "name": "proofHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    }
  ]
};
