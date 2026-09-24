/**
 * Cedant portal — Account Statement.
 *
 * The cedant's own side of the technical account: what was ceded, what
 * commission was earned, what has been recovered on claims.
 */
import { BROKING_FIRM } from "../../core/config.js";
import { mount, row } from "../../core/dom.js";
import { fmtFull } from "../../core/format.js";
import { programsForCedant, currentCedant } from "../../core/store.js";
import { on, TOPICS } from "../../core/events.js";
import { technicalAccount } from "../../domain/technical-account.js";
import { emptyState } from "../../ui/badges.js";

function statement() {
  const mine = programsForCedant(currentCedant());
  // The treaty program carries the statement; fall back to whatever exists.
  const program = mine[1] || mine[0];
  if (!program) return emptyState("No programs placed yet.");

  const t = technicalAccount(program);
  return row("Treaty premium ceded YTD", fmtFull(t.ceded))
    + row("Ceding commission earned", fmtFull(t.cedingCommission))
    + row("Claims recovered YTD", fmtFull(t.claims))
    + row("Balance due from broker", fmtFull(t.cedingCommission));
}

export const cedantStatementView = {
  id: "c-statement",

  render: () => `<section class="view">
    <div class="view-head">
      <div><h1>Account Statement</h1><p>Your treaty account with ${BROKING_FIRM}.</p></div>
    </div>
    <div class="card" style="max-width:560px;">
      <div class="calc-out" id="c-statement-out"></div>
    </div>
  </section>`,

  refresh() {
    mount("#c-statement-out", statement());
  },
};

[TOPICS.PROGRAMS, TOPICS.CLAIMS].forEach((topic) =>
  on(topic, () => { if (document.getElementById("c-statement-out")) cedantStatementView.refresh(); })
);
