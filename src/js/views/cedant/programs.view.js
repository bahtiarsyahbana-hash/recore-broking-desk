/**
 * Cedant portal — My Programs.
 *
 * A read-only mirror of one cedant's own book. The portal is an optional,
 * restricted module: it never exposes another cedant's placements, the market
 * panel, or the desk's own accounting.
 */
import { BROKING_FIRM } from "../../core/config.js";
import { mount } from "../../core/dom.js";
import { fmtFull } from "../../core/format.js";
import { programsForCedant, currentCedant } from "../../core/store.js";
import { on, TOPICS } from "../../core/events.js";
import { statusPill, typeBadge } from "../../ui/badges.js";
import { icons } from "../../ui/icons.js";

const rows = () => programsForCedant(currentCedant()).map((p) => `<tr>
    <td><strong>${p.id}</strong></td>
    <td>${p.cls}</td>
    <td>${typeBadge(p.type)}</td>
    <td class="num">${fmtFull(p.premium, p.ccy)}</td>
    <td>${statusPill(p.status)}</td>
    <td>${p.expiry}</td>
  </tr>`).join("");

export const cedantProgramsView = {
  id: "c-programs",

  render: () => `<section class="view">
    <div class="view-head">
      <div>
        <h1>My Programs</h1>
        <p>Everything ${BROKING_FIRM} is placing on behalf of ${currentCedant()} — a read-only mirror of your own book.</p>
      </div>
    </div>
    <div class="banner neutral">${icons.info}The cedant portal is an optional, restricted view. Your broker sees the full placement, accounting and claims workspace — you see only your own programs, submissions and statements.</div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Program</th><th>Class</th><th>Type</th>
          <th class="num">Gross Premium</th><th>Status</th><th>Expiry</th>
        </tr></thead>
        <tbody id="c-programs-body"></tbody>
      </table>
    </div>
  </section>`,

  refresh() {
    mount("#c-programs-body", rows());
  },
};

on(TOPICS.PROGRAMS, () => {
  if (document.getElementById("c-programs-body")) cedantProgramsView.refresh();
});
