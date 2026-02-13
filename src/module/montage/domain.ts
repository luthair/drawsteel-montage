/**
 * Domain types for Draw Steel Montage Tests.
 * Kept isolated from Foundry/Draw Steel specifics for deterministic rule logic.
 */

export type MontageDifficulty = "easy" | "moderate" | "hard";

export type VisibilityMode = "hidden" | "visible";

export type MontageOutcome = "totalSuccess" | "partialSuccess" | "totalFailure" | null;

export type ParticipantActionType = "test" | "assist" | "ability" | "abstain";

export interface MontageConfig {
  id: string;
  title: string;
  description: string;
  difficulty: MontageDifficulty;
  visibility: VisibilityMode;
  /** Override success limit (default from difficulty + group size) */
  successLimit?: number;
  /** Override failure limit */
  failureLimit?: number;
  maxRounds: number;
  groupSize: number;
}

export interface Participant {
  actorId: string;
  actorName: string;
  playerId: string | null;
  /** Human ancestry with Determination perk allows assist in round 1 */
  hasHumanAssistPerk: boolean;
}

export interface ParticipantRoundState {
  actorId: string;
  /** Joined this round (vs abstained) */
  participating: boolean;
  /** null = not yet acted */
  actionType: ParticipantActionType | null;
  /** For test/assist: characteristic key */
  characteristic?: string;
  /** Narrative contribution (player-provided) */
  narrative?: string;
}

export interface PendingApproval {
  id: string;
  actorId: string;
  actorName: string;
  actionType: ParticipantActionType;
  characteristic?: string;
  narrative?: string;
  submittedAt: number;
}

export interface MontageState {
  config: MontageConfig;
  participants: Participant[];
  currentRound: number;
  successes: number;
  failures: number;
  /** Per-round participant states */
  roundStates: Map<number, ParticipantRoundState[]>;
  /** Actions waiting for GM approval */
  pendingApprovals: PendingApproval[];
  /** Characteristics used by each actor in this montage (skill reuse prevention) */
  usedCharacteristics: Map<string, Set<string>>;
  outcome: MontageOutcome;
  startedAt: number;
}

export const DRAW_STEEL_CHARACTERISTICS = [
  "might",
  "agility",
  "reason",
  "intuition",
  "presence",
] as const;

export type CharacteristicKey = (typeof DRAW_STEEL_CHARACTERISTICS)[number];
