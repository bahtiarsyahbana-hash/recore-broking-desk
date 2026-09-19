/**
 * New submission wizard — four steps from risk basics to an issued slip.
 *
 * Step 2's fields are conditional on the treaty type chosen in step 1, which is
 * why each step is its own render function rather than one long form. Finishing
 * the wizard issues a slip; it never binds.
 */
import { $, $$, row } from "../core/dom.js";
import { fmt } from "../core/format.js";
import { state } from "../core/store.js";
import { openModal, updateModal, closeModal } from "./modal.js";
import { icons } from "./icons.js";
import { typeBadge } from "./badges.js";
import { UNDERWRITING_YEAR } from "../core/config.js";
import { saveDraft } from "../services/placement.service.js";
import {
  structureLine, estimatedGrossPremium, estimatedCededPremium,
} from "../domain/placement-terms.js";
import { fmtFull } from "../core/format.js";

const STEP_LABELS = ["Risk basics", "Structure & terms", "Market panel", "Review & save"];
const CLASSES = ["Property", "Casualty", "Marine", "Motor"];
const TYPES = ["Facultative", "Quota Share", "Surplus", "Excess of Loss"];

/** Wizard-local state. Reset on every open. */
let step = 0;
let draft = { type: "Facultative", markets: {} };
let onIssued = null;

const options = (list, selected) =>
  list.map((v) => `<option${v === selected ? " selected" : ""}>${v}</option>`).join("");

/* ---------- steps ---------- */

const stepRiskBasics = () => `
  <div class="field"><label>Cedant</label>
    <select id="w-cedant">${options(state.cedants.map((c) => c.name), draft.cedant)}</select></div>
  <div class="field-row">
    <div class="field"><label>Class of business</label><select id="w-class">${options(CLASSES, draft.cls)}</select></div>
    <div class="field"><label>Type</label><select id="w-type">${options(TYPES, draft.type)}</select></div>
  </div>
  <div class="field"><label>Underwriting year</label><input type="text" id="w-uwy" value="2026"></div>`;

/**
 * Terms, by treaty form — each form asks only for what prices it.
 *
 * One schema drives three things: the step-2 form, what is captured into the
 * draft, and how the review step describes it. They used to be three separate
 * pieces of code, which is how every term typed here came to be discarded
 * before the slip was saved.
 */
const TERMS_SCHEMA = {
  "Facultative": [
    { key: "insured", label: "Insured", type: "text", value: "Northline Terminals Ltd." },
    { key: "sumInsured", label: "Sum insured", type: "money", value: 12000000, half: true },
    { key: "rate", label: "Rate %", type: "number", step: 0.05, value: 0.85, half: true, suffix: "%" },
  ],
  "Quota Share": [
    { key: "cession", label: "Cession %", type: "number", value: 30, half: true, suffix: "%" },
    { key: "commission", label: "Commission %", type: "number", value: 27, half: true, suffix: "%" },
    { key: "gnpi", label: "Estimated GNPI", type: "money", value: 9000000 },
  ],
  "Surplus": [
    { key: "retention", label: "Retention", type: "money", value: 750000, half: true },
    { key: "lines", label: "Lines", type: "number", value: 8, half: true },
    // Without this the form cannot price itself, and the saved premium would
    // have to be invented.
    { key: "premium", label: "Estimated treaty premium", type: "money", value: 2400000 },
  ],
  "Excess of Loss": [
    { key: "retention", label: "Retention", type: "money", value: 5000000, half: true },
    { key: "limit", label: "Limit", type: "money", value: 15000000, half: true },
    { key: "rol", label: "Rate on line %", type: "number", step: 0.1, value: 5.5, half: true, suffix: "%" },
    { key: "reinstatements", label: "Reinstatements", type: "text", value: "2 @ 100% pro-rata", half: true },
  ],
};

const termFields = () => TERMS_SCHEMA[draft.type] || [];

/** Current value of a term: what was entered, else the schema default. */
const termValue = (field) => draft.terms?.[field.key] ?? field.value;

function termInput(field) {
  const inputType = field.type === "text" ? "text" : "number";
  const step = field.step ? ` step="${field.step}"` : "";
  return `<div class="field"${field.half ? ' style="margin-bottom:0;"' : ""}>
    <label for="w-${field.key}">${field.label}</label>
    <input type="${inputType}" id="w-${field.key}" data-term="${field.key}" value="${termValue(field)}"${step}>
  </div>`;
}

/** Consecutive `half` fields pair into a row, as elsewhere in the app. */
function stepTerms() {
  const fields = termFields();
  const out = [];
  for (let i = 0; i < fields.length; i++) {
    if (fields[i].half && fields[i + 1]?.half) {
      out.push(`<div class="field-row">${termInput(fields[i])}${termInput(fields[i + 1])}</div>`);
      i++;
    } else {
      out.push(termInput(fields[i]));
    }
  }
  return out.join("") +
    `<div class="hint">Fields shown are conditional on the type chosen in step 1.</div>`;
}

/** Read step 2 back into the draft before the form is replaced. */
function captureTerms() {
  draft.terms = draft.terms || {};
  termFields().forEach((field) => {
    const input = document.getElementById(`w-${field.key}`);
    if (!input) return;
    draft.terms[field.key] = field.type === "text" ? input.value : (Number(input.value) || 0);
  });
}

/** Format a term for the summary, per its declared type. */
function formatTerm(field) {
  const value = termValue(field);
  if (field.type === "money") return fmtFull(Number(value) || 0);
  if (field.suffix) return `${value}${field.suffix}`;
  return String(value);
}

/** Signed lines across the panel. Binding needs exactly 100%. */
const signedTotal = () => Object.values(draft.markets).reduce((a, b) => a + b, 0);

function stepMarketPanel() {
  const rows = state.markets.map((m, i) => {
    const line = draft.markets[m.name] ?? (i < 3 ? [40, 35, 25][i] : 0);
    draft.markets[m.name] = line;
    return `<div class="market-row">
      <div><div class="m-name">${m.name}</div><div class="m-rating">${m.rating} · ${m.panel}</div></div>
      <input type="number" data-m="${m.name}" value="${line}" min="0" max="100"><span style="width:14px;">%</span>
    </div>`;
  }).join("");

  return `<div class="panel-sub" style="margin-bottom:10px;">Enter each market's signed line — binding needs 100%.</div>`
    + rows
    + `<div class="calc-out" style="margin-top:14px;">
        <div class="row"><span>Total signed</span><span id="w-total">${signedTotal()}%</span></div>
      </div>`;
}

/* ---------- step 4: the summary ---------- */

const summarySection = (heading, rows) => `<div class="summary-section">
  <div class="summary-head">${heading}</div>
  ${rows}
</div>`;

const summaryRow = (label, value, cls = "") =>
  `<div class="summary-row ${cls}"><span>${label}</span><span>${value}</span></div>`;

/** Who the risk is for. */
const riskSummary = () => summarySection("Risk", [
  summaryRow("Cedant", draft.cedant || state.cedants[0].name),
  summaryRow("Class of business", draft.cls || "Property"),
  summaryRow("Type", typeBadge(draft.type)),
  summaryRow("Underwriting year", draft.uwy || String(UNDERWRITING_YEAR)),
].join(""));

/**
 * The terms as entered, plus what they price to. Showing the derived premium
 * here is the point of the step: it is the first moment the numbers are
 * visible together, and it is the figure the placement will carry.
 */
function termsSummary() {
  const gross = estimatedGrossPremium(draft.type, draft.terms);
  const ceded = estimatedCededPremium(draft.type, draft.terms);

  const rows = termFields().map((f) => summaryRow(f.label, formatTerm(f))).join("")
    + summaryRow("Structure", structureLine(draft.type, draft.terms))
    + summaryRow("Gross premium", gross ? fmtFull(gross) : "—", "emphasis")
    + (ceded !== gross ? summaryRow("Ceded premium", fmtFull(ceded)) : "");

  return summarySection("Structure & terms", rows);
}

/** Who is on the slip, and for how much. */
function panelSummary() {
  const signed = Object.entries(draft.markets).filter(([, line]) => line > 0);
  const total = signedTotal();

  const rows = signed.length
    ? signed.map(([name, line]) => summaryRow(name, `${line}%`)).join("")
    : `<div class="summary-row"><span class="muted">No markets selected</span><span>—</span></div>`;

  return summarySection("Market panel", rows
    + summaryRow("Total signed lines", `${total}%`, total === 100 ? "emphasis good" : "emphasis bad"));
}

const stepReview = () => {
  const total = signedTotal();
  const placed = total === 100;
  return `<div class="banner${placed ? "" : " warn"}">${placed ? icons.check : icons.info}${
      placed
        ? "Saving puts this in your drafts. Nothing goes to market yet — an authorised signatory reviews and releases the slip."
        : `Signed lines total ${total}%. You can save the draft, but it cannot go for approval until the panel is placed at exactly 100%.`
    }</div>`
    + `<div class="summary">${riskSummary()}${termsSummary()}${panelSummary()}</div>`;
};

const STEPS = [stepRiskBasics, stepTerms, stepMarketPanel, stepReview];

/* ---------- shell ---------- */

function shell() {
  return `<div class="modal-backdrop">
    <div class="modal">
      <div class="modal-head">
        <div>
          <div class="panel-title" style="margin:0;">New Submission</div>
          <div class="panel-sub" style="margin:2px 0 0;">Step ${step + 1} of 4 · ${STEP_LABELS[step]}</div>
        </div>
        <button class="close-x" data-action="close-modal">✕</button>
      </div>
      <div class="modal-body" id="wizard-body">${STEPS[step]()}</div>
      <div class="modal-foot">
        <div class="step-dots">${[0, 1, 2, 3].map((i) => `<span class="${i <= step ? "active" : ""}"></span>`).join("")}</div>
        <div style="display:flex; gap:8px;">
          <button class="btn" data-wiz="back" ${step === 0 ? "disabled" : ""}>Back</button>
          <button class="btn primary" data-wiz="next">${step === 3 ? "Save draft" : "Continue"}</button>
        </div>
      </div>
    </div>
  </div>`;
}

/** Wire the step's own inputs plus the footer controls. */
function wire() {
  const body = $("#wizard-body");

  body.addEventListener("change", (e) => {
    if (e.target.id === "w-cedant") draft.cedant = e.target.value;
    if (e.target.id === "w-class") draft.cls = e.target.value;
    if (e.target.id === "w-type") draft.type = e.target.value;
  });

  // Live signed-line total, tinted against the 100% target.
  $$("#wizard-body .market-row input").forEach((input) => {
    input.addEventListener("input", () => {
      draft.markets[input.dataset.m] = +input.value || 0;
      const total = signedTotal();
      const label = $("#w-total");
      label.textContent = total + "%";
      label.parentElement.style.color =
        total === 100 ? "var(--good)" : total > 100 ? "var(--bad)" : "var(--warn)";
    });
  });

  $("[data-wiz='back']").addEventListener("click", back);
  $("[data-wiz='next']").addEventListener("click", next);
}

const repaint = () => updateModal(shell(), { onMount: wire });

function back() {
  if (step === 1) captureTerms();
  if (step > 0) { step--; repaint(); }
}

function next() {
  if (step === 0) {
    draft.cedant = $("#w-cedant").value;
    draft.cls = $("#w-class").value;
    draft.type = $("#w-type").value;
    draft.uwy = $("#w-uwy").value;
  }
  // Read the terms back before the step's inputs are replaced.
  if (step === 1) captureTerms();
  if (step < 3) { step++; repaint(); return; }

  // Final step saves a draft — it does not go to market, and it does not bind.
  const id = saveDraft({
    cedant: draft.cedant || state.cedants[0].name,
    cls: draft.cls || "Property",
    type: draft.type,
    structure: structureLine(draft.type, draft.terms),
    premium: estimatedGrossPremium(draft.type, draft.terms),
    terms: draft.terms,
    markets: draft.markets,
  });
  closeModal();
  onIssued?.(id);
}

/**
 * Open the wizard.
 * @param {(programId:string) => void} [onIssue] called with the new program id.
 */
export function openWizard(onIssue) {
  step = 0;
  draft = { type: "Facultative", markets: {} };
  onIssued = onIssue || null;
  openModal(shell(), { onMount: wire });
}
