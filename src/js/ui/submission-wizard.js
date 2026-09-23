/**
 * New placement wizard — four steps from risk basics to a saved Draft Slip.
 *
 *   1. Risk basics       cedant, class, placement type (Quota Share | Excess of Loss)
 *   2. Terms             insured, sum insured, currency, rate, payment warranty
 *   3. Market panel      QS: one horizontal panel · XoL: a tower, one panel per layer
 *   4. Review            full summary with capacity status, then Save / Submit / Place
 *
 * Finishing the wizard never sends anything to a market. "Place to market" is
 * offered only to an authorised signatory who did not prepare the slip, and it
 * runs the same four-eyes gate as the drawer. Historical Facultative and Surplus
 * placements can be revised here without changing their form, but this wizard
 * does not create new ones.
 */
import { $, $$, mount } from "../core/dom.js";
import { fmtFull, fmt } from "../core/format.js";
import { state, programById, currentUser, cedantNamed } from "../core/store.js";
import { openModal, updateModal, closeModal } from "./modal.js";
import { icons } from "./icons.js";
import { typeBadge } from "./badges.js";
import { saveDraft, updateDraft, submitForApproval, releaseSlip } from "../services/placement.service.js";
import { structureLine, estimatedGrossPremium, paymentWarrantyLine } from "../domain/placement-terms.js";
import { PLACEMENT_TYPES, EDITABLE_PLACEMENT_TYPES, PAYMENT_WARRANTY_DAYS, isValidPaymentWarranty } from "../domain/intake.js";
import { paymentWarrantyCheck } from "../domain/slip-approval.js";
import { capacityUnits, layerLabel } from "../domain/panel.js";
import { releaseAuthority } from "../domain/authority.js";
import { canReleaseSlip } from "../domain/slip-approval.js";
import { normaliseStatus, STATUS } from "../domain/lifecycle.js";

const STEP_LABELS = ["Risk basics", "Terms", "Market panel", "Review & save"];
const CLASSES = ["Property", "Casualty", "Marine", "Motor"];
const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "IDR"];

/** Wizard-local state. Reset on every open. */
let step = 0;
let draft = null;
let marketQuery = "";
let activeLayer = 0;
let editingId = null;
let onSaved = null;

const blankDraft = () => ({
  cedant: "", cls: "Property", type: "Quota Share", ccy: "USD",
  terms: { insured: "", sumInsured: 0, rate: null, paymentWarrantyDays: null },
  markets: [],                                 // QS: [{ m, offered, line }]
  layers: [{ limit: 0, attachment: 0, markets: [] }], // XoL tower
});

const options = (list, selected) =>
  list.map((v) => `<option value="${v}"${String(v) === String(selected) ? " selected" : ""}>${v}</option>`).join("");

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const isXol = () => draft.type === "Excess of Loss";
const isHistoricalEdit = () => Boolean(editingId) && !PLACEMENT_TYPES.includes(draft.type);

/** The program shape the domain rules read — used for live capacity checks. */
const asProgram = () => ({
  type: draft.type,
  marketConfirmations: isXol() ? [] : draft.markets.map((mc) => ({ ...mc, s: "Sent" })),
  layers: isXol() ? draft.layers.map((l) => ({ ...l, markets: l.markets.map((mc) => ({ ...mc, s: "Sent" })) })) : null,
});

/* ---------- step 1 ---------- */

const stepRiskBasics = () => `
  <div class="field"><label>Cedant</label>
    <input type="text" id="w-cedant" list="w-cedant-options" autocomplete="off"
      value="${esc(draft.cedant)}" placeholder="Start typing a cedant's name">
    <datalist id="w-cedant-options">${state.cedants.map((c) => `<option value="${esc(c.name)}">`).join("")}</datalist>
    <div class="hint" id="w-cedant-hint">${state.cedants.length} cedants on the registry. Must match one exactly.</div></div>
  <div class="field-row">
    <div class="field"><label>Class of business</label><select id="w-class">${options(CLASSES, draft.cls)}</select></div>
    <div class="field"><label>Placement type</label><select id="w-type"${isHistoricalEdit() ? " disabled" : ""}>${options(isHistoricalEdit() ? [draft.type] : PLACEMENT_TYPES, draft.type)}</select>
      <div class="hint">${isHistoricalEdit()
        ? "Historical form retained for this revision. New placements are Quota Share or Excess of Loss."
        : "Quota share places one horizontal panel; excess of loss builds a layered tower."}</div></div>
  </div>`;

/* ---------- step 2 ---------- */

const stepTerms = () => `
  <div class="field"><label for="w-insured">Insured name</label>
    <input type="text" id="w-insured" value="${esc(draft.terms.insured)}" placeholder="The original insured"></div>
  <div class="field-row">
    <div class="field"><label for="w-si">Sum insured</label><input type="number" id="w-si" min="0" step="1000" value="${draft.terms.sumInsured || ""}"></div>
    <div class="field"><label for="w-ccy">Currency</label><select id="w-ccy">${options(CURRENCIES, draft.ccy)}</select></div>
  </div>
  <div class="field-row">
    <div class="field"><label for="w-rate">Rate % <span class="optional-tag">when known</span></label>
      <input type="number" id="w-rate" min="0" step="0.01" value="${draft.terms.rate ?? ""}" placeholder="e.g. 0.85">
      <div class="hint">Leave blank if the market is to quote. Premium is sum insured × rate.</div></div>
    <div class="field"><label for="w-warranty">Payment warranty <span class="req" aria-hidden="true">*</span></label>
      <select id="w-warranty" required>
        <option value=""${isValidPaymentWarranty(draft.terms.paymentWarrantyDays) ? "" : " selected"}>Select…</option>
        ${PAYMENT_WARRANTY_DAYS.map((d) => `<option value="${d}"${Number(draft.terms.paymentWarrantyDays) === d ? " selected" : ""}>${d} days</option>`).join("")}
      </select>
      <div class="hint" id="w-warranty-hint">Select the agreed payment warranty period.</div></div>
  </div>`;

function captureTerms() {
  draft.terms.insured = $("#w-insured")?.value.trim() ?? draft.terms.insured;
  draft.terms.sumInsured = Number($("#w-si")?.value) || 0;
  draft.ccy = $("#w-ccy")?.value || draft.ccy;
  const rate = $("#w-rate")?.value;
  draft.terms.rate = rate === "" || rate == null ? null : Number(rate);
  const warranty = $("#w-warranty")?.value;
  draft.terms.paymentWarrantyDays = isValidPaymentWarranty(warranty) ? Number(warranty) : null;
}

/* ---------- step 3: the panel ---------- */

const MAX_RESULTS = 8;

/** The allocation list the search adds to: the QS panel or the active layer. */
const currentPanel = () => isXol() ? draft.layers[activeLayer].markets : draft.markets;

function marketMatches(query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const taken = new Set(currentPanel().map((mc) => mc.m));
  return state.markets
    .filter((m) => !taken.has(m.name))
    .filter((m) => terms.every((t) => `${m.name} ${m.rating || ""} ${m.panel || ""} ${m.country || ""}`.toLowerCase().includes(t)))
    .slice(0, MAX_RESULTS);
}

function marketResults(query) {
  if (!query.trim()) return "";
  const matches = marketMatches(query);
  if (!matches.length) return `<div class="market-results"><div class="market-none">No markets match "${esc(query)}".</div></div>`;
  return `<div class="market-results">${matches.map((m) => `
    <button type="button" class="market-result" data-add-market="${esc(m.name)}">
      <span class="m-name">${m.name}</span>
      <span class="m-rating">${[m.panel, m.rating].filter(Boolean).join(" · ")}</span>
    </button>`).join("")}</div>`;
}

function allocationRows(list) {
  if (!list.length) return `<div class="empty" style="padding:18px;">No markets here yet. Search above to add one.</div>`;
  return `<div class="alloc-head"><span>Market</span><span>Offered %</span><span>Signed %</span><span></span></div>` +
    list.map((mc, i) => `<div class="market-row alloc-row">
      <div class="m-name">${mc.m}<div class="m-rating">Response: Sent on placing</div></div>
      <input type="number" data-alloc="offered" data-i="${i}" value="${mc.offered ?? ""}" min="0" max="100" placeholder="—" aria-label="Offered line for ${mc.m}">
      <input type="number" data-alloc="line" data-i="${i}" value="${mc.line ?? 0}" min="0" max="100" aria-label="Signed line for ${mc.m}">
      <button type="button" class="btn ghost" data-drop-market="${i}" title="Take ${mc.m} off" style="padding:6px 8px;">✕</button>
    </div>`).join("");
}

function capacityLine() {
  const units = capacityUnits(asProgram(), fmt);
  const u = isXol() ? units[activeLayer] : units[0];
  const tone = u.signedComplete ? "good" : u.signed > 100 ? "bad" : "warn";
  return `<div class="row"><span>${isXol() ? `Layer ${activeLayer + 1} signed` : "Total signed"}</span><span id="w-total" style="color:var(--${tone})">${u.signed}%</span></div>`;
}

function layerTabs() {
  return `<div class="layer-tabs">
    ${draft.layers.map((l, i) => {
      const unit = capacityUnits(asProgram(), fmt)[i];
      return `<button type="button" class="layer-tab${i === activeLayer ? " active" : ""}" data-layer="${i}">
        <span>Layer ${i + 1}</span><span class="layer-tab-meta">${layerLabel(l, fmt)} · <span style="color:var(--${unit.signedComplete ? "good" : "warn"})">${unit.signed}%</span></span>
      </button>`;
    }).join("")}
    <button type="button" class="btn ghost" data-add-layer style="padding:6px 10px;">+ Layer</button>
  </div>`;
}

function layerTerms() {
  const l = draft.layers[activeLayer];
  return `<div class="field-row" style="margin-bottom:6px;">
    <div class="field"><label for="w-limit">Limit</label><input type="number" id="w-limit" min="0" step="1000" value="${l.limit || ""}"></div>
    <div class="field"><label for="w-att">Attachment</label><input type="number" id="w-att" min="0" step="1000" value="${l.attachment || ""}"></div>
  </div>
  <div class="hint" style="margin:-4px 0 10px;">Reads on the slip as <strong id="w-layer-label">${layerLabel(l, fmt)}</strong>.${draft.layers.length > 1 ? ` <button type="button" class="btn ghost" data-remove-layer="${activeLayer}" style="padding:2px 8px; font-size:11px;">Remove this layer</button>` : ""}</div>`;
}

function stepMarketPanel() {
  return `<div class="panel-sub" style="margin-bottom:10px;">${isXol()
      ? "Build the tower layer by layer. Each layer has its own panel and must be signed to exactly 100% on its own."
      : "Add each reinsurer on the slip with the line offered and the line signed. Signed lines must total exactly 100%."}</div>
    ${isXol() ? `<div id="w-layer-tabs">${layerTabs()}</div><div id="w-layer-terms">${layerTerms()}</div>` : ""}
    <div class="field">
      <input type="search" id="w-market-search" autocomplete="off" value="${esc(marketQuery)}"
        placeholder="Search ${state.markets.length} markets by name, panel or rating">
    </div>
    <div id="w-market-results">${marketResults(marketQuery)}</div>
    <div id="w-market-selected">${allocationRows(currentPanel())}</div>
    <div class="calc-out" style="margin-top:14px;" id="w-capacity">${capacityLine()}</div>`;
}

/* ---------- step 4 ---------- */

const section = (heading, rows) => `<div class="summary-section"><div class="summary-head">${heading}</div>${rows}</div>`;
const srow = (label, value, cls = "") => `<div class="summary-row ${cls}"><span>${label}</span><span>${value}</span></div>`;

function panelSummary() {
  const units = capacityUnits(asProgram(), fmt);
  return units.map((u) => section(isXol() ? u.label : "Market panel",
    (u.entries.length ? u.entries.map((mc) => srow(mc.m, `${mc.offered != null && mc.offered !== "" ? `offered ${mc.offered}% · ` : ""}signed ${mc.line}%`)).join("")
      : `<div class="summary-row"><span class="muted">No markets</span><span>—</span></div>`)
    + srow("Signed lines", `${u.signed}%`, u.signedComplete ? "emphasis good" : "emphasis bad"))).join("");
}

function reviewBanner(program, complete) {
  const user = currentUser();
  if (!complete.complete) return `<div class="banner warn">${icons.info}${complete.reason} You can save the draft; it cannot go for approval until then.</div>`;
  const authority = releaseAuthority({ preparedBy: editingId ? programById(editingId)?.preparedBy : { id: user.id } }, user);
  return `<div class="banner">${icons.check}Capacity is fully signed. Save keeps it as a draft; submit puts it in the internal approval queue${
    authority.allowed ? "; place sends it to the market now" : ""}. Nothing reaches a market without an authorised signatory.</div>`;
}

const stepReview = () => {
  const program = asProgram();
  const complete = readyState();
  const premium = estimatedGrossPremium(draft.type, draft.terms);
  return reviewBanner(program, complete)
    + `<div class="summary">
      ${section("Risk", srow("Cedant", draft.cedant) + srow("Class of business", draft.cls) + srow("Placement type", typeBadge(draft.type)))}
      ${section("Terms", srow("Insured", draft.terms.insured || "—") + srow("Sum insured", fmtFull(draft.terms.sumInsured, draft.ccy))
        + srow("Rate", draft.terms.rate != null ? `${draft.terms.rate}%` : "<span class='muted'>to be quoted</span>")
        + srow("Payment warranty", paymentWarrantyLine(draft.terms.paymentWarrantyDays))
        + srow("Structure", structureLine(draft.type, draft.terms, isXol() ? draft.layers : null))
        + srow("Estimated gross premium", premium ? fmtFull(premium, draft.ccy) : "—", "emphasis"))}
      ${panelSummary()}
    </div>`;
};

/** Signed-line readiness through the domain rule, not a local sum. */
function readyState() {
  // Lazy import avoided: slip-approval is already loaded via lifecycle.
  const units = capacityUnits(asProgram());
  const entries = units.flatMap((u) => u.entries);
  if (!entries.length) return { complete: false, reason: "Name at least one market on the slip." };
  const empty = isXol() ? draft.layers.findIndex((l) => !l.markets.length) : -1;
  if (empty >= 0) return { complete: false, reason: `Layer ${empty + 1} has no markets.` };
  const short = units.find((u) => !u.signedComplete);
  if (short) return { complete: false, reason: `${isXol() ? short.label : "Signed lines"} total ${short.signed}%, not 100%.` };
  const warranty = paymentWarrantyCheck({ terms: draft.terms });
  if (!warranty.ok) return { complete: false, reason: warranty.reason };
  return { complete: true, reason: null };
}

const STEPS = [stepRiskBasics, stepTerms, stepMarketPanel, stepReview];

/* ---------- shell ---------- */

function finalButtons() {
  const complete = readyState().complete;
  const user = currentUser();
  const existing = editingId ? programById(editingId) : null;
  const preparer = existing?.preparedBy || { id: user.id };
  const canPlace = complete && releaseAuthority({ preparedBy: preparer }, user).allowed
    && canReleaseSlip({ ...asProgram(), preparedBy: preparer, status: STATUS.PENDING_APPROVAL }, cedantNamed(draft.cedant), user);
  return `<button class="btn" data-wiz="save">Save draft</button>
    <button class="btn${canPlace ? "" : " primary"}" data-wiz="submit"${complete ? "" : " disabled"} title="Puts the slip in the internal approval queue">Submit for internal approval</button>
    ${canPlace ? `<button class="btn primary" data-wiz="place" title="Runs the four-eyes release gate and places the slip">Place to market</button>` : ""}`;
}

function shell() {
  return `<div class="modal-backdrop">
    <div class="modal" style="max-width:${step === 2 && isXol() ? "760px" : "640px"};">
      <div class="modal-head">
        <div>
          <div class="panel-title" style="margin:0;">${editingId ? `Complete ${editingId}` : "New Placement"}</div>
          <div class="panel-sub" style="margin:2px 0 0;">Step ${step + 1} of 4 · ${STEP_LABELS[step]}</div>
        </div>
        <button class="close-x" data-action="close-modal">✕</button>
      </div>
      <div class="modal-body" id="wizard-body">${STEPS[step]()}</div>
      <div class="modal-foot">
        <div class="step-dots">${[0, 1, 2, 3].map((i) => `<span class="${i <= step ? "active" : ""}"></span>`).join("")}</div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
          <button class="btn" data-wiz="back" ${step === 0 ? "disabled" : ""}>Back</button>
          ${step === 3 ? finalButtons() : `<button class="btn primary" data-wiz="next">Continue</button>`}
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------- wiring ---------- */

function wire() {
  const body = $("#wizard-body");

  body.addEventListener("change", (e) => {
    if (e.target.id === "w-cedant") draft.cedant = e.target.value;
    if (e.target.id === "w-class") draft.cls = e.target.value;
    if (e.target.id === "w-type") { draft.type = e.target.value; }
  });

  const search = $("#w-market-search");
  if (search) {
    search.addEventListener("input", (e) => {
      marketQuery = e.target.value;
      mount("#w-market-results", marketResults(marketQuery));
    });
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const [first] = marketMatches(marketQuery);
      if (first) addMarket(first.name);
    });
  }

  body.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add-market]");
    if (add) return addMarket(add.dataset.addMarket);
    const drop = e.target.closest("[data-drop-market]");
    if (drop) { currentPanel().splice(Number(drop.dataset.dropMarket), 1); return repaintPanel(); }
    const tab = e.target.closest("[data-layer]");
    if (tab) { activeLayer = Number(tab.dataset.layer); marketQuery = ""; return repaint(); }
    if (e.target.closest("[data-add-layer]")) {
      const last = draft.layers.at(-1);
      draft.layers.push({ limit: 0, attachment: (Number(last.attachment) || 0) + (Number(last.limit) || 0), markets: [] });
      activeLayer = draft.layers.length - 1; marketQuery = "";
      return repaint();
    }
    const rm = e.target.closest("[data-remove-layer]");
    if (rm && draft.layers.length > 1) {
      draft.layers.splice(Number(rm.dataset.removeLayer), 1);
      activeLayer = Math.max(0, Math.min(activeLayer, draft.layers.length - 1));
      return repaint();
    }
  });

  body.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.alloc) {
      const mc = currentPanel()[Number(t.dataset.i)];
      if (!mc) return;
      const v = t.value === "" ? null : Math.max(0, Math.min(100, Number(t.value) || 0));
      if (t.dataset.alloc === "offered") mc.offered = v; else mc.line = v ?? 0;
      mount("#w-capacity", capacityLine());
      if (isXol()) mount("#w-layer-tabs", layerTabs());
    }
    if (t.id === "w-limit" || t.id === "w-att") {
      const l = draft.layers[activeLayer];
      l.limit = Number($("#w-limit").value) || 0;
      l.attachment = Number($("#w-att").value) || 0;
      const label = $("#w-layer-label");
      if (label) label.textContent = layerLabel(l, fmt);
      mount("#w-layer-tabs", layerTabs());
    }
  });

  $("[data-wiz='back']").addEventListener("click", back);
  $("[data-wiz='next']")?.addEventListener("click", next);
  $("[data-wiz='save']")?.addEventListener("click", () => finish("save"));
  $("[data-wiz='submit']")?.addEventListener("click", () => finish("submit"));
  $("[data-wiz='place']")?.addEventListener("click", () => finish("place"));
}

function addMarket(name) {
  const list = currentPanel();
  if (!list.some((mc) => mc.m === name)) list.push({ m: name, offered: null, line: 0 });
  marketQuery = "";
  repaintPanel();
  $$(`[data-alloc="line"]`).at(-1)?.focus();
}

function repaintPanel() {
  const search = $("#w-market-search");
  if (search) search.value = marketQuery;
  mount("#w-market-results", marketResults(marketQuery));
  mount("#w-market-selected", allocationRows(currentPanel()));
  mount("#w-capacity", capacityLine());
  if (isXol()) mount("#w-layer-tabs", layerTabs());
}

const repaint = () => updateModal(shell(), { onMount: wire });

function back() {
  if (step === 1) captureTerms();
  if (step > 0) { step--; repaint(); }
}

function fail(inputSel, hintSel, message) {
  const input = $(inputSel);
  input?.closest(".field")?.classList.add("has-error");
  const hint = $(hintSel);
  if (hint) hint.outerHTML = `<div class="field-error" id="${hint.id}">${message}</div>`;
  input?.focus();
}

function next() {
  if (step === 0) {
    const typed = $("#w-cedant").value.trim();
    const match = state.cedants.find((c) => c.name.toLowerCase() === typed.toLowerCase());
    if (!match) return fail("#w-cedant", "#w-cedant-hint", typed ? `"${typed}" is not on the registry. Add them under Registry → Cedants first.` : "Choose a cedant.");
    draft.cedant = match.name;
    draft.cls = $("#w-class").value;
    draft.type = $("#w-type").value;
  }
  if (step === 1) {
    captureTerms();
    if (!draft.terms.insured) { $("#w-insured").closest(".field").classList.add("has-error"); $("#w-insured").focus(); return; }
    if (!(draft.terms.sumInsured > 0)) { $("#w-si").closest(".field").classList.add("has-error"); $("#w-si").focus(); return; }
    if (!isValidPaymentWarranty(draft.terms.paymentWarrantyDays)) return fail("#w-warranty", "#w-warranty-hint", "Select the agreed payment warranty period.");
  }
  if (step === 2 && isXol()) {
    const bad = draft.layers.findIndex((l) => !(Number(l.limit) > 0) || Number(l.attachment) < 0);
    if (bad >= 0) { activeLayer = bad; repaint(); $("#w-limit")?.closest(".field")?.classList.add("has-error"); return; }
  }
  if (step < 3) { step++; marketQuery = ""; repaint(); }
}

/**
 * Final actions. Save always works. Submit requires capacity at 100%. Place
 * runs the real release gate in the service — if the gate refuses, the slip is
 * left in the approval queue and the drawer explains why.
 */
function finish(mode) {
  const payload = {
    cedant: draft.cedant, cls: draft.cls, type: draft.type, ccy: draft.ccy,
    terms: { ...draft.terms },
    markets: isXol() ? [] : draft.markets.filter((mc) => mc.m),
    layers: isXol() ? draft.layers : null,
  };
  let id = editingId;
  if (id) updateDraft(id, payload); else id = saveDraft(payload);
  if (mode === "submit" || mode === "place") {
    if (normaliseStatus(programById(id).status) === STATUS.DRAFT) submitForApproval(id);
  }
  if (mode === "place") releaseSlip(id);
  closeModal();
  onSaved?.(id);
}

/**
 * Open the wizard, blank or to complete an existing Draft Slip.
 * @param {(programId:string) => void} [onIssue] called with the program id.
 * @param {{ programId?: string }} [opts]
 */
export function openWizard(onIssue, { programId } = {}) {
  step = 0; marketQuery = ""; activeLayer = 0; editingId = null;
  draft = blankDraft();
  const existing = programId ? programById(programId) : null;
  if (existing && normaliseStatus(existing.status) === STATUS.DRAFT && EDITABLE_PLACEMENT_TYPES.includes(existing.type)) {
    editingId = existing.id;
    draft.cedant = existing.cedant; draft.cls = existing.cls; draft.type = existing.type; draft.ccy = existing.ccy || "USD";
    draft.terms = { insured: "", sumInsured: 0, rate: null, paymentWarrantyDays: null, ...(existing.terms || {}) };
    if (existing.layers?.length) draft.layers = existing.layers.map((l) => ({ limit: l.limit, attachment: l.attachment, markets: (l.markets || []).map((mc) => ({ m: mc.m, offered: mc.offered ?? null, line: mc.line || 0 })) }));
    draft.markets = (existing.marketConfirmations || []).filter((mc) => mc.layer == null).map((mc) => ({ m: mc.m, offered: mc.offered ?? null, line: mc.line || 0 }));
  }
  onSaved = onIssue || null;
  openModal(shell(), { onMount: wire });
}
