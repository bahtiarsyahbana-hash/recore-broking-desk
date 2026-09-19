/**
 * Reports & exposure — loss ratio by program and signed capacity committed
 * across the reinsurer panel.
 */
import { mount } from "../../core/dom.js";
import { fmt } from "../../core/format.js";
import { state } from "../../core/store.js";
import { pct } from "../../core/format.js";
import { LOSS_RATIO_WATCH_LINE } from "../../core/config.js";
import { on, TOPICS } from "../../core/events.js";
import { capacityLines } from "../../data/counterparties.data.js";
import {
  lossRatioByProgram, lossRatioByCedant,
  exposureByReinsurer, claimReserveByReinsurer,
} from "../../domain/portfolio.js";
import { lossRatioBars } from "../../ui/charts.js";

/**
 * Accumulation: what each market is actually carrying, against the line it
 * agreed to. Markets with no exposure are listed last rather than hidden —
 * unused capacity is information a broker wants when placing the next risk.
 */
function exposureTable() {
  const exposure = exposureByReinsurer(state.programs);
  const claimReserve = claimReserveByReinsurer(state.claims, state.programs);

  const rows = state.markets
    .map((m) => ({
      name: m.name,
      panel: m.panel,
      signed: exposure[m.name] || 0,
      line: capacityLines[m.name] || 0,
      reserve: claimReserve[m.name] || 0,
    }))
    .sort((a, b) => b.signed - a.signed);

  return `<div class="table-wrap"><table>
    <thead><tr>
      <th>Reinsurer</th><th>Panel</th>
      <th class="num">Signed exposure</th><th class="num">Capacity line</th>
      <th class="num">Used</th><th class="num">On open claims</th>
    </tr></thead>
    <tbody>${rows.map((r) => {
      const used = r.line ? r.signed / r.line * 100 : 0;
      return `<tr${r.signed ? "" : ' class="is-idle"'}>
        <td>${r.name}</td>
        <td>${r.panel}</td>
        <td class="num">${r.signed ? fmt(r.signed) : "—"}</td>
        <td class="num">${r.line ? fmt(r.line) : "—"}</td>
        <td class="num">${r.line && r.signed ? `<span class="pill ${used > 90 ? "warn" : "neutral"}" style="padding:1px 7px;">${used.toFixed(0)}%</span>` : "—"}</td>
        <td class="num">${r.reserve ? fmt(r.reserve) : "—"}</td>
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;
}

/** Which relationships are losing money, rather than which contracts are. */
const cedantLossTable = () => {
  const rows = lossRatioByCedant(state.programs);
  if (!rows.length) return `<div class="empty">No earned premium yet.</div>`;
  return `<div class="table-wrap compact"><table>
    <thead><tr><th>Cedant</th><th class="num">Earned</th><th class="num">Incurred</th><th class="num">Loss ratio</th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td>${r.cedant}</td>
      <td class="num">${fmt(r.earned)}</td>
      <td class="num">${fmt(r.loss)}</td>
      <td class="num"><span class="pill ${r.lossRatio > 90 ? "bad" : r.lossRatio > LOSS_RATIO_WATCH_LINE ? "warn" : "good"}" style="padding:1px 7px;">${pct(r.lossRatio)}</span></td>
    </tr>`).join("")}</tbody>
  </table></div>`;
};

export const reportsView = {
  id: "reports",

  render: () => `<section class="view">
    <div class="view-head">
      <div><h1>Reports &amp; Exposure</h1><p>Loss ratio by program and accumulation across the reinsurer panel.</p></div>
    </div>
    <div class="cols-2">
      <div class="card">
        <div class="panel-title">Loss ratio by program</div>
        <div class="panel-sub">Incurred claims ÷ earned premium, current underwriting year</div>
        <div id="chart-lr"></div>
      </div>
      <div class="card">
        <div class="panel-title">Loss ratio by cedant</div>
        <div class="panel-sub">Which relationships are losing money, not just which contracts</div>
        <div id="cedant-loss-table"></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="panel-title">Market accumulation</div>
      <div class="panel-sub">Exposure derived from the lines each market signed, against the capacity it agreed to make available</div>
      <div id="exposure-table"></div>
    </div>
  </section>`,

  refresh() {
    mount("#chart-lr", lossRatioBars(lossRatioByProgram(state.programs)));
    mount("#cedant-loss-table", cedantLossTable());
    mount("#exposure-table", exposureTable());
  },
};

// A market added to the registry belongs in the accumulation table too.
[TOPICS.PROGRAMS, TOPICS.REGISTRY, TOPICS.CLAIMS].forEach((topic) =>
  on(topic, () => { if (document.getElementById("chart-lr")) reportsView.refresh(); })
);
