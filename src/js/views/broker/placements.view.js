/**
 * Placements — the facultative book in three views of the same data.
 *
 *   Kanban   one column per lifecycle stage, substatus on each card
 *   Table    the auditable list, paginated
 *   List     compact rows for a narrow screen
 *
 * The switcher is remembered for the browser session. Filters apply to all
 * three. Cards do not drag: a status changes only through a recorded action
 * in the lifecycle drawer, never by moving a card.
 */
import { mount, onAction, $$ } from "../../core/dom.js";
import { fmtFull, fmt } from "../../core/format.js";
import { state } from "../../core/store.js";
import { on, TOPICS } from "../../core/events.js";
import { statusPill, typeBadge, subBadge, emptyState } from "../../ui/badges.js";
import { LIFECYCLE_STEPS, stageOf, isPreMarket, isBound, normaliseStatus, STATUS } from "../../domain/lifecycle.js";
import { capacityUnits, responseProgress } from "../../domain/panel.js";
import { boardIntakes } from "../../domain/intake.js";
import { openIntakeDetail } from "../../ui/intake-detail.js";
import { paginate, paginationControls, createPager } from "../../ui/pagination.js";
import { icons } from "../../ui/icons.js";
import { openWizard } from "../../ui/submission-wizard.js";
import { openProgramDetail } from "../../ui/program-detail.js";
import { showView } from "../../core/router.js";

const FILTERS = ["all", "Quota Share", "Excess of Loss", "Facultative", "Surplus"];

/** Stage is a different axis from type. "Active" is what a broker means by "my placements". */
const STAGES = {
  active: { label: "Active", match: (p) => !isBound(p) && normaliseStatus(p.status) !== STATUS.RENEWAL_DUE },
  drafts: { label: "Drafts & approvals", match: isPreMarket },
  bound: { label: "Bound", match: (p) => isBound(p) || normaliseStatus(p.status) === STATUS.RENEWAL_DUE },
  all: { label: "All", match: () => true },
};

const VIEWS = { kanban: "Kanban", table: "Table", list: "List" };
const VIEW_KEY = "recordes.placements.view";

const rememberedView = () => {
  try { return sessionStorage.getItem(VIEW_KEY) || "kanban"; } catch { return "kanban"; }
};
const rememberView = (v) => { try { sessionStorage.setItem(VIEW_KEY, v); } catch { /* private mode */ } };

let activeFilter = "all";
let activeStage = "all";
let activeView = rememberedView();
if (!VIEWS[activeView]) activeView = "kanban";

const pendingApprovalCount = () => state.programs.filter((p) => normaliseStatus(p.status) === STATUS.PENDING_APPROVAL).length;

const visiblePrograms = () => state.programs
  .filter(STAGES[activeStage].match)
  .filter((p) => activeFilter === "all" || p.type === activeFilter);

const pager = createPager(() => placementsView.refresh());

/** Substatus tone: capacity secured and approvals read good; waits read warn. */
const subTone = (status) => ({
  [STATUS.BACKUP]: "good", [STATUS.CEDANT_APPROVED]: "warn", [STATUS.BIND_INSTRUCTED]: "good",
  [STATUS.PENDING_APPROVAL]: "warn", [STATUS.CEDANT_NEGOTIATION]: "warn", [STATUS.NEGOTIATING]: "warn",
  [STATUS.RENEWAL_DUE]: "warn",
}[status] || "info");

/** The substatus tag, omitted when it would only repeat the status pill. */
const subTag = (stage) => stage.substatus.toLowerCase() === stage.status.toLowerCase() ? "" : subBadge(stage.substatus, subTone(stage.status));

/** "3 of 4 confirmed · 100%" — the panel in one line. */
function capacityNote(p) {
  if (isPreMarket(p)) {
    const units = capacityUnits(p);
    const done = units.filter((u) => u.signedComplete).length;
    return units.length > 1 ? `${done}/${units.length} layers signed` : `Signed ${units[0]?.signed.toFixed(0) ?? 0}%`;
  }
  const r = responseProgress(p);
  if (!r.total) return "No panel";
  return `${r.confirmed}/${r.total} confirmed${r.queried ? ` · ${r.queried} queried` : ""}${r.declined ? ` · ${r.declined} declined` : ""}`;
}

/* ---------- Kanban ---------- */

/**
 * Open intakes appear in the first column. They are not placements: their ids
 * read IN-, the card says Intake, and clicking one opens the intake drawer.
 * They show on the Active and All stages, never under Drafts or Bound.
 */
const boardIntakesVisible = () => (activeStage === "active" || activeStage === "all") ? boardIntakes(state.intakes, activeFilter) : [];

const intakeCard = (i) => `<article class="kcard kcard-intake" data-action="open-intake" data-id="${i.id}" tabindex="0" role="button" aria-label="Open intake ${i.id}">
    <div class="kcard-top"><strong>${i.id}</strong>${i.requestedType ? typeBadge(i.requestedType) : ""}</div>
    <div class="kcard-title">${i.insuredName || "Unnamed insured"}</div>
    <div class="kcard-meta">${i.cedant || "Cedant not set"} · ${i.cls || "—"}</div>
    <div class="kcard-meta mono">${i.sumInsured ? fmt(i.sumInsured, i.ccy) : "—"} · ${i.source === "portal" ? "Portal" : i.source === "email" ? "Email" : `Manual · ${i.channel}`}</div>
    <div class="kcard-foot">${subBadge("Intake", "neutral")}${subBadge(i.status, i.status === "Revision Requested" ? "warn" : "info")}</div>
  </article>`;

const card = (p) => {
  const stage = stageOf(p);
  return `<article class="kcard" data-action="open-detail" data-id="${p.id}" tabindex="0" role="button" aria-label="Open ${p.id}">
    <div class="kcard-top"><strong>${p.id}</strong>${typeBadge(p.type)}</div>
    <div class="kcard-title">${p.terms?.insured || p.cedant}</div>
    <div class="kcard-meta">${p.terms?.insured ? `${p.cedant} · ` : ""}${p.cls}</div>
    <div class="kcard-meta mono">${fmt(p.premium, p.ccy)} · ${capacityNote(p)}</div>
    <div class="kcard-foot">${subBadge(stage.substatus, subTone(stage.status))}${p.slipVersion > 1 ? subBadge(`slip v${p.slipVersion}`) : ""}</div>
  </article>`;
};

function kanban(programs) {
  const intakes = boardIntakesVisible();
  const columns = LIFECYCLE_STEPS.map((label, i) => {
    const items = programs.filter((p) => stageOf(p).stepIndex === i);
    const cards = i === 0 ? intakes.map(intakeCard) : items.map(card);
    const count = i === 0 ? intakes.length : items.length;
    const empty = i === 0
      ? (activeStage === "active" || activeStage === "all" ? "No open intakes." : "Intakes show on the Active and All stages.")
      : "Nothing here";
    return `<section class="kcol" aria-label="${label}">
      <header class="kcol-head"><span>${label}</span><span class="kcol-count">${count}</span></header>
      <div class="kcol-body">${cards.join("") || `<div class="kcol-empty">${empty}</div>`}</div>
    </section>`;
  }).join("");
  return `<div class="kanban">${columns}</div>`;
}

/* ---------- Table ---------- */

const tableRow = (p) => {
  const stage = stageOf(p);
  return `<tr>
    <td><strong>${p.id}</strong></td>
    <td>${p.cedant}</td>
    <td>${p.terms?.insured || "—"}</td>
    <td>${p.cls}</td>
    <td>${typeBadge(p.type)}</td>
    <td>${p.structure}</td>
    <td class="num">${fmtFull(p.premium, p.ccy)}</td>
    <td>${statusPill(stage.status)}${subTag(stage) ? `<div style="margin-top:3px;">${subTag(stage)}</div>` : ""}</td>
    <td>${capacityNote(p)}</td>
    <td><button class="btn ghost" style="padding:5px 10px;" data-action="open-detail" data-id="${p.id}">Lifecycle →</button></td>
  </tr>`;
};

function table(programs) {
  const page = paginate(programs, pager.page);
  return `<div class="table-wrap"><table>
    <thead><tr><th>Program</th><th>Cedant</th><th>Insured</th><th>Class</th><th>Type</th><th>Structure</th>
      <th class="num">Gross Premium</th><th>Status</th><th>Capacity</th><th></th></tr></thead>
    <tbody>${page.items.map(tableRow).join("") || `<tr><td colspan="10">${emptyMessage()}</td></tr>`}</tbody>
  </table></div>${paginationControls(page, { unit: "placements" })}`;
}

/* ---------- List ---------- */

const listRow = (p) => {
  const stage = stageOf(p);
  return `<div class="lrow" data-action="open-detail" data-id="${p.id}" role="button" tabindex="0">
    <div class="lrow-main">
      <div><strong>${p.id}</strong> · ${p.terms?.insured || p.cedant} ${typeBadge(p.type)}</div>
      <div class="lrow-meta">${p.cedant} · ${p.cls} · ${p.structure}</div>
    </div>
    <div class="lrow-side">
      <div class="mono">${fmtFull(p.premium, p.ccy)}</div>
      <div>${statusPill(stage.status)} ${subTag(stage)}</div>
    </div>
  </div>`;
};

function list(programs) {
  const page = paginate(programs, pager.page);
  return `<div class="lrows">${page.items.map(listRow).join("") || emptyMessage()}</div>${paginationControls(page, { unit: "placements" })}`;
}

const emptyMessage = () => emptyState(activeStage === "drafts"
  ? "New placements are saved as drafts and appear here until they are placed to market."
  : "Nothing matches this stage and type filter.");

/* ---------- view ---------- */

export const placementsView = {
  id: "placements",

  render: () => `<section class="view">
    <div class="view-head">
      <div>
        <h1>Placements</h1>
        <p>Facultative placements from draft slip to bound.</p>
      </div>
      <button class="btn primary" data-action="new-submission">${icons.plus}New Placement</button>
    </div>
    <div class="toolbar">
      <div class="seg" id="placement-view" role="tablist" aria-label="View">
        ${Object.entries(VIEWS).map(([key, label]) => `<button class="${key === activeView ? "active" : ""}" data-v="${key}" role="tab" aria-selected="${key === activeView}">${label}</button>`).join("")}
      </div>
      <div class="seg" id="placement-stage">
        ${Object.entries(STAGES).map(([key, stage]) => {
          const pending = key === "drafts" ? pendingApprovalCount() : 0;
          return `<button class="${key === activeStage ? "active" : ""}" data-s="${key}">${stage.label}${pending ? `<span class="seg-badge">${pending}</span>` : ""}</button>`;
        }).join("")}
      </div>
      <div class="seg" id="placement-filter">
        ${FILTERS.map((f) => `<button class="${f === activeFilter ? "active" : ""}" data-f="${f}">${f === "all" ? "All types" : f}</button>`).join("")}
      </div>
    </div>
    <div id="placements-body"></div>
  </section>`,

  mount() {
    onAction("#view-root", {
      "new-submission": () => openWizard((id) => openProgramDetail(id)),
      "open-detail": ({ id }) => openProgramDetail(id),
      "open-intake": ({ id }) => openIntakeDetail(id, (pid) => openProgramDetail(pid)),
    });
    pager.wire("#view-root");
    // Keyboard: a card or list row opens on Enter or Space.
    document.getElementById("view-root")?.addEventListener("keydown", (e) => {
      const t = e.target.closest?.("[data-action='open-detail'][tabindex], [data-action='open-intake'][tabindex]");
      if (!t || !(e.key === "Enter" || e.key === " ")) return;
      e.preventDefault();
      if (t.dataset.action === "open-intake") openIntakeDetail(t.dataset.id, (pid) => openProgramDetail(pid));
      else openProgramDetail(t.dataset.id);
    });

    $$("#placement-view button").forEach((b) => b.addEventListener("click", () => {
      activeView = b.dataset.v; rememberView(activeView); pager.reset();
      $$("#placement-view button").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-selected", x === b); });
      placementsView.refresh();
    }));
    $$("#placement-filter button").forEach((b) => b.addEventListener("click", () => {
      $$("#placement-filter button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      activeFilter = b.dataset.f; pager.reset();
      placementsView.refresh();
    }));
    $$("#placement-stage button").forEach((b) => b.addEventListener("click", () => {
      activeStage = b.dataset.s; pager.reset();
      // The pending badge changes with the stage counts, so re-render the whole view.
      showView(placementsView.id);
    }));
  },

  refresh() {
    const programs = visiblePrograms();
    const html = activeView === "kanban" ? kanban(programs) : activeView === "table" ? table(programs) : list(programs);
    mount("#placements-body", html);
  },
};

[TOPICS.PROGRAMS, TOPICS.INTAKES].forEach((topic) => on(topic, () => {
  if (document.getElementById("placements-body")) placementsView.refresh();
}));
