/**
 * Cedant portal — Submit a Risk or Renewal.
 *
 * Sends a structured request into the broker's intake queue. It creates an
 * intake, never a program: a broker reviews it and works it up into a slip.
 */
import { $, mount, onAction } from "../../core/dom.js";
import { fmtFull } from "../../core/format.js";
import { on, TOPICS } from "../../core/events.js";
import { statusPill, emptyState } from "../../ui/badges.js";
import { submitRisk, pendingSubmissions } from "../../services/submission.service.js";
import { PLACEMENT_TYPES, PAYMENT_WARRANTY_DAYS } from "../../domain/intake.js";

const CLASSES = ["Property", "Casualty", "Marine", "Motor"];
const options = (list) => list.map((v) => `<option>${v}</option>`).join("");

function pendingRows() {
  const mine = pendingSubmissions();
  if (!mine.length) return emptyState("No open submissions — everything is placed.");
  return mine.map((i) => `<div style="display:flex; justify-content:space-between; gap:10px; padding:9px 0; border-bottom:1px solid var(--line-soft); font-size:13px;">
      <span><strong>${i.id}</strong> · ${i.insuredName || "—"} · ${i.cls} · ${i.requestedType} · ${fmtFull(i.sumInsured, i.ccy)}${i.placementId ? ` → ${i.placementId}` : ""}</span>
      ${statusPill(i.status)}
    </div>`).join("");
}

export const cedantSubmitView = {
  id: "c-submit",

  render: () => `<section class="view">
    <div class="view-head">
      <div><h1>Submit a Risk or Renewal</h1><p>Send a request to your broker's intake queue.</p></div>
    </div>
    <div class="card" style="max-width:560px;">
      <div class="field"><label>Insured name</label><input type="text" id="cs-insured" placeholder="Who is the cover for?"></div>
      <div class="field"><label>Class of business</label><select id="cs-class">${options(CLASSES)}</select></div>
      <div class="field-row">
        <div class="field"><label>Requested placement type</label><select id="cs-type">${options(PLACEMENT_TYPES)}</select></div>
        <div class="field"><label>Sum insured</label><input type="number" id="cs-amount" value="5000000" step="50000"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Currency</label><select id="cs-ccy">${options(["USD", "CAD", "EUR", "GBP", "IDR"])}</select></div>
        <div class="field"><label>Payment warranty (days)</label><select id="cs-warranty">${options(["", ...PAYMENT_WARRANTY_DAYS])}</select>
          <div class="hint">Select the agreed payment warranty period. Your broker cannot accept the request without it.</div></div>
      </div>
      <div class="field"><label>Notes for your broker</label>
        <textarea id="cs-notes" rows="3" placeholder="Anything the placement team should know — loss history, timing, target markets...">Renewal terms as expiring, please; new warehouse location added mid-term.</textarea>
      </div>
      <button class="btn primary" data-action="submit-risk">Send to broker</button>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="panel-title">With your broker</div>
      <div id="c-pending"></div>
    </div>
  </section>`,

  mount() {
    onAction("#view-root", {
      "submit-risk": () => {
        submitRisk({
          insuredName: $("#cs-insured").value,
          cls: $("#cs-class").value,
          type: $("#cs-type").value,
          amount: +$("#cs-amount").value,
          ccy: $("#cs-ccy").value,
          paymentWarrantyDays: $("#cs-warranty").value || null,
          notes: $("#cs-notes").value,
        });
        $("#cs-insured").value = "";
      },
    });
  },

  refresh() {
    mount("#c-pending", pendingRows());
  },
};

[TOPICS.SUBMISSIONS, TOPICS.INTAKES].forEach((t) => on(t, () => {
  if (document.getElementById("c-pending")) cedantSubmitView.refresh();
}));
