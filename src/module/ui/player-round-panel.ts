/**
 * Player-facing round participation panel.
 * Opens a Dialog for players to submit test/assist/abstain.
 */

import type { MontageState } from "../montage/domain.js";
import { getRoundState, submitIntent, abstain } from "../montage/controller.js";
import { DRAW_STEEL_CHARACTERISTICS } from "../montage/domain.js";

const MODULE_ID = "drawsteel-montage";

export async function openPlayerRoundPanel(state: MontageState | null): Promise<void> {
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

  const usedChar = myActorId ? state.usedCharacteristics.get(myActorId) ?? new Set() : new Set();
  const dsChars = (globalThis as { ds?: { CONFIG?: { characteristics?: Record<string, { label?: string }> } } }).ds?.CONFIG?.characteristics;
  const charOptions = DRAW_STEEL_CHARACTERISTICS.filter((id) => !usedChar.has(id))
    .map((id) => {
      const label = dsChars?.[id]?.label ? game.i18n.localize(dsChars[id].label) : id;
      return `<option value="${id}">${label}</option>`;
    })
    .join("");

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
        <select name="characteristic">${charOptions || "<option value=''>—</option>"}</select>
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
          callback: (html: JQuery) => {
            const form = html[0].querySelector("form");
            if (!form || !myActorId) return;
            const fd = new FormData(form as HTMLFormElement);
            const actionType = (fd.get("actionType") as string) || "abstain";
            const characteristic = fd.get("characteristic") as string | undefined;
            const narrative = (fd.get("narrative") as string) || undefined;

            if (game.user?.isGM) {
              if (actionType === "abstain") {
                const r = abstain(state, myActorId);
                if (!r.ok) ui.notifications?.warn(r.error);
              } else {
                const r = submitIntent(state, myActorId, actionType as "test" | "assist", characteristic, narrative);
                if (!r.ok) ui.notifications?.warn(r.error);
              }
              Hooks.callAll("drawsteel-montage:playerSubmitted");
            } else {
              game.socket?.emit(`module.${MODULE_ID}`, {
                type: "submitIntent",
                actorId: myActorId,
                actionType,
                characteristic,
                narrative,
              });
              ui.notifications?.info("Intent submitted to the Director.");
            }
          },
        },
        cancel: {
          icon: '<i class="fa-solid fa-times"></i>',
          label: "Cancel",
        },
      },
    },
    { width: 360 }
  ).render(true);
}
