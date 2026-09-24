/**
 * Cedant portal — Upload Bordereau.
 *
 * Submits a periodic premium or loss bordereau directly onto the treaty
 * account. The upload is acknowledged inline; matching happens desk-side.
 */
import { $, mount, onAction } from "../../core/dom.js";
import { programsForCedant, currentCedant } from "../../core/store.js";
import { receiveBordereau } from "../../services/bordereaux.service.js";

/** How long the confirmed state stays on the button, in ms. */
const ACK_DURATION = 1800;

export const cedantBordereauView = {
  id: "c-bdx",

  render: () => `<section class="view">
    <div class="view-head">
      <div><h1>Upload Bordereau</h1><p>Send your premium or loss bordereau.</p></div>
    </div>
    <div class="card" style="max-width:560px;">
      <div class="field-row">
        <div class="field"><label>Program</label><select id="cb-program"></select></div>
        <div class="field"><label>Type</label><select id="cb-type"><option>Premium</option><option>Loss</option></select></div>
      </div>
      <div class="field"><label>Period</label><input type="text" id="cb-period" value="Q3 2026"></div>
      <div class="field"><label>File</label>
        <div style="border:1.5px dashed var(--line); border-radius:8px; padding:22px; text-align:center; color:var(--ink-soft); font-size:12.5px;">
          Drop a spreadsheet here, or <button class="btn ghost" style="padding:4px 8px;" data-action="browse">browse</button>
        </div>
      </div>
      <div class="field" id="cb-amount-wrap" hidden>
        <label>Total amount (from file)</label>
        <input type="number" id="cb-amount" value="245000" step="1000">
      </div>
      <button class="btn primary" data-action="submit-bdx">Submit bordereau</button>
    </div>
  </section>`,

  mount() {
    onAction("#view-root", {
      // "Browsing" reveals the figure the desk would otherwise read off the file.
      "browse": () => { $("#cb-amount-wrap").hidden = false; },

      "submit-bdx": (_data, button) => {
        receiveBordereau({
          period: $("#cb-period").value,
          program: $("#cb-program").value,
          type: $("#cb-type").value,
          amount: +$("#cb-amount").value,
        });
        button.textContent = "Submitted ✓";
        button.disabled = true;
        setTimeout(() => {
          button.textContent = "Submit bordereau";
          button.disabled = false;
        }, ACK_DURATION);
      },
    });
  },

  refresh() {
    mount("#cb-program", programsForCedant(currentCedant())
      .map((p) => `<option>${p.id} · ${p.cls}</option>`).join(""));
  },
};
