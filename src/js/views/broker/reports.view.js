/**
 * Reports & exposure — loss ratio by program and signed capacity committed
 * across the reinsurer panel.
 */
import { mount } from "../../core/dom.js";
import { fmt } from "../../core/format.js";
import { state } from "../../core/store.js";
import { on, TOPICS } from "../../core/events.js";
import { committedCapacity } from "../../data/counterparties.data.js";
import { lossRatioByProgram } from "../../domain/portfolio.js";
import { lossRatioBars } from "../../ui/charts.js";

const exposureTable = () => `<div class="table-wrap"><table>
    <thead><tr><th>Reinsurer</th><th>Panel</th><th class="num">Committed capacity</th></tr></thead>
    <tbody>${state.markets.map((m) => `<tr>
      <td>${m.name}</td><td>${m.panel}</td>
      <td class="num">${fmt(committedCapacity[m.name] || 0)}</td>
    </tr>`).join("")}</tbody>
  </table></div>`;

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
        <div class="panel-title">Market accumulation</div>
        <div class="panel-sub">Signed capacity committed per reinsurer, all live programs</div>
        <div id="exposure-table"></div>
      </div>
    </div>
  </section>`,

  refresh() {
    mount("#chart-lr", lossRatioBars(lossRatioByProgram(state.programs)));
    mount("#exposure-table", exposureTable());
  },
};

// A market added to the registry belongs in the accumulation table too.
[TOPICS.PROGRAMS, TOPICS.REGISTRY].forEach((topic) =>
  on(topic, () => { if (document.getElementById("chart-lr")) reportsView.refresh(); })
);
