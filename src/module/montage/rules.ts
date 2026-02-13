/**
 * Montage test rule math from Draw Steel montage rules.
 * Deterministic, no Foundry imports.
 *
 * Verification (montage-test-rules.md):
 * - Base limits: Easy 5/5, Moderate 6/4, Hard 7/3
 * - Group size: <5 subtract 1 per hero (min 2), >5 add 1 per hero
 * - Outcome: total success if successes >= limit first; else partial if successes >= failures+2
 * - Victories: total success easy/mod=1, hard=2; partial mod/hard=1
 */

import type { MontageDifficulty, MontageOutcome } from "./domain.js";

/** Base limits for 5 heroes (Montage Test Difficulty table) */
const BASE_LIMITS: Record<MontageDifficulty, { success: number; failure: number }> = {
  easy: { success: 5, failure: 5 },
  moderate: { success: 6, failure: 4 },
  hard: { success: 7, failure: 3 },
};

/**
 * Compute success and failure limits for a given difficulty and group size.
 * Rules: 5 heroes = base; <5 subtract 1 per hero fewer (min 2); >5 add 1 per hero more.
 */
export function computeLimits(
  difficulty: MontageDifficulty,
  groupSize: number
): { successLimit: number; failureLimit: number } {
  const base = BASE_LIMITS[difficulty];
  let successLimit = base.success;
  let failureLimit = base.failure;

  if (groupSize < 5) {
    const delta = 5 - groupSize;
    successLimit = Math.max(2, successLimit - delta);
    failureLimit = Math.max(2, failureLimit - delta);
  } else if (groupSize > 5) {
    const delta = groupSize - 5;
    successLimit += delta;
    failureLimit += delta;
  }

  return { successLimit, failureLimit };
}

/**
 * Determine final montage outcome.
 * - Total success: hit success limit before failure limit or time out.
 * - Partial success: hit failure limit or time out AND successes >= failures + 2.
 * - Total failure: otherwise.
 */
export function computeOutcome(
  successes: number,
  failures: number,
  successLimit: number,
  failureLimit: number,
  roundEndedByLimit: boolean
): MontageOutcome {
  if (successes >= successLimit) return "totalSuccess";
  if (failures >= failureLimit || roundEndedByLimit) {
    return successes >= failures + 2 ? "partialSuccess" : "totalFailure";
  }
  return null;
}

/**
 * Victory rewards per outcome (from rules):
 * - Total success easy/moderate: 1 Victory
 * - Total success hard: 2 Victories
 * - Partial success hard/moderate: 1 Victory
 * - Total failure: 0
 */
export function getVictoryCount(
  outcome: MontageOutcome,
  difficulty: MontageDifficulty
): number {
  if (!outcome) return 0;
  if (outcome === "totalFailure") return 0;
  if (outcome === "totalSuccess") {
    return difficulty === "hard" ? 2 : 1;
  }
  if (outcome === "partialSuccess") {
    return difficulty === "easy" ? 0 : 1;
  }
  return 0;
}
