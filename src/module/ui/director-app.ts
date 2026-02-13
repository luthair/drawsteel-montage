/**
 * Director (GM) Montage Test application.
 */

import type { MontageState, PendingApproval } from "../montage/domain.js";

const MODULE_ID = "drawsteel-montage";

const { HandlebarsApplicationMixin, Application } = foundry.applications.api;

export class DirectorMontageApp extends HandlebarsApplicationMixin(Application) {
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
      classes: ["drawsteel-montage", "director-app"],
    };
  }

  #state: MontageState | null = null;

  get state(): MontageState | null {
    return this.#state;
  }

  setState(state: MontageState | null): void {
    this.#state = state;
    this.render(true);
  }

  getData(): Record<string, unknown> {
    const s = this.#state;
    if (!s) {
      return {
        active: false,
        title: "Montage Test",
      };
    }

    const outcomeLabels: Record<string, string> = {
      totalSuccess: game.i18n.localize("DRAWSTEEL_MONTAGE.Outcomes.TotalSuccess"),
      partialSuccess: game.i18n.localize("DRAWSTEEL_MONTAGE.Outcomes.PartialSuccess"),
      totalFailure: game.i18n.localize("DRAWSTEEL_MONTAGE.Outcomes.TotalFailure"),
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
      pendingApprovals: s.pendingApprovals.map((a: PendingApproval) => ({
        id: a.id,
        actorName: a.actorName,
        actionType: a.actionType,
        characteristic: a.characteristic,
      })),
      outcome: s.outcome,
      outcomeLabel: s.outcome ? outcomeLabels[s.outcome] ?? s.outcome : "",
    };
  }

  activateListeners(html: JQuery): void {
    super.activateListeners(html);

    html.find("[data-action=newTest]").on("click", () => this.#onNewTest());
    html.find("[data-action=endTest]").on("click", () => this.#onEndTest());
    html.find("[data-action=approve]").on("click", (ev) => {
      const id = (ev.currentTarget as HTMLElement).dataset.approvalId;
      if (id) this.#onApprove(id);
    });
    html.find("[data-action=reject]").on("click", (ev) => {
      const id = (ev.currentTarget as HTMLElement).dataset.approvalId;
      if (id) this.#onReject(id);
    });
  }

  #onNewTest(): void {
    Hooks.callAll("drawsteel-montage:openConfig", this);
  }

  #onEndTest(): void {
    Hooks.callAll("drawsteel-montage:endTest", this);
  }

  #onApprove(approvalId: string): void {
    Hooks.callAll("drawsteel-montage:approve", this, approvalId);
  }

  #onReject(approvalId: string): void {
    Hooks.callAll("drawsteel-montage:reject", this, approvalId);
  }

  /** Called by main module to update after state change */
  refresh(): void {
    if (this.rendered) this.render(true);
  }
}
