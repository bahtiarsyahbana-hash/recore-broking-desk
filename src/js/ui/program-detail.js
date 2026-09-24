/**
 * Program lifecycle drawer — where a placement is walked from slip to bind.
 *
 * The drawer answers three questions in order, top to bottom:
 *   1. Where is this placement?      — the journey rail and substatus
 *   2. What do I do next, and why?   — the next-action card, with the button
 *   3. What is still holding it up?  — the release or bind checklist
 *
 * All of that reasoning comes from domain/lifecycle.js, so the guidance can
 * never drift from the rules that govern the transitions. The drawer only
 * reads state and paints; every action delegates to placement.service.js.
 */
import { $, onAction } from "../core/dom.js";
import { programById, currentUser, cedantNamed } from "../core/store.js";
import { fmt, fmtFull } from "../core/format.js";
import { statusPill, subBadge } from "./badges.js";
import { icons } from "./icons.js";
import { openModal, updateModal, closeModal } from "./modal.js";
import { openFormModal } from "./form-modal.js";
import { openWizard } from "./submission-wizard.js";
import { openBillingDetail } from "./billing-detail.js";
import { batchesForSource } from "../services/billing.service.js";
import { fromCents } from "../domain/billing.js";
import {
  LIFECYCLE_STEPS, stageOf, nextAction, bindChecklist, isPreMarket, isInMarket, normaliseStatus, STATUS,
} from "../domain/lifecycle.js";
import { releaseChecklist } from "../domain/slip-approval.js";
import { capacityUnits, isLayered, MARKET_RESPONSE_NEXT, layerLabel } from "../domain/panel.js";
import { paymentWarrantyLine } from "../domain/placement-terms.js";
import { EDITABLE_PLACEMENT_TYPES, PAYMENT_WARRANTY_DAYS, isValidPaymentWarranty } from "../domain/intake.js";
import {
  sendSlipToMarkets, addDocument, executeBinding, startRenewal,
  submitForApproval, releaseSlip, returnToDraft, reviseSlip,
  setSignedLine, removeMarketFromDraft, recordMarketResponse,
  recordProposalSent, recordCedantRevision, recordCedantApproval, recordBindInstruction,
  setDocumentDelivery, DELIVERY_STATUSES, setPaymentWarranty, recordEndorsement,
} from "../services/placement.service.js";

let openId = null;

/* ---------- 1. the journey rail ---------- */

function journey(program) {
  const stage = stageOf(program);
  const steps = LIFECYCLE_STEPS.map((label, i) => {
    const state = i < stage.stepIndex ? "done" : i === stage.stepIndex ? "current" : "todo";
    return `<li class="journey-step ${state}">
      <span class="journey-marker">${state === "done" ? "✓" : String(i + 1)}</span>
      <span class="journey-label">${label}</span>
    </li>`;
  }).join("");
  return `<ol class="journey" aria-label="Placement lifecycle">${steps}</ol>
    <div class="journey-sub">${statusPill(stage.status)} ${stage.substatus.toLowerCase() === stage.status.toLowerCase() ? "" : subBadge(stage.substatus, "info")}
      <span class="muted" style="font-size:11.5px;">Slip v${program.slipVersion || 1}${program.proposalVersion ? ` · Proposal v${program.proposalVersion}` : ""}</span></div>`;
}

/* ---------- 2. the next action ---------- */

const instructionsBox = (program) => `<div class="field" style="margin:14px 0 12px;">
  <label for="detail-instructions">Binding instructions <span class="optional-tag">optional</span></label>
  <textarea id="detail-instructions" rows="2"
    placeholder="e.g. Settle within 30 days via client account; subject to updated loss bordereau.">${program.bindingInstructions || ""}</textarea>
  <div class="hint">Payment terms, subjectivities and special conditions. Frozen into the bound terms.</div>
</div>`;

function nextActionCard(program) {
  const next = nextAction(program, { user: currentUser(), cedant: cedantNamed(program.cedant) });
  if (!next) {
    const bt = program.boundTerms;
    const batches = batchesForSource(null, program.id);
    const billingLine = batches.length
      ? `<div class="bill-links">${batches.map((b) => `<button class="btn ghost" style="padding:3px 8px; font-size:11px;" data-action="open-billing" data-ref="${b.ref}">${b.ref} · ${b.cedantDocType} · ${fmtFull(fromCents(b.computed.cedant.total), b.ccy)} · ${b.status}</button>`).join("")}</div>`
      : "";
    return `<div class="next-action done"><div class="next-action-body">
      <div class="next-action-kicker">${icons.check}Step ${LIFECYCLE_STEPS.length} of ${LIFECYCLE_STEPS.length} · bound issued</div>
      <h4>Bound${program.boundAt ? ` on ${program.boundAt}` : ""}</h4>
      <p>${bt ? `Terms frozen at slip v${bt.slipVersion}, proposal v${bt.proposalVersion}. Any change from here is an endorsement, not an edit.` : "Bound before versioned terms were kept on the record."} Instructions on file: ${program.bindingInstructions || "none recorded"}. ${batches.length ? "Billing is prepared in Finance and issued under four-eyes." : "Billed before invoices went through Finance."} This placement re-opens for renewal 60 days before ${program.expiry}.</p>
      ${billingLine}
      <div class="next-action-actions"><button class="btn next-action-secondary" data-action="endorse">Raise endorsement invoice</button></div>
    </div></div>`;
  }
  const isDraft = normaliseStatus(program.status) === STATUS.DRAFT;
  const button = `<button class="btn primary next-action-btn" data-action="${next.action}"${next.blocked ? " disabled" : ""}>${next.actionLabel}</button>`;
  const secondary = next.secondaryAction
    ? `<button class="btn next-action-secondary" data-action="${next.secondaryAction.action}">${next.secondaryAction.label}</button>` : "";
  const complete = isDraft && EDITABLE_PLACEMENT_TYPES.includes(program.type)
    ? `<button class="btn next-action-secondary" data-action="complete-draft">Open in wizard</button>` : "";
  return `<div class="next-action${next.blocked ? " blocked" : ""}"><div class="next-action-body">
    <div class="next-action-kicker">Do this next · step ${next.stepIndex + 1} of ${LIFECYCLE_STEPS.length}</div>
    <h4>${next.title}</h4>
    <p>${next.detail}</p>
    ${next.needsInstructions ? instructionsBox(program) : ""}
    ${next.blockedReason ? `<div class="next-action-block">${icons.info}${next.blockedReason}</div>` : ""}
    <div class="next-action-actions">${button}${secondary}${complete}</div>
  </div></div>`;
}

/* ---------- 3. the gate, stated plainly ---------- */

function checklist(program) {
  if (normaliseStatus(program.status) === STATUS.BOUND) return "";
  const preMarket = isPreMarket(program);
  const items = preMarket ? releaseChecklist(program, cedantNamed(program.cedant), currentUser()) : bindChecklist(program);
  const rows = items.map((item) => {
    const glyph = item.state === "done" ? "✓" : item.state === "blocking" ? "!" : item.state === "optional" ? "○" : "·";
    return `<li class="check-item ${item.state}"><span class="check-glyph">${glyph}</span>
      <span class="check-text"><span class="check-label">${item.label}</span><span class="check-detail">${item.detail}</span></span></li>`;
  }).join("");
  return `<div class="panel-title" style="font-size:12.5px;">${preMarket ? "Before this slip can be placed" : "Before this can bind"}</div>
    <ul class="checklist">${rows}</ul>`;
}

function provenance(program) {
  const line = (label, who) => who ? `<div class="confirm-row"><span>${label}</span><span class="prov-who">${who.name} · ${who.title}</span></div>` : "";
  const cedantLine = (label, rec) => rec ? `<div class="confirm-row"><span>${label}</span><span class="prov-who">${rec.at} · ${rec.by}${rec.reference ? ` · ${rec.reference}` : ""}</span></div>` : "";
  if (!program.preparedBy && !program.approvedBy && !program.cedantApproval && !program.bindInstruction) return "";
  return `<div class="panel-title" style="font-size:12.5px; margin-top:16px;">Authority trail</div>
    ${line("Prepared by", program.preparedBy)}
    ${line("Placed by", program.approvedBy)}
    ${cedantLine("Cedant approved", program.cedantApproval)}
    ${cedantLine("Instruction to bind", program.bindInstruction)}
    ${line("Bound by", program.boundBy)}
    ${program.releasedUnderOverride ? `<div class="override-note">${icons.info}Placed under administrator override — the preparer approved their own submission.</div>` : ""}`;
}

/* ---------- terms, panel, documents, history ---------- */

/**
 * Payment warranty as a value, or — on a draft — a select that sets it. Legacy
 * records without the field show "Not set" and cannot be submitted until a
 * period is chosen here or in the wizard; nothing is defaulted for them.
 */
function warrantyCell(program) {
  const days = program.terms?.paymentWarrantyDays;
  if (normaliseStatus(program.status) !== STATUS.DRAFT) return paymentWarrantyLine(days);
  return `<select data-warranty aria-label="Payment warranty" style="padding:4px 6px; font-size:12px;">
    <option value=""${isValidPaymentWarranty(days) ? "" : " selected"}>Select…</option>
    ${PAYMENT_WARRANTY_DAYS.map((d) => `<option value="${d}"${Number(days) === d ? " selected" : ""}>${d} days</option>`).join("")}
  </select>`;
}

function termsPanel(program) {
  const t = program.terms || {};
  const frozen = Boolean(program.boundTerms);
  const isDraft = normaliseStatus(program.status) === STATUS.DRAFT;
  if (!t.insured && !t.sumInsured && !isDraft) {
    return `<div class="panel-title" style="font-size:12.5px;">Terms</div>
      <div class="confirm-row"><span>Payment warranty</span><span>${paymentWarrantyLine(t.paymentWarrantyDays)}</span></div>`;
  }
  return `<div class="panel-title" style="font-size:12.5px;">Terms${frozen ? ` <span class="sub-badge good">frozen at bind</span>` : ""}</div>
    ${t.insured || t.sumInsured ? `<div class="confirm-row"><span>Insured</span><span>${t.insured || "—"}</span></div>
    <div class="confirm-row"><span>Sum insured</span><span>${t.sumInsured ? fmtFull(t.sumInsured, program.ccy) : "—"}</span></div>
    <div class="confirm-row"><span>Rate</span><span>${t.rate != null && t.rate !== "" ? `${t.rate}%` : "to be quoted"}</span></div>` : ""}
    <div class="confirm-row"><span>Payment warranty</span><span>${warrantyCell(program)}</span></div>`;
}

function allocationRow(program, mc, layer, editable, inMarket) {
  const layerAttr = layer != null ? ` data-layer="${layer}"` : "";
  if (editable) {
    return `<div class="confirm-row"><span>${mc.m}${mc.offered != null ? ` <span class="signed-line">offered ${mc.offered}%</span>` : ""}</span>
      <span class="line-edit">
        <input type="number" min="0" max="100" step="1" value="${mc.line ?? 0}" data-line-for="${mc.m}"${layerAttr} aria-label="Signed line for ${mc.m}">
        <span class="line-pct">%</span>
        <button class="btn ghost line-remove" data-action="remove-market" data-market="${mc.m}"${layerAttr} title="Take ${mc.m} off the slip">✕</button>
      </span></div>`;
  }
  const canRecord = inMarket && (MARKET_RESPONSE_NEXT[mc.s || "Sent"] || []).length > 0;
  return `<div class="confirm-row"><span>${mc.m}${mc.line ? ` <span class="signed-line">${mc.line}%</span>` : ""}</span>
    <span style="display:flex; gap:6px; align-items:center;">${statusPill(mc.s || "Sent")}${
      canRecord ? `<button class="btn ghost" style="padding:3px 8px; font-size:11px;" data-action="record-response" data-market="${mc.m}"${layerAttr}>Record</button>` : ""}</span></div>`;
}

function marketPanel(program) {
  const editable = normaliseStatus(program.status) === STATUS.DRAFT;
  const inMarket = isInMarket(program);
  const units = capacityUnits(program, fmt);
  const blocks = units.map((u, i) => {
    const layer = isLayered(program) ? i : null;
    const measure = isPreMarket(program)
      ? `Signed ${u.signed.toFixed(0)}%${u.signedComplete ? " — fully placed" : ` — ${(100 - u.signed).toFixed(0)}% outstanding`}`
      : `Confirmed ${u.confirmed.toFixed(0)}% of signed ${u.signed.toFixed(0)}%${u.backupSecured ? " — backup secured" : ""}`;
    const bar = isPreMarket(program) ? "" : `<div class="confirm-bar"><span style="width:${Math.min(100, u.confirmed)}%"></span></div>`;
    return `${isLayered(program) ? `<div class="layer-head">${u.label}</div>` : ""}
      <div class="confirm-progress">${bar}<div class="confirm-count">${measure}</div></div>
      ${u.entries.map((mc) => allocationRow(program, mc, layer, editable, inMarket)).join("") || `<div class="empty" style="padding:12px;">No markets on this ${isLayered(program) ? "layer" : "slip"}.</div>`}`;
  }).join("");
  return `<div class="panel-title" style="font-size:12.5px; margin-top:16px;">${isPreMarket(program) ? "Market panel" : "Market responses"}</div>${blocks}`;
}

function documentPanel(program) {
  const docs = program.documents || [];
  const rows = docs.length ? docs.map((d, i) => `<div class="doc-row"><span>
      <span class="d-name">${d.name}</span><br>
      <span class="d-meta">${d.type}${d.version ? ` v${d.version}` : ""} · from ${d.from}${d.recipient ? ` to ${d.recipient}` : ""} · ${d.date}</span>
    </span>
    <span style="display:flex; gap:6px; align-items:center;">${d.delivery ? statusPill(d.delivery) : ""}${
      d.delivery && d.delivery !== "Acknowledged" && d.delivery !== "Filed"
        ? `<button class="btn ghost" style="padding:3px 8px; font-size:11px;" data-action="advance-delivery" data-i="${i}">→ ${DELIVERY_STATUSES[DELIVERY_STATUSES.indexOf(d.delivery) + 1]}</button>` : ""}</span></div>`).join("")
    : `<div class="empty" style="padding:16px;">No documents yet.</div>`;
  return `<div class="panel-title" style="font-size:12.5px; margin-top:16px;">Documents
      <button class="btn ghost" style="padding:2px 8px; font-size:11px; float:right;" data-action="add-document">+ File a note</button></div>${rows}`;
}

function historyPanel(program) {
  const rows = (program.history || []).slice().reverse().map((h) => `<div class="hist-row">
    <span class="hist-when">${h.at}</span>
    <span class="hist-what"><strong>${h.action}</strong>${h.notes ? ` — ${h.notes}` : ""}<span class="hist-who">${h.actor} · slip v${h.slipVersion}${h.proposalVersion ? ` · proposal v${h.proposalVersion}` : ""}</span></span>
  </div>`).join("");
  return `<div class="panel-title" style="font-size:12.5px; margin-top:16px;">History</div>${rows || `<div class="empty" style="padding:12px;">No history recorded — this placement predates the audit trail.</div>`}`;
}

/* ---------- assembly ---------- */

function body(program) {
  return journey(program) + nextActionCard(program)
    + `<div class="cols-2" style="margin-top:18px;">
        <div>${termsPanel(program)}${marketPanel(program)}${documentPanel(program)}</div>
        <div>${checklist(program)}${provenance(program)}${historyPanel(program)}</div>
      </div>`;
}

function shell(p) {
  return `<div class="modal-backdrop">
    <div class="modal" style="max-width:820px;">
      <div class="modal-head">
        <div>
          <div class="panel-title" style="margin:0;">${p.id} · ${p.cedant}</div>
          <div class="panel-sub" style="margin:2px 0 0;">${p.cls} · ${p.type} · ${p.structure}${p.intakeRef ? ` · from ${p.intakeRef}` : ""}</div>
        </div>
        <button class="close-x" data-action="close-modal" aria-label="Close">✕</button>
      </div>
      <div class="modal-body" id="detail-body">${body(p)}</div>
    </div>
  </div>`;
}

/* ---------- prompts ---------- */

/** Ask for notes (and optionally a reference), then run `then` and repaint. */
function prompt({ title, subtitle, submitLabel, reference = false, notesRequired = false }, then) {
  openFormModal({
    title, subtitle, submitLabel,
    fields: [
      ...(reference ? [{ name: "reference", label: "Reference", type: "text", required: true, placeholder: "Cedant's instruction reference, email subject or letter number" }] : []),
      { name: "notes", label: "Notes", type: "textarea", rows: 3, required: notesRequired },
    ],
    onSubmit: (values) => { then(values); if (openId) reopen(); },
  });
}

function responsePrompt(market, layer) {
  const p = programById(openId);
  const mc = isLayered(p) ? p.layers[Number(layer)]?.markets.find((x) => x.m === market) : p.marketConfirmations.find((x) => x.m === market);
  if (!mc) return;
  const nextOptions = MARKET_RESPONSE_NEXT[mc.s || "Sent"] || [];
  openFormModal({
    title: `Record response — ${market}`,
    subtitle: `${isLayered(p) ? `${layerLabel(p.layers[Number(layer)], fmt)} · ` : ""}currently ${mc.s || "Sent"} · signed ${mc.line}%`,
    fields: [
      { name: "response", label: "Response", type: "select", options: nextOptions, value: nextOptions[0] },
      { name: "line", label: "Signed line % (if changed)", type: "number", value: mc.line ?? 0, half: true, validate: (v) => Number(v) >= 0 && Number(v) <= 100 ? null : "0–100" },
      { name: "notes", label: "Notes", type: "textarea", rows: 2, placeholder: "What the market said, and where it is recorded" },
    ],
    submitLabel: "Record",
    onSubmit: ({ response, line, notes }) => {
      recordMarketResponse(openId, market, response, { layer, notes, line });
      reopen();
    },
  });
}

function wire() {
  document.querySelector("[data-warranty]")?.addEventListener("change", (e) => {
    if (setPaymentWarranty(openId, e.target.value)) repaint();
  });
  document.querySelectorAll("[data-line-for]").forEach((input) => {
    const commit = () => { setSignedLine(openId, input.dataset.lineFor, input.value, input.dataset.layer); repaint(); };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
  });

  onAction("#modal-root", {
    "start-renewal": () => { startRenewal(openId); repaint(); },
    "submit-approval": () => { submitForApproval(openId); repaint(); },
    "release-slip": () => { releaseSlip(openId); repaint(); },
    "return-to-draft": () => prompt({ title: "Return to preparer", submitLabel: "Return", notesRequired: true }, ({ notes }) => returnToDraft(openId, notes)),
    "revise-slip": () => prompt({
      title: "Revise slip",
      subtitle: "Opens a new slip version as a draft. Every market response resets, any proposal, cedant approval or bind instruction is void, and the revised slip goes back through internal approval and placement.",
      submitLabel: "Revise and edit", notesRequired: true,
    }, ({ notes }) => {
      const id = openId;
      const revised = reviseSlip(id, notes);
      // Hand straight to the edit flow so the revision actually changes something.
      if (revised && EDITABLE_PLACEMENT_TYPES.includes(revised.type)) {
        closeModal();
        openWizard((pid) => openProgramDetail(pid), { programId: id });
        openId = null;
      }
    }),
    "complete-draft": () => { const id = openId; closeModal(); openWizard((pid) => openProgramDetail(pid), { programId: id }); },
    "remove-market": ({ market, layer }) => { removeMarketFromDraft(openId, market, layer); repaint(); },
    "send-slip": () => { sendSlipToMarkets(openId); repaint(); },
    "record-response": ({ market, layer }) => responsePrompt(market, layer),
    "add-document": () => openFormModal({
      title: "File a document", fields: [
        { name: "name", label: "Name", type: "text", required: true },
        { name: "type", label: "Type", type: "select", options: ["Negotiation", "Correspondence", "Endorsement", "Amendment", "Other"], value: "Negotiation", half: true },
        { name: "recipient", label: "Recipient", type: "text", value: "Internal", half: true },
      ], submitLabel: "File", onSubmit: (v) => { addDocument(openId, v); reopen(); },
    }),
    "advance-delivery": ({ i }) => {
      const doc = programById(openId)?.documents?.[Number(i)];
      const next = DELIVERY_STATUSES[DELIVERY_STATUSES.indexOf(doc?.delivery) + 1];
      if (next) { setDocumentDelivery(openId, Number(i), next); repaint(); }
    },
    "proposal-sent": () => prompt({ title: "Record proposal sent", subtitle: "Terms and the confirmed panel sent to the cedant for decision", submitLabel: "Record" }, ({ notes }) => recordProposalSent(openId, notes)),
    "cedant-revision": () => prompt({ title: "Cedant requested revision", subtitle: "Any approval or instruction already recorded will be invalidated", submitLabel: "Record", notesRequired: true }, ({ notes }) => recordCedantRevision(openId, notes)),
    "cedant-approved": () => prompt({ title: "Record cedant approval", subtitle: "Approval of terms only — not an instruction to bind", submitLabel: "Record approval" }, ({ notes }) => recordCedantApproval(openId, notes)),
    "bind-instructed": () => prompt({ title: "Record instruction to bind", subtitle: "The cedant's explicit instruction, with its reference", submitLabel: "Record instruction", reference: true }, (v) => recordBindInstruction(openId, v)),
    "bind": () => { executeBinding(openId, $("#detail-instructions")?.value); repaint(); },
    "open-billing": ({ ref }) => { closeModal(); openBillingDetail(ref); },
    "endorse": () => {
      const p = programById(openId);
      const id = openId;
      openFormModal({
        title: `Raise endorsement invoice — ${p.id}`,
        subtitle: `Bound terms stay frozen. The premium change is billed from the endorsement date + ${p.terms?.paymentWarrantyDays ? `${p.terms.paymentWarrantyDays} days` : "the payment warranty chosen on the draft"}.`,
        fields: [
          { name: "ref", label: "Endorsement reference", type: "text", placeholder: `E${(p.endorsements?.length || 0) + 1}`, half: true },
          { name: "date", label: "Endorsement date", type: "date", required: true, half: true },
          { name: "premium", label: `Premium change (${p.ccy})`, type: "number", required: true, hint: "Positive for additional premium (debit note), negative for return premium (credit note)." },
          { name: "notes", label: "What changed", type: "textarea", rows: 2 },
        ],
        submitLabel: "Record and draft billing",
        validate: (v) => {
          const e = {};
          if (!(Number(v.premium) !== 0 && Number.isFinite(Number(v.premium)))) e.premium = "Enter a non-zero premium change.";
          if (v.ref && (p.endorsements || []).some((x) => x.ref === v.ref.trim())) e.ref = `Endorsement ${v.ref} already exists.`;
          return e;
        },
        onSubmit: (v) => {
          const res = recordEndorsement(id, v);
          if (res.batch) openBillingDetail(res.batch.ref); else openProgramDetail(id);
        },
      });
    },
  });
}

function repaint() {
  const p = programById(openId);
  if (!p) return closeModal();
  updateModal(shell(p), { onMount: wire });
}

/** Re-open after a nested form modal replaced the drawer. */
function reopen() {
  const p = programById(openId);
  if (p) openModal(shell(p), { onMount: wire, onDismiss: () => { openId = null; } });
}

/** Open the lifecycle drawer on a program. */
export function openProgramDetail(id) {
  const p = programById(id);
  if (!p) return;
  openId = id;
  openModal(shell(p), { onMount: wire, onDismiss: () => { openId = null; } });
}
