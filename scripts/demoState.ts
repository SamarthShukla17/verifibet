/**
 * Tiny persisted pointer, shared by `scripts/seed-demo.ts` and
 * `scripts/reset-demo.ts` — which real fixture/outcome is currently *the*
 * designated claimable win on the presenter wallet, and which real
 * fixture ids are already "used up" (a market already exists for them, or
 * a presenter bet is already riding on them) so `reset-demo.ts` never
 * picks one that collides with earlier seeding. Gitignored, same pattern
 * as `.txline-subscription.json` — this is local machine state describing
 * *this devnet deployment's* current demo data, not something to check in
 * or share across machines.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Outcome } from "@/lib/types";

export const DEMO_STATE_PATH = join(process.cwd(), ".demo-state.json");

export interface DemoState {
  designatedWin: {
    fixtureId: number;
    outcome: Outcome;
    market: string;
  };
  usedRealFixtureIds: number[];
}

export function loadDemoState(): DemoState | null {
  if (!existsSync(DEMO_STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(DEMO_STATE_PATH, "utf-8")) as DemoState;
  } catch {
    return null;
  }
}

export function saveDemoState(state: DemoState): void {
  writeFileSync(DEMO_STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}
