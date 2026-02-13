/**
 * Drawsteel Montage - Main module entry.
 * Copyright (c) 2026 Luthair
 */

import type { MontageConfig, MontageState } from "./montage/domain.js";
import {
  createMontageState,
  submitIntent,
  abstain,
  rejectApproval,
  applyRollResult,
  applyAbilityAutoSuccess,
  advanceRound,
  canAdvanceRound,
  finalizeOutcome,
  getRoundState,
} from "./montage/controller.js";
import { computeLimits, getVictoryCount } from "./montage/rules.js";
import { DirectorMontageApp } from "./ui/director-app.js";
import { openPlayerRoundPanel } from "./ui/player-round-panel.js";

const MODULE_ID = "drawsteel-montage";
const SOCKET_NAME = `module.${MODULE_ID}`;

let directorApp: DirectorMontageApp | null = null;
let montageState: MontageState | null = null;

function getDirectorApp(): DirectorMontageApp {
  if (!directorApp) {
    directorApp = new DirectorMontageApp();
  }
  return directorApp;
}

function isDrawSteelReady(): boolean {
  return game.system?.id === "draw-steel" && typeof (globalThis as { ds?: unknown }).ds !== "undefined";
}

function getHeroActors(): foundry.documents.Actor[] {
  if (!game.actors) return [];
  return game.actors.filter((a) => a.type === "hero") as foundry.documents.Actor[];
}

Hooks.once("init", () => {
  if (!isDrawSteelReady()) {
    console.warn(`${MODULE_ID}: Draw Steel system not detected. Module may not function correctly.`);
  }

  game.settings.register(MODULE_ID, "montageState", {
    scope: "world",
    config: false,
    default: null,
    type: Object,
  });
});

Hooks.once("ready", () => {
  const stored = game.settings.get(MODULE_ID, "montageState") as object | null;
  if (stored && typeof stored === "object") {
    montageState = restoreState(stored);
  }

  game.socket?.on(SOCKET_NAME, (payload: { type?: string; actorId?: string; actionType?: string; characteristic?: string; narrative?: string }) => {
    if (!game.user?.isGM || payload?.type !== "submitIntent") return;
    const { actorId, actionType, characteristic, narrative } = payload;
    if (!actorId || !montageState) return;
    if (actionType === "abstain") {
      abstain(montageState, actorId);
    } else {
      submitIntent(montageState, actorId, (actionType as "test" | "assist") ?? "abstain", characteristic, narrative);
    }
    persistState();
    getDirectorApp().refresh();
  });
});

function serializeState(s: MontageState): object {
  const roundStatesArr: [number, unknown[]][] = [];
  s.roundStates.forEach((v, k) => roundStatesArr.push([k, v]));
  const usedCharArr: [string, string[]][] = [];
  s.usedCharacteristics.forEach((v, k) => usedCharArr.push([k, [...v]]));
  return {
    ...s,
    roundStates: roundStatesArr,
    usedCharacteristics: usedCharArr,
  };
}

function restoreState(raw: object): MontageState {
  const s = raw as Partial<MontageState> & { roundStates?: [number, unknown[]][]; usedCharacteristics?: [string, string[]][] };
  const roundStates = new Map<number, MontageState["roundStates"] extends Map<number, infer V> ? V : never>();
  if (Array.isArray(s.roundStates)) {
    s.roundStates.forEach(([k, v]) => roundStates.set(k, v as never));
  }
  const usedCharacteristics = new Map<string, Set<string>>();
  if (Array.isArray(s.usedCharacteristics)) {
    s.usedCharacteristics.forEach(([k, arr]) => usedCharacteristics.set(k, new Set(arr as string[])));
  }
  return {
    ...s,
    roundStates,
    usedCharacteristics,
    config: s.config as MontageConfig,
    participants: s.participants ?? [],
    pendingApprovals: s.pendingApprovals ?? [],
  } as MontageState;
}

function persistState(): void {
  if (!montageState) return;
  try {
    game.settings.set(MODULE_ID, "montageState", serializeState(montageState) as unknown as Record<string, unknown>);
  } catch (e) {
    console.warn("Montage state persist failed:", e);
  }
}


Hooks.on("drawsteel-montage:openConfig", async (app: DirectorMontageApp) => {
  const heroes = getHeroActors();
  if (!heroes.length) {
    ui.notifications?.warn("No hero actors in the world.");
    return;
  }

  const { successLimit, failureLimit } = computeLimits("moderate", heroes.length);

  const content = await renderTemplate(`modules/${MODULE_ID}/templates/config-dialog.hbs`, {
    title: "Montage Test",
    description: "",
    difficulty: "moderate",
    visibility: false,
    useCustomLimits: false,
    successLimit,
    failureLimit,
  });

  new Dialog(
    {
      title: game.i18n.localize("DRAWSTEEL_MONTAGE.DirectorApp.NewTest"),
      content,
      buttons: {
        start: {
          icon: '<i class="fa-solid fa-play"></i>',
          label: "Start",
          callback: (html: JQuery) => {
            const form = html[0].querySelector("form");
            if (!form) return;
            const fd = new FormData(form as HTMLFormElement);
            const title = (fd.get("title") as string) || "Montage Test";
            const description = (fd.get("description") as string) || "";
            const difficulty = (fd.get("difficulty") as "easy" | "moderate" | "hard") || "moderate";
            const visibility = fd.has("visibility") ? "visible" : "hidden";
            const useCustom = fd.has("useCustomLimits");
            const successLimit = useCustom ? Number(fd.get("successLimit")) || 6 : undefined;
            const failureLimit = useCustom ? Number(fd.get("failureLimit")) || 4 : undefined;

            const config: MontageConfig = {
              id: foundry.utils.randomID(),
              title,
              description,
              difficulty,
              visibility: visibility as "hidden" | "visible",
              successLimit,
              failureLimit,
              maxRounds: 2,
              groupSize: heroes.length,
            };

            montageState = createMontageState(config, heroes);
            persistState();
            getDirectorApp().setState(montageState);
            getDirectorApp().render(true);
            Hooks.callAll("drawsteel-montage:testStarted", montageState);
          },
        },
        cancel: {
          icon: '<i class="fa-solid fa-times"></i>',
          label: "Cancel",
        },
      },
    },
    { width: 400 }
  ).render(true);
});

Hooks.on("drawsteel-montage:endTest", () => {
  if (montageState?.outcome) {
    postOutcomeToChat(montageState);
  }
  montageState = null;
  game.settings.set(MODULE_ID, "montageState", null);
  getDirectorApp().setState(null);
  getDirectorApp().render(true);
  Hooks.callAll("drawsteel-montage:testEnded");
});

Hooks.on("drawsteel-montage:approve", async (_app: unknown, approvalId: string) => {
  if (!montageState) return;
  const approval = montageState.pendingApprovals.find((a) => a.id === approvalId);
  if (!approval) return;

  if (approval.actionType === "ability") {
    applyAbilityAutoSuccess(montageState, approvalId);
    persistState();
    getDirectorApp().refresh();
    tryAdvanceRound();
    return;
  }

  if ((approval.actionType === "test" || approval.actionType === "assist") && approval.characteristic) {
    const actor = game.actors?.get(approval.actorId) as foundry.documents.Actor & { rollCharacteristic?: (c: string, o?: object) => Promise<foundry.documents.ChatMessage | null> };
    if (actor && typeof actor.rollCharacteristic === "function") {
      try {
        const msg = await actor.rollCharacteristic(approval.characteristic, {
          difficulty: "medium",
          types: ["test"],
        });
        if (msg && montageState) {
          applyRollResult(montageState, approvalId, msg);
          persistState();
          getDirectorApp().refresh();
          tryAdvanceRound();
        }
      } catch (err) {
        console.error("Montage roll error:", err);
        ui.notifications?.error("Roll failed.");
      }
    }
  }
});

Hooks.on("drawsteel-montage:reject", (_app: unknown, approvalId: string) => {
  if (!montageState) return;
  rejectApproval(montageState, approvalId);
  persistState();
  getDirectorApp().refresh();
});

function tryAdvanceRound(): void {
  if (!montageState) return;
  if (!canAdvanceRound(montageState)) return;
  const advanced = advanceRound(montageState);
  persistState();
  if (!advanced) {
    const outcome = finalizeOutcome(montageState);
    if (outcome) {
      postOutcomeToChat(montageState);
    }
  }
  getDirectorApp().refresh();
}

function postOutcomeToChat(state: MontageState): void {
  const outcomeLabels: Record<string, string> = {
    totalSuccess: game.i18n.localize("DRAWSTEEL_MONTAGE.Outcomes.TotalSuccess"),
    partialSuccess: game.i18n.localize("DRAWSTEEL_MONTAGE.Outcomes.PartialSuccess"),
    totalFailure: game.i18n.localize("DRAWSTEEL_MONTAGE.Outcomes.TotalFailure"),
  };
  const label = state.outcome ? outcomeLabels[state.outcome] ?? state.outcome : "";
  const victories = getVictoryCount(state.outcome!, state.config.difficulty);

  let content = `<h3>${label}</h3><p>${state.config.title}</p><p>Successes: ${state.successes} | Failures: ${state.failures}</p>`;
  if (victories > 0) {
    const vicKey =
      state.outcome === "totalSuccess" && state.config.difficulty === "hard"
        ? "DRAWSTEEL_MONTAGE.Victory.Hard"
        : "DRAWSTEEL_MONTAGE.Victory.EasyModerate";
    content += `<p><strong>${game.i18n.localize(vicKey)}</strong></p>`;
  } else if (state.outcome === "partialSuccess" && state.config.difficulty !== "easy") {
    content += `<p><strong>${game.i18n.localize("DRAWSTEEL_MONTAGE.Victory.Partial")}</strong></p>`;
  }

  ChatMessage.create({
    speaker: { alias: "Montage Test" },
    content,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER,
  });
}

Hooks.on("drawsteel-montage:submitIntent", (_app: unknown, actorId: string, actionType: "test" | "assist" | "abstain", characteristic?: string, narrative?: string) => {
  if (!montageState) return { ok: false, error: "No active montage" };
  return submitIntent(montageState, actorId, actionType, characteristic, narrative);
});

Hooks.on("drawsteel-montage:abstain", (_app: unknown, actorId: string) => {
  if (!montageState) return { ok: false, error: "No active montage" };
  return abstain(montageState, actorId);
});

Hooks.on("drawsteel-montage:getState", () => montageState);

Hooks.on("drawsteel-montage:openPlayerPanel", async () => {
  const state =
    game.user?.isGM && montageState
      ? montageState
      : (() => {
          const raw = game.settings.get(MODULE_ID, "montageState") as object | null;
          return raw && typeof raw === "object" && "config" in raw ? restoreState(raw) : null;
        })();
  await openPlayerRoundPanel(state);
});

Hooks.on("drawsteel-montage:openDirectorApp", () => {
  const app = getDirectorApp();
  app.setState(montageState);
  app.render(true);
});

Hooks.once("setup", () => {
  game.keyboard?.registerShortcut?.({
    key: "KeyM",
    modifiers: ["Control"],
    down: () => {
      if (game.user?.isGM) Hooks.callAll("drawsteel-montage:openDirectorApp");
    },
  });
  game.keyboard?.registerShortcut?.({
    key: "KeyM",
    modifiers: ["Alt"],
    down: () => {
      Hooks.callAll("drawsteel-montage:openPlayerPanel");
    },
  });
});

Hooks.on("getActorDirectoryEntryContext", (_app: Application, entryOptions: { name: string; icon: string; callback: (li: JQuery) => void }[]) => {
  if (!game.user?.isGM) return;
  entryOptions.push({
    name: "Montage Test",
    icon: "<i class='fa-solid fa-film'></i>",
    callback: () => Hooks.callAll("drawsteel-montage:openDirectorApp"),
  });
});

console.log(`${MODULE_ID} initialized`);
