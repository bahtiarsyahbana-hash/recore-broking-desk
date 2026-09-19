/**
 * Bordereaux processing — periodic premium and loss returns from cedants,
 * matched to treaty terms and posted to the technical account.
 */
import { mount, onAction } from "../../core/dom.js";
import { fmtFull } from "../../core/format.js";
import { state } from "../../core/store.js";
import { on, TOPICS } from "../../core/events.js";
import { statusPill } from "../../ui/badges.js";
import { icons } from "../../ui/icons.js";
import { receiveBordereau } from "../../services/bordereaux.service.js";

const rows = () => state.bordereaux.map((b) => `<tr>
    <td>${b.period}</td>
    <td>${b.program}</td>
    <td>${b.type}</td>
    <td class="num">${b.lines}</td>
    <td class="num">${fmtFull(b.amount)}</td>
    <td>${statusPill(b.status)}</td>
  </tr>`).join("");

export const bordereauxView = {
  id: "bordereaux",

  render: () => `<section class="view">
    <div class="view-head">
      <div>
        <h1>Bordereaux Processing</h1>
        <p>Premium and loss bordereaux, matched to treaty terms and posted straight to the technical account.</p>
      </div>
      <button class="btn primary" data-action="upload">${icons.upload}Upload Bordereau</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Period</th><th>Cedant / Program</th><th>Type</th>
          <th class="num">Lines</th><th class="num">Amount</th><th>Status</th>
        </tr></thead>
        <tbody id="bdx-body"></tbody>
      </table>
    </div>
  </section>`,

  mount() {
    onAction("#view-root", { "upload": () => receiveBordereau() });
  },

  refresh() {
    mount("#bdx-body", rows());
  },
};

on(TOPICS.BORDEREAUX, () => {
  if (document.getElementById("bdx-body")) bordereauxView.refresh();
});
