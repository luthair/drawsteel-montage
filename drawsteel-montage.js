// src/module/montage/rules.ts
var BASE_LIMITS = {
  easy: { success: 5, failure: 5 },
  moderate: { success: 6, failure: 4 },
  hard: { success: 7, failure: 3 }
};
function computeLimits(difficulty, groupSize) {
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
function computeOutcome(successes, failures, successLimit, failureLimit, roundEndedByLimit) {
  if (successes >= successLimit) return "totalSuccess";
  if (failures >= failureLimit || roundEndedByLimit) {
    return successes >= failures + 2 ? "partialSuccess" : "totalFailure";
  }
  return null;
}
function getVictoryCount(outcome, difficulty) {
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

// src/module/montage/controller.ts
function generateId() {
  return foundry.utils.randomID();
}
function hasHumanDeterminationPerk(actor) {
  if (!actor?.items) return false;
  const hasHumanAncestry = actor.items.some(
    (i) => i.type === "ancestry" && i.name.toLowerCase().includes("human")
  );
  if (!hasHumanAncestry) return false;
  const hasDetermination = actor.items.some(
    (i) => i.system?._dsid === "determination" || i.name.toLowerCase() === "determination"
  );
  return hasDetermination;
}
function isDrawSteelHero(actor) {
  return actor?.type === "hero" && game.system.id === "draw-steel";
}
function createMontageState(config, actors) {
  const participants = actors.filter(isDrawSteelHero).map((a) => {
    const owner = game.users?.find((u) => !u.isGM && a.testUserPermission?.(u, "OWNER"));
    return {
      actorId: a.id,
      actorName: a.name ?? "",
      playerId: owner?.id ?? null,
      hasHumanAssistPerk: hasHumanDeterminationPerk(a)
    };
  });
  const { successLimit, failureLimit } = config.successLimit != null && config.failureLimit != null ? { successLimit: config.successLimit, failureLimit: config.failureLimit } : computeLimits(config.difficulty, config.groupSize);
  return {
    config: {
      ...config,
      successLimit,
      failureLimit
    },
    participants,
    currentRound: 1,
    successes: 0,
    failures: 0,
    roundStates: /* @__PURE__ */ new Map(),
    pendingApprovals: [],
    usedCharacteristics: /* @__PURE__ */ new Map(),
    outcome: null,
    startedAt: Date.now()
  };
}
function getRoundState(state, round) {
  let rs = state.roundStates.get(round);
  if (!rs) {
    rs = state.participants.map((p) => ({
      actorId: p.actorId,
      participating: false,
      actionType: null,
      characteristic: void 0,
      narrative: void 0
    }));
    state.roundStates.set(round, rs);
  }
  return rs;
}
function submitIntent(state, actorId, actionType, characteristic, narrative) {
  const round = state.currentRound;
  const rs = getRoundState(state, round);
  const pr = rs.find((r) => r.actorId === actorId);
  if (!pr) return { ok: false, error: "Participant not found" };
  if (pr.actionType !== null)
    return { ok: false, error: "Already acted this round" };
  const used = state.usedCharacteristics.get(actorId) ?? /* @__PURE__ */ new Set();
  if (actionType === "test" || actionType === "assist") {
    if (!characteristic)
      return { ok: false, error: "Characteristic required" };
    if (used.has(characteristic))
      return { ok: false, error: "Characteristic already used this montage" };
  }
  const participant = state.participants.find((p) => p.actorId === actorId);
  const approval = {
    id: generateId(),
    actorId,
    actorName: participant.actorName,
    actionType,
    characteristic,
    narrative,
    submittedAt: Date.now()
  };
  pr.participating = true;
  pr.actionType = actionType;
  pr.characteristic = characteristic;
  pr.narrative = narrative;
  state.pendingApprovals.push(approval);
  return { ok: true };
}
function abstain(state, actorId) {
  const rs = getRoundState(state, state.currentRound);
  const pr = rs.find((r) => r.actorId === actorId);
  if (!pr) return { ok: false, error: "Participant not found" };
  if (pr.actionType !== null) return { ok: false, error: "Already acted" };
  pr.participating = true;
  pr.actionType = "abstain";
  return { ok: true };
}
function rejectApproval(state, approvalId) {
  const idx = state.pendingApprovals.findIndex((a2) => a2.id === approvalId);
  if (idx < 0) return false;
  const a = state.pendingApprovals[idx];
  state.pendingApprovals.splice(idx, 1);
  const rs = getRoundState(state, state.currentRound);
  const pr = rs.find((r) => r.actorId === a.actorId);
  if (pr) {
    pr.actionType = null;
    pr.characteristic = void 0;
    pr.narrative = void 0;
  }
  return true;
}
function tierToSuccess(tier) {
  return tier === 3;
}
function getTierFromMessage(message) {
  try {
    const msg = message;
    if (msg.rolls?.length) {
      const last = msg.rolls.at(-1);
      if (typeof last?.product === "number") return last.product;
    }
    const parts = message.system?.parts;
    if (!Array.isArray(parts)) return void 0;
    const testPart = parts.find((p) => p?.type === "test");
    if (!testPart?.rolls?.length) return void 0;
    const lastRoll = testPart.rolls.at(-1);
    if (!lastRoll) return void 0;
    const ds = globalThis.ds;
    const RollClass = ds?.rolls?.PowerRoll ?? ds?.rolls?.DSRoll;
    if (!RollClass?.fromData) return void 0;
    const rollData = typeof lastRoll === "string" ? JSON.parse(lastRoll) : lastRoll;
    const pr = RollClass.fromData(rollData);
    return pr?.product;
  } catch {
    return void 0;
  }
}
function applyAbilityAutoSuccess(state, approvalId) {
  const idx = state.pendingApprovals.findIndex((a) => a.id === approvalId);
  if (idx < 0) return false;
  state.pendingApprovals.splice(idx, 1);
  state.successes += 1;
  return true;
}
function applyRollResult(state, approvalId, message) {
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
      used = /* @__PURE__ */ new Set();
      state.usedCharacteristics.set(approval.actorId, used);
    }
    used.add(approval.characteristic);
  }
  return true;
}
function advanceRound(state) {
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
function canAdvanceRound(state) {
  const rs = getRoundState(state, state.currentRound);
  const acted = rs.filter((r) => r.actionType !== null).length;
  return acted >= state.participants.length && state.pendingApprovals.length === 0;
}
function finalizeOutcome(state) {
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

// src/module/ui/director-app.ts
var MODULE_ID = "drawsteel-montage";
var { HandlebarsApplicationMixin, Application } = foundry.applications.api;
var DirectorMontageApp = class extends HandlebarsApplicationMixin(Application) {
  static get defaultOptions() {
    return {
      ...super.defaultOptions,
      id: "drawsteel-montage-director",
      title: game.i18n.localize("DRAWSTEEL_MONTAGE.DirectorApp.Title"),
      template: `modules/${MODULE_ID}/templates/director-app.hbs`,
      width: 420,
      height: "auto",
      resizable: true,
      popOut: true,
      classes: ["drawsteel-montage", "director-app"]
    };
  }
  #state = null;
  get state() {
    return this.#state;
  }
  setState(state) {
    this.#state = state;
    this.render(true);
  }
  getData() {
    const s = this.#state;
    if (!s) {
      return {
        active: false,
        title: "Montage Test"
      };
    }
    const outcomeLabels = {
      totalSuccess: game.i18n.localize("DRAWSTEEL_MONTAGE.Outcomes.TotalSuccess"),
      partialSuccess: game.i18n.localize("DRAWSTEEL_MONTAGE.Outcomes.PartialSuccess"),
      totalFailure: game.i18n.localize("DRAWSTEEL_MONTAGE.Outcomes.TotalFailure")
    };
    return {
      active: true,
      title: s.config.title,
      successes: s.successes,
      failures: s.failures,
      successLimit: s.config.successLimit,
      failureLimit: s.config.failureLimit,
      showLimits: s.config.visibility === "visible",
      currentRound: s.currentRound,
      roundLabel: game.i18n.format("DRAWSTEEL_MONTAGE.DirectorApp.Round", { n: s.currentRound }),
      pendingApprovals: s.pendingApprovals.map((a) => ({
        id: a.id,
        actorName: a.actorName,
        actionType: a.actionType,
        characteristic: a.characteristic
      })),
      outcome: s.outcome,
      outcomeLabel: s.outcome ? outcomeLabels[s.outcome] ?? s.outcome : ""
    };
  }
  activateListeners(html) {
    super.activateListeners(html);
    html.find("[data-action=newTest]").on("click", () => this.#onNewTest());
    html.find("[data-action=endTest]").on("click", () => this.#onEndTest());
    html.find("[data-action=approve]").on("click", (ev) => {
      const id = ev.currentTarget.dataset.approvalId;
      if (id) this.#onApprove(id);
    });
    html.find("[data-action=reject]").on("click", (ev) => {
      const id = ev.currentTarget.dataset.approvalId;
      if (id) this.#onReject(id);
    });
  }
  #onNewTest() {
    Hooks.callAll("drawsteel-montage:openConfig", this);
  }
  #onEndTest() {
    Hooks.callAll("drawsteel-montage:endTest", this);
  }
  #onApprove(approvalId) {
    Hooks.callAll("drawsteel-montage:approve", this, approvalId);
  }
  #onReject(approvalId) {
    Hooks.callAll("drawsteel-montage:reject", this, approvalId);
  }
  /** Called by main module to update after state change */
  refresh() {
    if (this.rendered) this.render(true);
  }
};

// src/module/montage/domain.ts
var DRAW_STEEL_CHARACTERISTICS = [
  "might",
  "agility",
  "reason",
  "intuition",
  "presence"
];

// src/module/ui/player-round-panel.ts
var MODULE_ID2 = "drawsteel-montage";
async function openPlayerRoundPanel(state) {
  if (!state) {
    ui.notifications?.info("No active montage test.");
    return;
  }
  const round = state.currentRound;
  const rs = getRoundState(state, round);
  const myActorId = state.participants.find((p) => p.playerId === game.user?.id)?.actorId;
  const myRoundState = myActorId ? rs.find((r) => r.actorId === myActorId) : null;
  const canAct = myRoundState && myRoundState.actionType === null;
  if (!canAct) {
    ui.notifications?.info("You have already acted or are not a participant this round.");
    return;
  }
  const usedChar = myActorId ? state.usedCharacteristics.get(myActorId) ?? /* @__PURE__ */ new Set() : /* @__PURE__ */ new Set();
  const dsChars = globalThis.ds?.CONFIG?.characteristics;
  const charOptions = DRAW_STEEL_CHARACTERISTICS.filter((id) => !usedChar.has(id)).map((id) => {
    const label = dsChars?.[id]?.label ? game.i18n.localize(dsChars[id].label) : id;
    return `<option value="${id}">${label}</option>`;
  }).join("");
  const content = `
    <form class="drawsteel-montage player-panel-form">
      <p><strong>Round ${round}</strong></p>
      <div class="form-group">
        <label>Action</label>
        <select name="actionType">
          <option value="test">Make Test</option>
          <option value="assist">Assist</option>
          <option value="abstain">Abstain</option>
        </select>
      </div>
      <div class="form-group char-group">
        <label>Characteristic</label>
        <select name="characteristic">${charOptions || "<option value=''>\u2014</option>"}</select>
      </div>
      <div class="form-group">
        <label>Narrative (optional)</label>
        <input type="text" name="narrative" placeholder="Brief description" />
      </div>
    </form>`;
  new Dialog(
    {
      title: game.i18n.localize("DRAWSTEEL_MONTAGE.PlayerPanel.Title"),
      content,
      buttons: {
        submit: {
          icon: '<i class="fa-solid fa-check"></i>',
          label: "Submit",
          callback: (html) => {
            const form = html[0].querySelector("form");
            if (!form || !myActorId) return;
            const fd = new FormData(form);
            const actionType = fd.get("actionType") || "abstain";
            const characteristic = fd.get("characteristic");
            const narrative = fd.get("narrative") || void 0;
            if (game.user?.isGM) {
              if (actionType === "abstain") {
                const r = abstain(state, myActorId);
                if (!r.ok) ui.notifications?.warn(r.error);
              } else {
                const r = submitIntent(state, myActorId, actionType, characteristic, narrative);
                if (!r.ok) ui.notifications?.warn(r.error);
              }
              Hooks.callAll("drawsteel-montage:playerSubmitted");
            } else {
              game.socket?.emit(`module.${MODULE_ID2}`, {
                type: "submitIntent",
                actorId: myActorId,
                actionType,
                characteristic,
                narrative
              });
              ui.notifications?.info("Intent submitted to the Director.");
            }
          }
        },
        cancel: {
          icon: '<i class="fa-solid fa-times"></i>',
          label: "Cancel"
        }
      }
    },
    { width: 360 }
  ).render(true);
}

// src/module/main.ts
var MODULE_ID3 = "drawsteel-montage";
var SOCKET_NAME = `module.${MODULE_ID3}`;
var directorApp = null;
var montageState = null;
function getDirectorApp() {
  if (!directorApp) {
    directorApp = new DirectorMontageApp();
  }
  return directorApp;
}
function isDrawSteelReady() {
  return game.system?.id === "draw-steel" && typeof globalThis.ds !== "undefined";
}
function getHeroActors() {
  if (!game.actors) return [];
  return game.actors.filter((a) => a.type === "hero");
}
Hooks.once("init", () => {
  if (!isDrawSteelReady()) {
    console.warn(`${MODULE_ID3}: Draw Steel system not detected. Module may not function correctly.`);
  }
  game.settings.register(MODULE_ID3, "montageState", {
    scope: "world",
    config: false,
    default: null,
    type: Object
  });
});
Hooks.once("ready", () => {
  const stored = game.settings.get(MODULE_ID3, "montageState");
  if (stored && typeof stored === "object") {
    montageState = restoreState(stored);
  }
  game.socket?.on(SOCKET_NAME, (payload) => {
    if (!game.user?.isGM || payload?.type !== "submitIntent") return;
    const { actorId, actionType, characteristic, narrative } = payload;
    if (!actorId || !montageState) return;
    if (actionType === "abstain") {
      abstain(montageState, actorId);
    } else {
      submitIntent(montageState, actorId, actionType ?? "abstain", characteristic, narrative);
    }
    persistState();
    getDirectorApp().refresh();
  });
});
function serializeState(s) {
  const roundStatesArr = [];
  s.roundStates.forEach((v, k) => roundStatesArr.push([k, v]));
  const usedCharArr = [];
  s.usedCharacteristics.forEach((v, k) => usedCharArr.push([k, [...v]]));
  return {
    ...s,
    roundStates: roundStatesArr,
    usedCharacteristics: usedCharArr
  };
}
function restoreState(raw) {
  const s = raw;
  const roundStates = /* @__PURE__ */ new Map();
  if (Array.isArray(s.roundStates)) {
    s.roundStates.forEach(([k, v]) => roundStates.set(k, v));
  }
  const usedCharacteristics = /* @__PURE__ */ new Map();
  if (Array.isArray(s.usedCharacteristics)) {
    s.usedCharacteristics.forEach(([k, arr]) => usedCharacteristics.set(k, new Set(arr)));
  }
  return {
    ...s,
    roundStates,
    usedCharacteristics,
    config: s.config,
    participants: s.participants ?? [],
    pendingApprovals: s.pendingApprovals ?? []
  };
}
function persistState() {
  if (!montageState) return;
  try {
    game.settings.set(MODULE_ID3, "montageState", serializeState(montageState));
  } catch (e) {
    console.warn("Montage state persist failed:", e);
  }
}
Hooks.on("drawsteel-montage:openConfig", async (app) => {
  const heroes = getHeroActors();
  if (!heroes.length) {
    ui.notifications?.warn("No hero actors in the world.");
    return;
  }
  const { successLimit, failureLimit } = computeLimits("moderate", heroes.length);
  const content = await renderTemplate(`modules/${MODULE_ID3}/templates/config-dialog.hbs`, {
    title: "Montage Test",
    description: "",
    difficulty: "moderate",
    visibility: false,
    useCustomLimits: false,
    successLimit,
    failureLimit
  });
  new Dialog(
    {
      title: game.i18n.localize("DRAWSTEEL_MONTAGE.DirectorApp.NewTest"),
      content,
      buttons: {
        start: {
          icon: '<i class="fa-solid fa-play"></i>',
          label: "Start",
          callback: (html) => {
            const form = html[0].querySelector("form");
            if (!form) return;
            const fd = new FormData(form);
            const title = fd.get("title") || "Montage Test";
            const description = fd.get("description") || "";
            const difficulty = fd.get("difficulty") || "moderate";
            const visibility = fd.has("visibility") ? "visible" : "hidden";
            const useCustom = fd.has("useCustomLimits");
            const successLimit2 = useCustom ? Number(fd.get("successLimit")) || 6 : void 0;
            const failureLimit2 = useCustom ? Number(fd.get("failureLimit")) || 4 : void 0;
            const config = {
              id: foundry.utils.randomID(),
              title,
              description,
              difficulty,
              visibility,
              successLimit: successLimit2,
              failureLimit: failureLimit2,
              maxRounds: 2,
              groupSize: heroes.length
            };
            montageState = createMontageState(config, heroes);
            persistState();
            getDirectorApp().setState(montageState);
            getDirectorApp().render(true);
            Hooks.callAll("drawsteel-montage:testStarted", montageState);
          }
        },
        cancel: {
          icon: '<i class="fa-solid fa-times"></i>',
          label: "Cancel"
        }
      }
    },
    { width: 400 }
  ).render(true);
});
Hooks.on("drawsteel-montage:endTest", () => {
  if (montageState?.outcome) {
    postOutcomeToChat(montageState);
  }
  montageState = null;
  game.settings.set(MODULE_ID3, "montageState", null);
  getDirectorApp().setState(null);
  getDirectorApp().render(true);
  Hooks.callAll("drawsteel-montage:testEnded");
});
Hooks.on("drawsteel-montage:approve", async (_app, approvalId) => {
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
    const actor = game.actors?.get(approval.actorId);
    if (actor && typeof actor.rollCharacteristic === "function") {
      try {
        const msg = await actor.rollCharacteristic(approval.characteristic, {
          difficulty: "medium",
          types: ["test"]
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
Hooks.on("drawsteel-montage:reject", (_app, approvalId) => {
  if (!montageState) return;
  rejectApproval(montageState, approvalId);
  persistState();
  getDirectorApp().refresh();
});
function tryAdvanceRound() {
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
function postOutcomeToChat(state) {
  const outcomeLabels = {
    totalSuccess: game.i18n.localize("DRAWSTEEL_MONTAGE.Outcomes.TotalSuccess"),
    partialSuccess: game.i18n.localize("DRAWSTEEL_MONTAGE.Outcomes.PartialSuccess"),
    totalFailure: game.i18n.localize("DRAWSTEEL_MONTAGE.Outcomes.TotalFailure")
  };
  const label = state.outcome ? outcomeLabels[state.outcome] ?? state.outcome : "";
  const victories = getVictoryCount(state.outcome, state.config.difficulty);
  let content = `<h3>${label}</h3><p>${state.config.title}</p><p>Successes: ${state.successes} | Failures: ${state.failures}</p>`;
  if (victories > 0) {
    const vicKey = state.outcome === "totalSuccess" && state.config.difficulty === "hard" ? "DRAWSTEEL_MONTAGE.Victory.Hard" : "DRAWSTEEL_MONTAGE.Victory.EasyModerate";
    content += `<p><strong>${game.i18n.localize(vicKey)}</strong></p>`;
  } else if (state.outcome === "partialSuccess" && state.config.difficulty !== "easy") {
    content += `<p><strong>${game.i18n.localize("DRAWSTEEL_MONTAGE.Victory.Partial")}</strong></p>`;
  }
  ChatMessage.create({
    speaker: { alias: "Montage Test" },
    content,
    type: CONST.CHAT_MESSAGE_TYPES.OTHER
  });
}
Hooks.on("drawsteel-montage:submitIntent", (_app, actorId, actionType, characteristic, narrative) => {
  if (!montageState) return { ok: false, error: "No active montage" };
  return submitIntent(montageState, actorId, actionType, characteristic, narrative);
});
Hooks.on("drawsteel-montage:abstain", (_app, actorId) => {
  if (!montageState) return { ok: false, error: "No active montage" };
  return abstain(montageState, actorId);
});
Hooks.on("drawsteel-montage:getState", () => montageState);
Hooks.on("drawsteel-montage:openPlayerPanel", async () => {
  const state = game.user?.isGM && montageState ? montageState : (() => {
    const raw = game.settings.get(MODULE_ID3, "montageState");
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
    }
  });
  game.keyboard?.registerShortcut?.({
    key: "KeyM",
    modifiers: ["Alt"],
    down: () => {
      Hooks.callAll("drawsteel-montage:openPlayerPanel");
    }
  });
});
Hooks.on("getActorDirectoryEntryContext", (_app, entryOptions) => {
  if (!game.user?.isGM) return;
  entryOptions.push({
    name: "Montage Test",
    icon: "<i class='fa-solid fa-film'></i>",
    callback: () => Hooks.callAll("drawsteel-montage:openDirectorApp")
  });
});
console.log(`${MODULE_ID3} initialized`);
//# sourceMappingURL=drawsteel-montage.js.map
