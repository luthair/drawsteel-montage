/**
 * Montage test controller - GM-authoritative state machine.
 * Integrates with Draw Steel roll API and Foundry.
 */

import type {
  MontageConfig,
  MontageState,
  Participant,
  ParticipantActionType,
  PendingApproval,
  VisibilityMode,
} from "./domain.js";
import { computeLimits, computeOutcome, type MontageOutcome } from "./rules.js";

const MODULE_ID = "drawsteel-montage";

export function generateId(): string {
  return foundry.utils.randomID();
}

/** Check if actor has Human ancestry + Determination perk (best-effort) */
export function hasHumanDeterminationPerk(actor: foundry.documents.Actor): boolean {
  if (!actor?.items) return false;
  const hasHumanAncestry = actor.items.some(
    (i) => i.type === "ancestry" && i.name.toLowerCase().includes("human")
  );
  if (!hasHumanAncestry) return false;
  const hasDetermination = actor.items.some(
    (i) =>
      (i as { system?: { _dsid?: string } }).system?._dsid === "determination" ||
      i.name.toLowerCase() === "determination"
  );
  return hasDetermination;
}

function isDrawSteelHero(actor: foundry.documents.Actor): boolean {
  return actor?.type === "hero" && game.system.id === "draw-steel";
}

export function createMontageState(config: MontageConfig, actors: foundry.documents.Actor[]): MontageState {
  const participants: Participant[] = actors
    .filter(isDrawSteelHero)
    .map((a) => {
      const owner = game.users?.find((u) => !u.isGM && (a as foundry.documents.Actor).testUserPermission?.(u, "OWNER"));
      return {
        actorId: a.id,
        actorName: a.name ?? "",
        playerId: owner?.id ?? null,
        hasHumanAssistPerk: hasHumanDeterminationPerk(a),
      };
    });

  const { successLimit, failureLimit } = config.successLimit != null && config.failureLimit != null
    ? { successLimit: config.successLimit, failureLimit: config.failureLimit }
    : computeLimits(config.difficulty, config.groupSize);

  return {
    config: {
      ...config,
      successLimit,
      failureLimit,
    },
    participants,
    currentRound: 1,
    successes: 0,
    failures: 0,
    roundStates: new Map(),
    pendingApprovals: [],
    usedCharacteristics: new Map(),
    outcome: null,
    startedAt: Date.now(),
  };
}

export function getRoundState(state: MontageState, round: number) {
  let rs = state.roundStates.get(round);
  if (!rs) {
    rs = state.participants.map((p) => ({
      actorId: p.actorId,
      participating: false,
      actionType: null,
      characteristic: undefined,
      narrative: undefined,
    }));
    state.roundStates.set(round, rs);
  }
  return rs;
}

export function submitIntent(
  state: MontageState,
  actorId: string,
  actionType: ParticipantActionType,
  characteristic?: string,
  narrative?: string
): { ok: boolean; error?: string } {
  const round = state.currentRound;
  const rs = getRoundState(state, round);
  const pr = rs.find((r) => r.actorId === actorId);
  if (!pr) return { ok: false, error: "Participant not found" };

  if (pr.actionType !== null)
    return { ok: false, error: "Already acted this round" };

  const used = state.usedCharacteristics.get(actorId) ?? new Set();
  if (actionType === "test" || actionType === "assist") {
    if (!characteristic)
      return { ok: false, error: "Characteristic required" };
    if (used.has(characteristic))
      return { ok: false, error: "Characteristic already used this montage" };
  }

  const participant = state.participants.find((p) => p.actorId === actorId)!;
  const approval: PendingApproval = {
    id: generateId(),
    actorId,
    actorName: participant.actorName,
    actionType,
    characteristic,
    narrative,
    submittedAt: Date.now(),
  };

  pr.participating = true;
  pr.actionType = actionType;
  pr.characteristic = characteristic;
  pr.narrative = narrative;
  state.pendingApprovals.push(approval);

  return { ok: true };
}

export function abstain(state: MontageState, actorId: string): { ok: boolean; error?: string } {
  const rs = getRoundState(state, state.currentRound);
  const pr = rs.find((r) => r.actorId === actorId);
  if (!pr) return { ok: false, error: "Participant not found" };
  if (pr.actionType !== null) return { ok: false, error: "Already acted" };
  pr.participating = true;
  pr.actionType = "abstain";
  return { ok: true };
}

export function rejectApproval(state: MontageState, approvalId: string): boolean {
  const idx = state.pendingApprovals.findIndex((a) => a.id === approvalId);
  if (idx < 0) return false;

  const a = state.pendingApprovals[idx];
  state.pendingApprovals.splice(idx, 1);

  const rs = getRoundState(state, state.currentRound);
  const pr = rs.find((r) => r.actorId === a.actorId);
  if (pr) {
    pr.actionType = null;
    pr.characteristic = undefined;
    pr.narrative = undefined;
  }
  return true;
}

/** Tier 3 = success; tier 1,2 = failure for montage counting (conservative: only tier 3 is success) */
function tierToSuccess(tier: number | undefined): boolean {
  return tier === 3;
}

/** Extract PowerRoll product (tier) from a Draw Steel test chat message */
function getTierFromMessage(message: foundry.documents.ChatMessage): number | undefined {
  try {
    const msg = message as foundry.documents.ChatMessage & { rolls?: { product?: number }[] };
    if (msg.rolls?.length) {
      const last = msg.rolls.at(-1) as { product?: number } | undefined;
      if (typeof last?.product === "number") return last.product;
    }

    const parts = (message as { system?: { parts?: { type?: string; rolls?: unknown[] }[] } }).system?.parts;
    if (!Array.isArray(parts)) return undefined;

    const testPart = parts.find((p) => p?.type === "test") as { rolls?: unknown[] } | undefined;
    if (!testPart?.rolls?.length) return undefined;

    const lastRoll = testPart.rolls.at(-1);
    if (!lastRoll) return undefined;

    const ds = (globalThis as Record<string, unknown>).ds as { rolls?: { PowerRoll?: { fromData: (d: unknown) => { product?: number } }; DSRoll?: { fromData: (d: unknown) => { product?: number } } } } | undefined;
    const RollClass = ds?.rolls?.PowerRoll ?? ds?.rolls?.DSRoll;
    if (!RollClass?.fromData) return undefined;

    const rollData = typeof lastRoll === "string" ? JSON.parse(lastRoll) : lastRoll;
    const pr = RollClass.fromData(rollData) as { product?: number };
    return pr?.product;
  } catch {
    return undefined;
  }
}

/** Apply result for ability (auto-success) without a chat message */
export function applyAbilityAutoSuccess(state: MontageState, approvalId: string): boolean {
  const idx = state.pendingApprovals.findIndex((a) => a.id === approvalId);
  if (idx < 0) return false;
  state.pendingApprovals.splice(idx, 1);
  state.successes += 1;
  return true;
}

export function applyRollResult(
  state: MontageState,
  approvalId: string,
  message: foundry.documents.ChatMessage
): boolean {
  const idx = state.pendingApprovals.findIndex((a) => a.id === approvalId);
  if (idx < 0) return false;

  const approval = state.pendingApprovals[idx];
  state.pendingApprovals.splice(idx, 1);

  if (approval.actionType === "abstain" || approval.actionType === "ability") {
    if (approval.actionType === "ability") {
      state.successes += 1;
    }
    return true;
  }

  const tier = getTierFromMessage(message);
  const success = tierToSuccess(tier);
  if (success) state.successes += 1;
  else state.failures += 1;

  if (approval.characteristic) {
    let used = state.usedCharacteristics.get(approval.actorId);
    if (!used) {
      used = new Set();
      state.usedCharacteristics.set(approval.actorId, used);
    }
    used.add(approval.characteristic);
  }

  return true;
}

export function advanceRound(state: MontageState): boolean {
  const rs = getRoundState(state, state.currentRound);
  const acted = rs.filter((r) => r.actionType !== null).length;
  const total = state.participants.length;
  if (acted < total && state.pendingApprovals.length > 0) return false;

  const { successLimit, failureLimit, maxRounds } = state.config;
  const roundEndedByLimit = state.currentRound >= maxRounds;

  state.outcome = computeOutcome(
    state.successes,
    state.failures,
    successLimit,
    failureLimit,
    roundEndedByLimit
  );

  if (state.outcome || roundEndedByLimit) return false;

  state.currentRound += 1;
  return true;
}

export function canAdvanceRound(state: MontageState): boolean {
  const rs = getRoundState(state, state.currentRound);
  const acted = rs.filter((r) => r.actionType !== null).length;
  return acted >= state.participants.length && state.pendingApprovals.length === 0;
}

export function finalizeOutcome(state: MontageState): MontageOutcome {
  const { successLimit, failureLimit, maxRounds } = state.config;
  state.outcome = computeOutcome(
    state.successes,
    state.failures,
    successLimit,
    failureLimit,
    state.currentRound >= maxRounds
  );
  return state.outcome;
}
