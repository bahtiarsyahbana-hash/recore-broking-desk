/**
 * Placements — facultative risks and treaty programs in one filterable book,
 * each row opening the lifecycle drawer.
 */
import { mount, onAction, $$ } from "../../core/dom.js";
import { fmtFull } from "../../core/format.js";
import { state } from "../../core/store.js";
import { on, TOPICS } from "../../core/events.js";
import { statusPill, typeBadge } from "../../ui/badges.js";
import { isPreMarket } from "../../domain/lifecycle.js";
import { paginate, paginationControls, createPager } from "../../ui/pagination.js";
import { icons } from "../../ui/icons.js";
import { openWizard } from "../../ui/submission-wizard.js";
import { openProgramDetail } from "../../ui/program-detail.js";
import { showView } from "../../core/router.js";

const FILTERS = ["all", "Facultative", "Quota Share", "Surplus", "Excess of Loss"];

/**
 * Stage is a different axis from type: a draft has not gone to market, so it
 * does not belong in the book alongside live placements. "In market" is the
 * default, which is what a broker means by "my placements".
 */
const STAGES = {
  market: { label: "In market", match: (p) => !isPreMarket(p) },
  drafts: { label: "Drafts & approvals", match: isPreMarket },
  all: { label: "All", match: () => true },
};

let activeFilter = "all";
let activeStage = "market";

/** Submissions sitting in the approval queue — the signatory's workload. */
const pendingApprovalCount = () =>
  state.programs.filter((p) => p.status === "Pending Approval").length;

const visiblePrograms = () => state.programs
  .filter(STAGES[activeStage].match)
  .filter((p) => activeFilter === "all" || p.type === activeFilter);

const pager = createPager(() => placementsView.refresh());

const programRow = (p) => `<tr>
    <td><strong>${p.id}</strong></td>
    <td>${p.cedant}</td>
    <td>${p.cls}</td>
    <td>${typeBadge(p.type)}</td>
    <td>${p.structure}</td>
    <td class="num">${fmtFull(p.premium, p.ccy)}</td>
    <td>${statusPill(p.status)}</td>
    <td><button class="btn ghost" style="padding:5px 10px;" data-action="open-detail" data-id="${p.id}">Lifecycle →</button></td>
  </tr>`;

const emptyRow = () => `<tr><td colspan="8"><div class="empty">Nothing here. ${
  activeStage === "drafts"
    ? "New submissions are saved as drafts and appear here until they are released to market."
    : "Try a different stage or type filter."
}</div></td></tr>`;

export const placementsView = {
  id: "placements",

  render: () => `<section class="view">
    <div class="view-head">
      <div>
        <h1>Placements</h1>
        <p>Facultative risks and treaty programs — one workflow, one signing engine, filtered any way you like.</p>
      </div>
      <button class="btn primary" data-action="new-submission">${icons.plus}New Submission</button>
    </div>
    <div class="toolbar">
      <div class="seg" id="placement-stage">
        ${Object.entries(STAGES).map(([key, stage]) => {
          const pending = key === "drafts" ? pendingApprovalCount() : 0;
          return `<button class="${key === activeStage ? "active" : ""}" data-s="${key}">${stage.label}${
            pending ? `<span class="seg-badge">${pending}</span>` : ""
          }</button>`;
        }).join("")}
      </div>
      <div class="seg" id="placement-filter">
        ${FILTERS.map((f) => `<button class="${f === activeFilter ? "active" : ""}" data-f="${f}">${f === "all" ? "All" : f}</button>`).join("")}
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Program</th><th>Cedant</th><th>Class</th><th>Type</th><th>Structure</th>
          <th class="num">Gross Premium</th><th>Status</th><th></th>
        </tr></thead>
        <tbody id="placements-body"></tbody>
      </table>
    </div>
    <div id="placements-pager"></div>
  </section>`,

  mount() {
    onAction("#view-root", {
      "new-submission": () => openWizard((id) => openProgramDetail(id)),
      "open-detail": ({ id }) => openProgramDetail(id),
    });

    $$("#placement-filter button").forEach((b) => {
      b.addEventListener("click", () => {
        $$("#placement-filter button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        activeFilter = b.dataset.f;
        pager.reset();
        placementsView.refresh();
      });
    });

    $$("#placement-stage button").forEach((b) => {
      b.addEventListener("click", () => {
        activeStage = b.dataset.s;
        // The pending badge changes with the stage counts, so re-render the
        // whole view rather than just the table body.
        showView(placementsView.id);
      });
    });
  },

  refresh() {
    const page = paginate(visiblePrograms(), pager.page);
    mount("#placements-body", page.items.map(programRow).join("") || emptyRow());
    mount("#placements-pager", paginationControls(page, { unit: "placements" }));
  },
};

on(TOPICS.PROGRAMS, () => {
  if (document.getElementById("placements-body")) placementsView.refresh();
});
