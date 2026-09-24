/**
 * Intake — the broker's single queue of requests for cover, from every
 * channel, before any of them is a placement.
 */
import { mount, onAction, $$ } from "../../core/dom.js";
import { fmtFull } from "../../core/format.js";
import { state } from "../../core/store.js";
import { on, TOPICS } from "../../core/events.js";
import { statusPill, typeBadge, emptyState } from "../../ui/badges.js";
import { icons } from "../../ui/icons.js";
import { paginate, paginationControls, createPager } from "../../ui/pagination.js";
import { openFormModal } from "../../ui/form-modal.js";
import { openIntakeDetail, intakeFields } from "../../ui/intake-detail.js";
import { openProgramDetail } from "../../ui/program-detail.js";
import { createManualIntake } from "../../services/intake.service.js";
import { intakeOpen } from "../../domain/intake.js";
import { showView } from "../../core/router.js";
import { todayISO } from "../../core/config.js";

const FILTERS = {
  open: { label: "Open", match: intakeOpen },
  converted: { label: "Converted", match: (i) => i.status === "Converted to Placement" },
  declined: { label: "Declined", match: (i) => i.status === "Declined" },
  all: { label: "All", match: () => true },
};
let activeFilter = "open";

const pager = createPager(() => intakeView.refresh(), "intake");

const visible = () => state.intakes.filter(FILTERS[activeFilter].match);

const sourceLabel = (i) => i.source === "portal" ? "Portal" : i.source === "email" ? "Email" : `Manual · ${i.channel}`;

const intakeRow = (i) => `<tr>
  <td><strong>${i.id}</strong></td>
  <td>${i.cedant || "<span class='muted'>—</span>"}</td>
  <td>${i.insuredName || "—"}</td>
  <td>${i.cls || "—"}</td>
  <td>${i.requestedType ? typeBadge(i.requestedType) : "—"}</td>
  <td class="num">${i.sumInsured ? fmtFull(i.sumInsured, i.ccy) : "—"}</td>
  <td>${sourceLabel(i)}<br><span class="muted" style="font-size:11px;">${i.receivedDate}</span></td>
  <td>${statusPill(i.status)}</td>
  <td><button class="btn ghost" style="padding:5px 10px;" data-action="open-intake" data-id="${i.id}">Open →</button></td>
</tr>`;

const toPlacement = (programId) => { showView("placements"); openProgramDetail(programId); };

function newManualIntake() {
  openFormModal({
    title: "Record an intake",
    subtitle: "A request that arrived by email, phone, WhatsApp or in a meeting",
    fields: intakeFields({ receivedDate: todayISO() }),
    submitLabel: "Save to queue",
    onSubmit: (values) => {
      const intake = createManualIntake(values);
      openIntakeDetail(intake.id, toPlacement);
    },
  });
}

export const intakeView = {
  id: "intake",

  render: () => `<section class="view">
    <div class="view-head">
      <div>
        <h1>Intake</h1>
        <p>Every request for cover, before it becomes a placement.</p>
      </div>
      <button class="btn primary" data-action="new-intake">${icons.plus}Record Intake</button>
    </div>
    <div class="toolbar">
      <div class="seg" id="intake-filter">
        ${Object.entries(FILTERS).map(([key, f]) => {
          const n = state.intakes.filter(f.match).length;
          return `<button class="${key === activeFilter ? "active" : ""}" data-f="${key}">${f.label}<span class="seg-badge">${n}</span></button>`;
        }).join("")}
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Intake</th><th>Cedant</th><th>Insured</th><th>Class</th><th>Requested</th>
          <th class="num">Sum insured</th><th>Source</th><th>Status</th><th></th>
        </tr></thead>
        <tbody id="intake-body"></tbody>
      </table>
    </div>
    <div id="intake-pager"></div>
  </section>`,

  mount() {
    onAction("#view-root", {
      "new-intake": newManualIntake,
      "open-intake": ({ id }) => openIntakeDetail(id, toPlacement),
    });
    pager.wire("#view-root");
    $$("#intake-filter button").forEach((b) => b.addEventListener("click", () => {
      activeFilter = b.dataset.f;
      pager.reset();
      showView(intakeView.id);
    }));
  },

  refresh() {
    const page = paginate(visible(), pager.page);
    mount("#intake-body", page.items.map(intakeRow).join("")
      || `<tr><td colspan="9">${emptyState(activeFilter === "open" ? "The queue is clear. Record an intake when a request comes in." : "Nothing in this filter.")}</td></tr>`);
    mount("#intake-pager", paginationControls(page, { unit: "intakes", name: "intake" }));
  },
};

on(TOPICS.INTAKES, () => {
  if (document.getElementById("intake-body")) intakeView.refresh();
});
