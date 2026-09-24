/**
 * Intake drawer — one request for cover, its data, its history and the
 * decision the broker takes on it. Reads state and paints; every action
 * delegates to intake.service.js.
 */
import { onAction } from "../core/dom.js";
import { intakeById, state } from "../core/store.js";
import { fmtFull } from "../core/format.js";
import { statusPill, typeBadge } from "./badges.js";
import { icons } from "./icons.js";
import { openModal, updateModal, closeModal } from "./modal.js";
import { openFormModal } from "./form-modal.js";
import {
  INTAKE_CHANNELS, PLACEMENT_TYPES, PAYMENT_WARRANTY_DAYS, intakeReadiness, intakeEditable, intakeOpen,
} from "../domain/intake.js";
import {
  startReview, requestRevision, resumeReview, declineIntake, acceptIntake, updateIntake,
} from "../services/intake.service.js";
import { paymentWarrantyLine } from "../domain/placement-terms.js";

/** This drawer's own element. Listeners bound here die with it, so they never fire for another drawer. */
const drawerRoot = () => document.querySelector("#modal-root > .modal-backdrop");

let openId = null;
let afterConvert = null;

const CLASSES = ["Property", "Casualty", "Marine", "Motor"];
const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "IDR"];

const row = (label, value) => `<div class="summary-row"><span>${label}</span><span>${value}</span></div>`;

function details(i) {
  return `<div class="summary">
    <div class="summary-section">
      <div class="summary-head">Request</div>
      ${row("Cedant", i.cedant || "<span class='muted'>not set</span>")}
      ${row("Insured", i.insuredName || "<span class='muted'>not set</span>")}
      ${row("Class of business", i.cls || "—")}
      ${row("Requested placement type", i.requestedType ? typeBadge(i.requestedType) : "—")}
      ${row("Sum insured", i.sumInsured ? fmtFull(i.sumInsured, i.ccy) : "—")}
      ${row("Rate", i.rate != null ? `${i.rate}%` : "<span class='muted'>to be quoted</span>")}
      ${row("Payment warranty", paymentWarrantyLine(i.paymentWarrantyDays))}
    </div>
    <div class="summary-section">
      <div class="summary-head">Source</div>
      ${row("Source", i.source === "portal" ? "Cedant portal" : i.source === "email" ? "Email integration" : "Recorded by broker")}
      ${row("Channel", i.channel)}
      ${row("Received from", i.receivedFrom || "—")}
      ${row("Received date", i.receivedDate)}
      ${i.notes ? row("Notes", i.notes) : ""}
      ${i.placementId ? row("Placement", `<button class="btn ghost" style="padding:3px 8px;" data-action="open-placement" data-id="${i.placementId}">${i.placementId} →</button>`) : ""}
    </div>
  </div>`;
}

function decision(i) {
  const findings = intakeReadiness(i);
  const blocked = findings.length > 0;
  const s = i.status;
  if (!intakeOpen(i)) {
    return `<div class="next-action done"><div class="next-action-body">
      <div class="next-action-kicker">${icons.check}${s}</div>
      <h4>${s === "Declined" ? "Declined — kept for the record" : `Converted to placement ${i.placementId}`}</h4>
      <p>${s === "Declined" ? "The request was not taken on. The record stays here as evidence of what was asked and why it was declined." : "The intake is frozen. Everything the placement needs was copied to its draft slip; continue there."}</p>
      ${i.placementId ? `<div class="next-action-actions"><button class="btn primary" data-action="open-placement" data-id="${i.placementId}">Open placement</button></div>` : ""}
    </div></div>`;
  }
  const primary = s === "Received"
    ? { label: "Start review", action: "start-review", title: "Pick this up", detail: "Move it under review so the queue shows who is working it." }
    : s === "Revision Requested"
      ? { label: "Revision received — resume review", action: "resume-review", title: "Waiting on the requester", detail: "When the corrected details arrive, update the record and resume the review." }
      : { label: "Accept and open placement draft", action: "accept", title: "Decide", detail: "Accepting copies the request into a new Draft Slip and freezes this intake. Or ask for more, or decline." };
  return `<div class="next-action${blocked && s === "Under Review" ? " blocked" : ""}"><div class="next-action-body">
    <div class="next-action-kicker">Do this next</div>
    <h4>${primary.title}</h4>
    <p>${primary.detail}</p>
    ${blocked && s === "Under Review" ? `<div class="next-action-block">${icons.info}${findings.join(" ")}</div>` : ""}
    <div class="next-action-actions">
      <button class="btn primary" data-action="${primary.action}"${blocked && primary.action === "accept" ? " disabled" : ""}>${primary.label}</button>
      ${intakeEditable(i) ? `<button class="btn next-action-secondary" data-action="edit">Edit details</button>` : ""}
      ${s === "Under Review" ? `<button class="btn next-action-secondary" data-action="request-revision">Request revision</button>` : ""}
      ${s === "Under Review" || s === "Revision Requested" ? `<button class="btn next-action-secondary" data-action="decline">Decline</button>` : ""}
    </div>
  </div></div>`;
}

function history(i) {
  const rows = (i.history || []).slice().reverse().map((h) => `<div class="hist-row">
    <span class="hist-when">${h.at}</span>
    <span class="hist-what"><strong>${h.action}</strong>${h.notes ? ` — ${h.notes}` : ""}<span class="hist-who">${h.actor}</span></span>
  </div>`).join("");
  return `<div class="panel-title" style="font-size:12.5px; margin-top:18px;">History</div>${rows || `<div class="empty" style="padding:14px;">No history yet.</div>`}`;
}

const shell = (i) => `<div class="modal-backdrop">
  <div class="modal" style="max-width:680px;">
    <div class="modal-head">
      <div>
        <div class="panel-title" style="margin:0;">${i.id} · ${i.insuredName || "Unnamed insured"} ${statusPill(i.status)}</div>
        <div class="panel-sub" style="margin:2px 0 0;">${i.cedant || "Cedant not set"} · ${i.cls || "—"} · ${i.requestedType || "—"}</div>
      </div>
      <button class="close-x" data-action="close-modal" aria-label="Close">✕</button>
    </div>
    <div class="modal-body">${decision(i)}<div style="margin-top:16px;">${details(i)}</div>${history(i)}</div>
  </div>
</div>`;

/** Fields for creating or editing an intake, prefilled from `i` when given. */
export function intakeFields(i = {}) {
  return [
    { name: "cedant", label: "Cedant", type: "text", required: true, value: i.cedant || "", suggestions: state.cedants.map((c) => c.name), hint: "Must match a cedant on the registry.",
      validate: (v) => state.cedants.some((c) => c.name.toLowerCase() === v.toLowerCase()) ? null : "Not on the cedant registry." },
    { name: "insuredName", label: "Insured name", type: "text", required: true, value: i.insuredName || "" },
    { name: "cls", label: "Class of business", type: "select", options: CLASSES, value: i.cls || "Property", half: true },
    { name: "requestedType", label: "Requested placement type", type: "select", options: PLACEMENT_TYPES, value: i.requestedType || "Quota Share", half: true },
    { name: "sumInsured", label: "Sum insured", type: "number", required: true, value: i.sumInsured || "", half: true, validate: (v) => Number(v) > 0 ? null : "Must be greater than zero." },
    { name: "ccy", label: "Currency", type: "select", options: CURRENCIES, value: i.ccy || "USD", half: true },
    { name: "rate", label: "Rate % (when known)", type: "number", value: i.rate ?? "", half: true, placeholder: "e.g. 0.85" },
    { name: "paymentWarrantyDays", label: "Payment warranty (days)", type: "select", required: true,
      options: ["", ...PAYMENT_WARRANTY_DAYS.map(String)], value: i.paymentWarrantyDays != null ? String(i.paymentWarrantyDays) : "", half: true,
      hint: "Select the agreed payment warranty period.",
      validate: (v) => PAYMENT_WARRANTY_DAYS.includes(Number(v)) ? null : `Choose one of ${PAYMENT_WARRANTY_DAYS.join(", ")} days.` },
    { name: "channel", label: "Source channel", type: "select", options: INTAKE_CHANNELS, value: i.channel || "email", half: true },
    { name: "receivedDate", label: "Received date", type: "date", required: true, value: i.receivedDate || "", half: true },
    { name: "receivedFrom", label: "Received from", type: "text", value: i.receivedFrom || "", placeholder: "Name and company" },
    { name: "notes", label: "Notes", type: "textarea", rows: 3, value: i.notes || "" },
  ];
}

/** Notes prompt shared by revision and decline. */
function withNotes(title, submitLabel, then) {
  openFormModal({
    title, fields: [{ name: "notes", label: "Notes", type: "textarea", rows: 3, required: true }],
    submitLabel, onSubmit: ({ notes }) => { then(notes); reopen(); },
  });
}

function wire() {
  onAction(drawerRoot(), {
    "start-review": () => { startReview(openId); repaint(); },
    "resume-review": () => withNotes("Revision received", "Resume review", (n) => resumeReview(openId, n)),
    "request-revision": () => withNotes("Request revision", "Record request", (n) => requestRevision(openId, n)),
    "decline": () => withNotes("Decline intake", "Decline", (n) => declineIntake(openId, n)),
    "accept": () => {
      const result = acceptIntake(openId);
      if (result.error) { repaint(); return; }
      closeModal();
      afterConvert?.(result.programId);
    },
    "edit": () => {
      const i = intakeById(openId);
      openFormModal({
        title: `Edit ${i.id}`, subtitle: "Correct the captured request", fields: intakeFields(i), submitLabel: "Save changes",
        onSubmit: (values) => { updateIntake(openId, values); reopen(); },
      });
    },
    "open-placement": ({ id }) => { closeModal(); afterConvert?.(id); },
  });
}

function repaint() {
  const i = intakeById(openId);
  if (!i) return closeModal();
  updateModal(shell(i), { onMount: wire });
}

/** Re-open the drawer after a nested form modal replaced it. */
function reopen() {
  const i = intakeById(openId);
  if (i) openModal(shell(i), { onMount: wire, onDismiss: () => { openId = null; } });
}

/**
 * Open the intake drawer.
 * @param {(programId:string) => void} [onOpenPlacement] called when the intake converts or its placement is opened.
 */
export function openIntakeDetail(id, onOpenPlacement) {
  const i = intakeById(id);
  if (!i) return;
  openId = id;
  afterConvert = onOpenPlacement || null;
  openModal(shell(i), { onMount: wire, onDismiss: () => { openId = null; } });
}
