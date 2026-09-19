/**
 * Cedant portal — Submit a Risk or Renewal.
 *
 * Sends a structured request into the desk's placement queue. It creates a
 * pending submission, never a program: a broker works it up into a slip.
 */
import { $, mount, onAction } from "../../core/dom.js";
import { fmt } from "../../core/format.js";
import { state } from "../../core/store.js";
import { on, TOPICS } from "../../core/events.js";
import { statusPill, emptyState } from "../../ui/badges.js";
import { submitRisk } from "../../services/submission.service.js";

const CLASSES = ["Property", "Casualty", "Marine", "Motor"];
const TYPES = ["Facultative", "Quota Share", "Surplus", "Excess of Loss"];
const options = (list) => list.map((v) => `<option>${v}</option>`).join("");

function pendingRows() {
  if (!state.pendingSubmissions.length) {
    return emptyState("No open submissions — everything is placed.");
  }
  return state.pendingSubmissions.map((s) => `<div style="display:flex; justify-content:space-between; padding:9px 0; border-bottom:1px solid var(--line-soft); font-size:13px;">
      <span>${s.cls} · ${s.type} · ${fmt(s.amount)}</span>${statusPill("Renewal Due")}
    </div>`).join("");
}

export const cedantSubmitView = {
  id: "c-submit",

  render: () => `<section class="view">
    <div class="view-head">
      <div><h1>Submit a Risk or Renewal</h1><p>Sends a structured request straight into your broker's placement queue.</p></div>
    </div>
    <div class="card" style="max-width:560px;">
      <div class="field"><label>Class of business</label><select id="cs-class">${options(CLASSES)}</select></div>
      <div class="field-row">
        <div class="field"><label>Requested type</label><select id="cs-type">${options(TYPES)}</select></div>
        <div class="field"><label>Sum insured / estimated GNPI</label><input type="number" id="cs-amount" value="5000000" step="50000"></div>
      </div>
      <div class="field"><label>Notes for your broker</label>
        <textarea id="cs-notes" rows="3" placeholder="Anything the placement team should know — loss history, timing, target markets...">Renewal terms as expiring, please; new warehouse location added mid-term.</textarea>
      </div>
      <button class="btn primary" data-action="submit-risk">Send to broker</button>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="panel-title">Pending with your broker</div>
      <div id="c-pending"></div>
    </div>
  </section>`,

  mount() {
    onAction("#view-root", {
      "submit-risk": () => submitRisk({
        cls: $("#cs-class").value,
        type: $("#cs-type").value,
        amount: +$("#cs-amount").value,
        notes: $("#cs-notes").value,
      }),
    });
  },

  refresh() {
    mount("#c-pending", pendingRows());
  },
};

on(TOPICS.SUBMISSIONS, () => {
  if (document.getElementById("c-pending")) cedantSubmitView.refresh();
});
