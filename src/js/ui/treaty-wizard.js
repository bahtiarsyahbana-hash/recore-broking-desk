/**
 * Register Treaty Agreement — five steps that turn a contract negotiated and
 * bound outside Recordes into a master record.
 *
 *   1. Agreement basics    2. Treaty structure (by type)    3. Reinsurer panel
 *   4. Reporting & accounting    5. Documents & summary — Save as Draft Setup,
 *      or Activate when every hard gate holds.
 *
 * Nothing is placed here: the wizard records what was already agreed.
 */
import { $, $$, mount } from "../core/dom.js";
import { fmt, fmtFull } from "../core/format.js";
import { state, agreementById } from "../core/store.js";
import { todayISO } from "../core/config.js";
import { openModal, updateModal, closeModal } from "./modal.js";
import { icons } from "./icons.js";
import { registerAgreement, updateAgreement, activateAgreement, DOCUMENT_TYPES } from "../services/treaty.service.js";
import {
  TREATY_TYPES, AGREEMENT_SOURCES, FREQUENCIES, PREMIUM_BASES, LOSS_RATIO_BASES, PANEL_ROLES, TREATY_CLASSES, TREATY_CURRENCIES,
  validateBasics, validateStructure, validatePanel, panelTotal, panelComplete, activationChecklist, canActivate, isLayered, layerLabel,
} from "../domain/treaty.js";
import { PAYMENT_WARRANTY_DAYS } from "../domain/intake.js";

const STEP_LABELS = ["Agreement basics", "Treaty structure", "Reinsurer panel", "Reporting & accounting", "Documents & summary"];

let step = 0; let draft = null; let editingId = null; let onDone = null; let errors = {};

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const opt = (list, selected, blank = null) => (blank != null ? `<option value=""${selected == null || selected === "" ? " selected" : ""}>${blank}</option>` : "")
  + list.map((v) => `<option value="${esc(v)}"${String(v) === String(selected ?? "") ? " selected" : ""}>${esc(v)}</option>`).join("");
const err = (key) => errors[key] ? `<div class="field-error">${esc(errors[key])}</div>` : "";
const fieldCls = (key) => `field${errors[key] ? " has-error" : ""}`;
const input = (key, label, value, { type = "text", step: st, placeholder = "", hint = "", list = "", required = false } = {}) => `<div class="${fieldCls(key)}">
  <label for="w-${key}">${label}${required ? ' <span class="req" aria-hidden="true">*</span>' : ""}</label>
  <input type="${type}" id="w-${key}" data-k="${key}" value="${esc(value)}"${st ? ` step="${st}"` : ""}${placeholder ? ` placeholder="${esc(placeholder)}"` : ""}${list ? ` list="${list}" autocomplete="off"` : ""}>
  ${err(key) || (hint ? `<div class="hint">${hint}</div>` : "")}</div>`;
const select = (key, label, value, options, { blank = null, hint = "", required = false } = {}) => `<div class="${fieldCls(key)}">
  <label for="w-${key}">${label}${required ? ' <span class="req" aria-hidden="true">*</span>' : ""}</label>
  <select id="w-${key}" data-k="${key}">${opt(options, value, blank)}</select>${err(key) || (hint ? `<div class="hint">${hint}</div>` : "")}</div>`;
const rowOf = (...cells) => `<div class="field-row">${cells.join("")}</div>`;

const blank = () => ({
  id: "", name: "", cedant: "", cls: "Property", inception: "", expiry: "", originalInception: "", ccy: "USD",
  type: "Quota Share", source: "Manual Registration",
  structure: {}, panel: [], reporting: { declarationsRequired: false }, documents: [], endorsements: [],
});

/* ---------- step 1 ---------- */

const stepBasics = () => `
  ${rowOf(input("id", "Agreement number", draft.id, { placeholder: "e.g. TA-2026-007", hint: "Must be unique across the register.", required: true }),
          input("name", "Treaty name", draft.name, { placeholder: "e.g. Cempaka Property Quota Share 2026", required: true }))}
  <div class="${fieldCls("cedant")}"><label for="w-cedant">Cedant <span class="req" aria-hidden="true">*</span></label>
    <input type="text" id="w-cedant" data-k="cedant" list="w-cedant-options" autocomplete="off" value="${esc(draft.cedant)}" placeholder="Start typing a cedant's name">
    <datalist id="w-cedant-options">${state.cedants.map((c) => `<option value="${esc(c.name)}">`).join("")}</datalist>
    ${err("cedant") || `<div class="hint">Must match a cedant on the registry.</div>`}</div>
  ${rowOf(select("cls", "Class of business", draft.cls, TREATY_CLASSES), select("type", "Treaty type", draft.type, TREATY_TYPES, { required: true, hint: editingId ? "Type cannot change after registration." : "" }))}
  ${rowOf(input("inception", "Contract inception", draft.inception, { type: "date" }), input("expiry", "Contract expiry", draft.expiry, { type: "date" }))}
  ${rowOf(input("originalInception", "Original inception date", draft.originalInception, { type: "date", hint: "First inception of this continuing treaty, if renewed." }),
          select("ccy", "Currency", draft.ccy, TREATY_CURRENCIES, { required: true }))}
  ${rowOf(select("source", "Source", draft.source, AGREEMENT_SOURCES), `<div class="field"><label>Status</label><input type="text" value="${editingId ? esc(agreementById(editingId)?.status) : "Draft Setup"}" disabled><div class="hint">Set on save; activation is a separate, recorded act.</div></div>`)}`;

/* ---------- step 2 ---------- */

const s = () => draft.structure;
const layers = () => { s().layers = s().layers || [{ limit: "", attachment: "", reinstatements: "", premium: "" }]; return s().layers; };

function layerRows() {
  return layers().map((l, i) => `<div class="layer-grid">
    <div class="${fieldCls(`layers.${i}.limit`)}"><label>Layer ${i + 1} limit</label><input type="number" data-layer="${i}" data-lk="limit" value="${esc(l.limit)}" step="100000"></div>
    <div class="${fieldCls(`layers.${i}.attachment`)}"><label>${draft.type === "Catastrophe XoL" ? "Attachment per event" : "Attachment / retention"}</label><input type="number" data-layer="${i}" data-lk="attachment" value="${esc(l.attachment)}" step="100000"></div>
    <div class="${fieldCls(`layers.${i}.reinstatements`)}"><label>Reinstatements</label><input type="number" data-layer="${i}" data-lk="reinstatements" value="${esc(l.reinstatements)}" step="1" min="0"></div>
    <div class="${fieldCls(`layers.${i}.premium`)}"><label>Layer premium <span class="optional-tag">optional</span></label><input type="number" data-layer="${i}" data-lk="premium" value="${esc(l.premium)}" step="1000"></div>
    <button type="button" class="btn ghost" data-remove-layer="${i}" title="Remove layer" ${layers().length === 1 ? "disabled" : ""}>✕</button>
    <div class="layer-note mono">${l.limit && l.attachment !== "" ? layerLabel(l, (n) => fmt(n, draft.ccy)) : ""}${errors[`layers.${i}.limit`] || errors[`layers.${i}.attachment`] || errors[`layers.${i}.reinstatements`] ? `<span class="field-error">${esc(errors[`layers.${i}.limit`] || errors[`layers.${i}.attachment`] || errors[`layers.${i}.reinstatements`])}</span>` : ""}</div>
  </div>`).join("");
}

function stepStructure() {
  const premiumBasis = select("premiumBasis", "Premium basis", s().premiumBasis, PREMIUM_BASES, { blank: "Not set" });
  switch (draft.type) {
    case "Quota Share":
      return rowOf(input("cessionPct", "Cession %", s().cessionPct, { type: "number", step: 0.5, required: true }), input("retentionPct", "Cedant retention %", s().retentionPct, { type: "number", step: 0.5, hint: "Cession and retention total 100%." }))
        + rowOf(input("commissionPct", "Commission %", s().commissionPct, { type: "number", step: 0.5 }), premiumBasis);
    case "Surplus":
      return rowOf(input("retention", `Cedant retention (${draft.ccy})`, s().retention, { type: "number", step: 10000, required: true, hint: "One line." }), input("lines", "Number of lines", s().lines, { type: "number", step: 1, required: true }))
        + rowOf(input("capacity", `Treaty capacity (${draft.ccy})`, s().capacity, { type: "number", step: 10000, hint: "Retention × lines." }), input("commissionPct", "Commission %", s().commissionPct, { type: "number", step: 0.5 }))
        + premiumBasis;
    case "Per Risk XoL":
    case "Catastrophe XoL":
      return `<div class="field-row">
          <div class="field"><label>Layering</label><select id="w-layerMode" data-k="layerMode">${opt(["Single layer", "Multiple layers"], layers().length > 1 ? "Multiple layers" : (s().layerMode || "Single layer"))}</select></div>
          ${premiumBasis}
        </div>
        <div id="w-layers">${layerRows()}</div>
        ${errors.layers ? `<div class="field-error">${esc(errors.layers)}</div>` : ""}
        <button type="button" class="btn ghost" data-add-layer style="margin:4px 0 14px;">${icons.plus}Add layer</button>
        ${draft.type === "Catastrophe XoL" ? input("eventDefinition", "Event definition / reference", s().eventDefinition, { placeholder: "e.g. 72 consecutive hours, any one event — hours clause 5077", required: true }) : ""}`;
    case "Stop Loss":
      return rowOf(input("attachmentRatio", "Attachment ratio (loss ratio %)", s().attachmentRatio, { type: "number", step: 0.5, required: true }), input("limitRatio", "Limit ratio (loss ratio %)", s().limitRatio, { type: "number", step: 0.5, required: true }))
        + rowOf(input("subjectPremium", `Subject premium (${draft.ccy})`, s().subjectPremium, { type: "number", step: 1000 }), select("lossRatioBasis", "Loss-ratio basis", s().lossRatioBasis, LOSS_RATIO_BASES, { blank: "Not set" }));
    default: return "";
  }
}

/* ---------- step 3 ---------- */

function panelRows() {
  return draft.panel.map((p, i) => `<div class="panel-grid">
    <div class="${fieldCls(`panel.${i}.reinsurer`)}"><label>Reinsurer</label><input type="text" data-panel="${i}" data-pk="reinsurer" list="w-market-options" autocomplete="off" value="${esc(p.reinsurer)}" placeholder="Registry name"></div>
    <div class="${fieldCls(`panel.${i}.share`)}"><label>Signed share %</label><input type="number" data-panel="${i}" data-pk="share" value="${esc(p.share)}" step="0.5" min="0" max="100"></div>
    <div class="field"><label>Role</label><select data-panel="${i}" data-pk="role">${opt(PANEL_ROLES, p.role || "Follow")}</select></div>
    <div class="${fieldCls(`panel.${i}.brokeragePct`)}"><label>Brokerage %</label><input type="number" data-panel="${i}" data-pk="brokeragePct" value="${esc(p.brokeragePct)}" step="0.25"></div>
    <div class="field"><label>Market reference</label><input type="text" data-panel="${i}" data-pk="marketRef" value="${esc(p.marketRef)}" placeholder="Their reference"></div>
    <button type="button" class="btn ghost" data-remove-panel="${i}" title="Remove">✕</button>
    ${errors[`panel.${i}.reinsurer`] || errors[`panel.${i}.share`] ? `<div class="field-error panel-err">${esc(errors[`panel.${i}.reinsurer`] || errors[`panel.${i}.share`])}</div>` : ""}
  </div>`).join("");
}

function panelTotalLine() {
  const total = panelTotal(draft.panel);
  const tone = panelComplete(draft.panel) ? "good" : total > 100 ? "bad" : "warn";
  return `<div class="row"><span>Total signed share</span><span id="w-panel-total" style="color:var(--${tone})">${total.toFixed(2)}%</span></div>`;
}

const stepPanel = () => `<div class="panel-sub" style="margin-bottom:10px;">Who signed the treaty and for how much. Shares must total exactly 100% before the agreement can become Active; a shorter panel may still be saved as Draft Setup.</div>
  <datalist id="w-market-options">${state.markets.map((m) => `<option value="${esc(m.name)}">`).join("")}</datalist>
  <div id="w-panel">${panelRows() || `<div class="empty" style="padding:16px;">No reinsurers yet.</div>`}</div>
  <button type="button" class="btn ghost" data-add-panel style="margin:4px 0 14px;">${icons.plus}Add reinsurer</button>
  <div class="calc-out" id="w-panel-out">${panelTotalLine()}</div>`;

/* ---------- step 4 ---------- */

const r = () => draft.reporting;
const stepReporting = () => `<div class="panel-sub" style="margin-bottom:10px;">How the cedant reports and how the account settles. Leave a field unset rather than guessing — it shows as "Not set".</div>
  ${rowOf(select("premiumBdxFrequency", "Premium bordereau frequency", r().premiumBdxFrequency, FREQUENCIES, { blank: "Not set" }), select("claimsBdxFrequency", "Claims bordereau frequency", r().claimsBdxFrequency, FREQUENCIES, { blank: "Not set" }))}
  ${rowOf(select("accountingFrequency", "Accounting frequency / period", r().accountingFrequency, FREQUENCIES, { blank: "Not set" }), input("reportingDeadlineDays", "Reporting deadline (days after period end)", r().reportingDeadlineDays, { type: "number", step: 1 }))}
  ${rowOf(select("paymentWarrantyDays", "Payment warranty (days)", r().paymentWarrantyDays, PAYMENT_WARRANTY_DAYS, { blank: "Not set", hint: "Select the agreed payment warranty period." }), select("settlementCcy", "Settlement currency", r().settlementCcy || draft.ccy, TREATY_CURRENCIES))}
  ${rowOf(input("brokeragePct", "Brokerage %", r().brokeragePct, { type: "number", step: 0.25 }), input("commissionPct", "Commission %", r().commissionPct ?? s().commissionPct, { type: "number", step: 0.5 }))}
  ${rowOf(input("taxPct", "Tax %", r().taxPct, { type: "number", step: 0.1 }), input("cashCallThreshold", `Cash-call threshold (${draft.ccy})`, r().cashCallThreshold, { type: "number", step: 10000 }))}
  ${select("declarationsRequired", "Individual declaration required", r().declarationsRequired ? "Yes" : "No", ["No", "Yes"], { hint: "Only agreements that require declarations accept individual cessions." })}`;

/* ---------- step 5 ---------- */

const DOC_CHECKS = ["Signed treaty wording", "Slip", "Cover note"];
const secRow = (label, value) => `<div class="summary-row"><span>${label}</span><span>${value == null || value === "" ? "<span class='muted'>Not set</span>" : value}</span></div>`;
const section = (head, rows) => `<div class="summary-section"><div class="summary-head">${head}</div>${rows}</div>`;

function asAgreement() {
  return {
    ...draft, status: "Draft Setup",
    structure: Object.fromEntries(Object.entries(draft.structure).map(([k, v]) => [k, k === "layers" ? v.map((l) => Object.fromEntries(Object.entries(l).map(([lk, lv]) => [lk, lv === "" ? null : Number(lv)]))) : (["premiumBasis", "eventDefinition", "lossRatioBasis", "layerMode"].includes(k) ? v || null : (v === "" || v == null ? null : Number(v)))])),
    panel: draft.panel.map((p) => ({ ...p, share: Number(p.share) || 0, brokeragePct: p.brokeragePct === "" ? null : Number(p.brokeragePct) })),
    reporting: { ...draft.reporting, declarationsRequired: draft.reporting.declarationsRequired === true || draft.reporting.declarationsRequired === "Yes" },
    documents: draft.documents,
  };
}

function structureRows(a) {
  const st = a.structure; const f = (n) => (n == null ? null : fmtFull(n, a.ccy));
  switch (a.type) {
    case "Quota Share": return secRow("Cession", st.cessionPct != null ? `${st.cessionPct}%` : null) + secRow("Cedant retention", st.retentionPct != null ? `${st.retentionPct}%` : null) + secRow("Commission", st.commissionPct != null ? `${st.commissionPct}%` : null) + secRow("Premium basis", st.premiumBasis);
    case "Surplus": return secRow("Cedant retention", f(st.retention)) + secRow("Lines", st.lines) + secRow("Capacity", f(st.capacity)) + secRow("Commission", st.commissionPct != null ? `${st.commissionPct}%` : null) + secRow("Premium basis", st.premiumBasis);
    case "Stop Loss": return secRow("Attachment ratio", st.attachmentRatio != null ? `${st.attachmentRatio}%` : null) + secRow("Limit ratio", st.limitRatio != null ? `${st.limitRatio}%` : null) + secRow("Subject premium", f(st.subjectPremium)) + secRow("Loss-ratio basis", st.lossRatioBasis);
    default: return (st.layers || []).map((l, i) => secRow(`Layer ${i + 1}`, `${layerLabel(l, (n) => fmt(n, a.ccy))} · ${l.reinstatements ?? "—"} reinst.${l.premium != null ? ` · ${fmtFull(l.premium, a.ccy)}` : ""}`)).join("") + (a.type === "Catastrophe XoL" ? secRow("Event definition", st.eventDefinition) : "") + secRow("Premium basis", st.premiumBasis);
  }
}

function stepSummary() {
  const a = asAgreement();
  const checks = activationChecklist(a);
  const ok = canActivate(a);
  const rp = a.reporting;
  return `<div class="banner${ok ? "" : " warn"}">${ok ? icons.check : icons.info}${ok ? "Every hard gate is satisfied. Activate to make this agreement live, or save it as Draft Setup." : "Some gates are not met. The agreement can be saved as Draft Setup and completed later; it cannot be activated yet."}</div>
  <div class="panel-title" style="font-size:12.5px;">Documents on file</div>
  <div class="doc-checks">${DOC_CHECKS.map((t) => { const has = draft.documents.some((d) => d.type === t); return `<label class="doc-check"><input type="checkbox" data-doc="${t}"${has ? " checked" : ""}> ${t}</label>`; }).join("")}</div>
  <div class="field" style="margin-top:8px;"><label for="w-endorsements">Existing endorsements <span class="optional-tag">one per line</span></label>
    <textarea id="w-endorsements" rows="2" placeholder="E1 · 2026-04-01 · Reinstatements amended">${esc(draft.endorsements.map((e) => e.summary).join("\n"))}</textarea></div>
  <div class="panel-title" style="font-size:12.5px; margin-top:14px;">Validation checklist</div>
  <ul class="checklist">${checks.map((c) => `<li class="check-item ${c.state}"><span class="check-glyph">${c.state === "done" ? "✓" : c.state === "blocking" ? "!" : "○"}</span><span class="check-text"><span class="check-label">${c.label}</span><span class="check-detail">${esc(c.detail)}</span></span></li>`).join("")}</ul>
  <div class="summary" style="margin-top:14px;">
    ${section("Agreement", secRow("Number", a.id) + secRow("Name", a.name) + secRow("Cedant", a.cedant) + secRow("Class", a.cls) + secRow("Type", a.type) + secRow("Period", a.inception && a.expiry ? `${a.inception} → ${a.expiry}` : null) + secRow("Original inception", a.originalInception) + secRow("Currency", a.ccy) + secRow("Source", a.source))}
    ${section("Structure", structureRows(a))}
    ${section("Reinsurer panel", (a.panel.map((p) => secRow(`${p.reinsurer || "—"} · ${p.role}`, `${p.share}%${p.brokeragePct != null ? ` · brokerage ${p.brokeragePct}%` : ""}${p.marketRef ? ` · ${p.marketRef}` : ""}`)).join("") || secRow("Reinsurers", null)) + `<div class="summary-row emphasis ${panelComplete(a.panel) ? "good" : "bad"}"><span>Total signed share</span><span>${panelTotal(a.panel).toFixed(2)}%</span></div>`)}
    ${section("Reporting & accounting", secRow("Premium bordereaux", rp.premiumBdxFrequency) + secRow("Claims bordereaux", rp.claimsBdxFrequency) + secRow("Accounting", rp.accountingFrequency) + secRow("Reporting deadline", rp.reportingDeadlineDays != null && rp.reportingDeadlineDays !== "" ? `${rp.reportingDeadlineDays} days` : null) + secRow("Payment warranty", rp.paymentWarrantyDays ? `${rp.paymentWarrantyDays} days` : null) + secRow("Brokerage", rp.brokeragePct != null && rp.brokeragePct !== "" ? `${rp.brokeragePct}%` : null) + secRow("Commission", rp.commissionPct != null && rp.commissionPct !== "" ? `${rp.commissionPct}%` : null) + secRow("Tax", rp.taxPct != null && rp.taxPct !== "" ? `${rp.taxPct}%` : null) + secRow("Settlement currency", rp.settlementCcy) + secRow("Individual declarations", rp.declarationsRequired ? "Required" : "Not required") + secRow("Cash-call threshold", rp.cashCallThreshold != null && rp.cashCallThreshold !== "" ? fmtFull(rp.cashCallThreshold, a.ccy) : null))}
  </div>`;
}

const STEPS = [stepBasics, stepStructure, stepPanel, stepReporting, stepSummary];

/* ---------- shell ---------- */

function shell() {
  const ok = step === 4 && canActivate(asAgreement());
  return `<div class="modal-backdrop"><div class="modal" style="max-width:${step === 1 || step === 2 ? "820px" : "680px"};">
    <div class="modal-head"><div>
      <div class="panel-title" style="margin:0;">${editingId ? `Continue setup · ${editingId}` : "Register Treaty Agreement"}</div>
      <div class="panel-sub" style="margin:2px 0 0;">Step ${step + 1} of 5 · ${STEP_LABELS[step]}</div></div>
      <button class="close-x" data-action="close-modal">✕</button></div>
    <div class="modal-body" id="tw-body">${STEPS[step]()}</div>
    <div class="modal-foot">
      <div class="step-dots">${[0, 1, 2, 3, 4].map((i) => `<span class="${i <= step ? "active" : ""}"></span>`).join("")}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
        <button class="btn" data-tw="back" ${step === 0 ? "disabled" : ""}>Back</button>
        ${step < 4 ? `<button class="btn primary" data-tw="next">Continue</button>`
          : `<button class="btn${ok ? "" : " primary"}" data-tw="save">Save as Draft Setup</button>${ok ? `<button class="btn primary" data-tw="activate">Activate Agreement</button>` : ""}`}
      </div></div></div></div>`;
}

const repaint = () => updateModal(shell(), { onMount: wire });

function capture() {
  $$("#tw-body [data-k]").forEach((el) => {
    const k = el.dataset.k;
    if (step === 0) draft[k] = el.value;
    else if (step === 1) { if (k === "layerMode") { s().layerMode = el.value; } else s()[k] = el.value; }
    else if (step === 3) r()[k] = k === "declarationsRequired" ? el.value === "Yes" : el.value;
  });
  $$("#tw-body [data-layer]").forEach((el) => { layers()[+el.dataset.layer][el.dataset.lk] = el.value; });
  $$("#tw-body [data-panel]").forEach((el) => { draft.panel[+el.dataset.panel][el.dataset.pk] = el.value; });
  if (step === 4) {
    const kept = draft.documents.filter((d) => !DOC_CHECKS.includes(d.type));
    $$("#tw-body [data-doc]").forEach((cb) => { if (cb.checked) kept.push(draft.documents.find((d) => d.type === cb.dataset.doc) || { name: `${cb.dataset.doc} — ${draft.id || "agreement"}.pdf`, type: cb.dataset.doc, date: todayISO() }); });
    draft.documents = kept;
    draft.endorsements = ($("#w-endorsements")?.value || "").split("\n").map((t) => t.trim()).filter(Boolean).map((summary, i) => ({ ref: draft.endorsements[i]?.ref || `E${i + 1}`, summary }));
  }
}

function wire() {
  const body = $("#tw-body");
  body.addEventListener("click", (e) => {
    if (e.target.closest("[data-add-layer]")) { capture(); const last = layers().at(-1); layers().push({ limit: "", attachment: (Number(last.attachment) || 0) + (Number(last.limit) || 0) || "", reinstatements: "", premium: "" }); s().layerMode = "Multiple layers"; return repaint(); }
    const rl = e.target.closest("[data-remove-layer]"); if (rl) { capture(); layers().splice(+rl.dataset.removeLayer, 1); return repaint(); }
    if (e.target.closest("[data-add-panel]")) { capture(); draft.panel.push({ reinsurer: "", share: "", role: draft.panel.length ? "Follow" : "Lead", brokeragePct: r().brokeragePct ?? "", marketRef: "" }); return repaint(); }
    const rp = e.target.closest("[data-remove-panel]"); if (rp) { capture(); draft.panel.splice(+rp.dataset.removePanel, 1); return repaint(); }
  });
  body.addEventListener("input", (e) => {
    if (e.target.dataset.pk === "share") { capture(); mount("#w-panel-out", panelTotalLine()); }
    if (e.target.dataset.lk === "limit" || e.target.dataset.lk === "attachment") { capture(); const i = +e.target.dataset.layer; const note = e.target.closest(".layer-grid")?.querySelector(".layer-note"); const l = layers()[i]; if (note && l.limit) note.textContent = layerLabel(l, (n) => fmt(n, draft.ccy)); }
    if (e.target.dataset.k === "layerMode" && e.target.value === "Multiple layers" && layers().length === 1) { capture(); layers().push({ limit: "", attachment: (Number(layers()[0].attachment) || 0) + (Number(layers()[0].limit) || 0) || "", reinstatements: "", premium: "" }); repaint(); }
  });
  body.addEventListener("change", (e) => { if (e.target.dataset.k === "type" && !editingId) { capture(); draft.structure = {}; } });
  $("[data-tw='back']").addEventListener("click", () => { capture(); errors = {}; if (step > 0) step--; repaint(); });
  $("[data-tw='next']")?.addEventListener("click", next);
  $("[data-tw='save']")?.addEventListener("click", () => finish(false));
  $("[data-tw='activate']")?.addEventListener("click", () => finish(true));
}

function next() {
  capture(); errors = {};
  const a = asAgreement();
  if (step === 0) {
    errors = validateBasics(a);
    if (!editingId && a.id && agreementById(a.id)) errors.id = `Agreement number ${a.id} is already registered.`;
    if (a.cedant && !state.cedants.some((c) => c.name.toLowerCase() === a.cedant.toLowerCase())) errors.cedant = `"${a.cedant}" is not on the cedant registry.`;
  }
  if (step === 1) {
    // Hard errors block; a partially filled structure may still move on (it stays Draft Setup).
    const all = validateStructure(a.type, a.structure);
    Object.entries(all).forEach(([k, v]) => { if (/must|cannot|exceed|total 100|should equal/.test(v) && !/greater than zero|at least one|Add at least|Enter the|State the|whole number of at least/.test(v)) errors[k] = v; });
  }
  if (step === 2) errors = validatePanel(a.panel);
  if (Object.keys(errors).length) { repaint(); return; }
  step++; repaint();
}

function finish(activate) {
  capture(); errors = {};
  const a = asAgreement();
  if (editingId) {
    const res = updateAgreement(editingId, { basics: { name: a.name, cedant: a.cedant, cls: a.cls, inception: a.inception, expiry: a.expiry, originalInception: a.originalInception, ccy: a.ccy, source: a.source }, structure: a.structure, panel: a.panel, reporting: a.reporting });
    if (res?.errors) { errors = res.errors; step = 0; repaint(); return; }
    a.documents.forEach((d) => { const live = agreementById(editingId); if (!live.documents.some((x) => x.type === d.type)) live.documents.unshift({ ...d, from: "Broker", version: 1 }); });
    if (activate) activateAgreement(editingId);
    closeModal(); onDone?.(editingId); return;
  }
  const res = registerAgreement(a, { activate });
  if (res.errors) { errors = res.errors; step = errors.id || errors.name || errors.cedant || errors.type || errors.ccy ? 0 : Object.keys(errors).some((k) => k.startsWith("panel")) ? 2 : 1; repaint(); return; }
  closeModal(); onDone?.(res.agreement.id);
}

/**
 * Open the wizard blank, or on an existing Draft Setup agreement to continue it.
 * @param {(agreementId:string) => void} [onSaved]
 * @param {{ agreementId?: string }} [opts]
 */
export function openTreatyWizard(onSaved, { agreementId } = {}) {
  step = 0; errors = {}; editingId = null; onDone = onSaved || null;
  draft = blank();
  const existing = agreementId ? agreementById(agreementId) : null;
  if (existing && existing.status === "Draft Setup") {
    editingId = existing.id;
    Object.assign(draft, JSON.parse(JSON.stringify({ id: existing.id, name: existing.name, cedant: existing.cedant, cls: existing.cls, inception: existing.inception || "", expiry: existing.expiry || "", originalInception: existing.originalInception || "", ccy: existing.ccy, type: existing.type, source: existing.source, structure: existing.structure || {}, panel: existing.panel || [], reporting: existing.reporting || {}, documents: existing.documents || [], endorsements: existing.endorsements || [] })));
    Object.keys(draft.structure).forEach((k) => { if (draft.structure[k] == null) draft.structure[k] = ""; });
    (draft.structure.layers || []).forEach((l) => Object.keys(l).forEach((k) => { if (l[k] == null) l[k] = ""; }));
    Object.keys(draft.reporting).forEach((k) => { if (draft.reporting[k] == null) draft.reporting[k] = ""; });
    draft.panel.forEach((p) => Object.keys(p).forEach((k) => { if (p[k] == null) p[k] = ""; }));
  }
  openModal(shell(), { onMount: wire });
}
