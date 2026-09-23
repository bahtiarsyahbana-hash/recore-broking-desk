/**
 * Counterparty drawer — one registry record, opened to view or manage.
 *
 * Three things a desk keeps on a counterparty, in the order it needs them:
 *   1. Company profile   — identity, domicile, codes, security, settlement terms
 *   2. Bank details      — where money settles, one or more accounts
 *   3. People in charge  — by the division they handle; a division can have
 *                          several PICs, and one person can appear once per division
 * plus the placements that already point at this name, read-only.
 *
 * The drawer reads state and paints; every write goes through
 * services/registry.service.js. The name is the referential key and cannot be
 * edited here.
 */
import { onAction } from "../core/dom.js";
import { state, counterpartyNamed, allCounterparties } from "../core/store.js";
import { fmtFull } from "../core/format.js";
import { statusPill, typeBadge, codeBadge, subBadge } from "./badges.js";
import { icons } from "./icons.js";
import { openModal, updateModal, closeModal } from "./modal.js";
import { openFormModal } from "./form-modal.js";
import { fieldsFor, SETTLEMENT_CURRENCIES } from "../views/broker/registry-fields.js";
import {
  DIVISIONS, picsByDivision, bankAccountsOf, maskAccount, validatePic, validateBankAccount, profileSummary,
} from "../domain/counterparty-profile.js";
import {
  categoryOf, updateCounterparty, addPic, updatePic, removePic,
  addBankAccount, updateBankAccount, removeBankAccount,
} from "../services/registry.service.js";
import { stageOf } from "../domain/lifecycle.js";

let openName = null;
let onOpenPlacement = null;

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const row = (label, value) => value ? `<div class="summary-row"><span>${label}</span><span>${value}</span></div>` : "";

/** Fields that belong to the PIC section rather than the company profile. */
const CONTACT_FIELDS = new Set([
  "contactName", "contactTitle", "contactPhone", "contactEmail",
  "claimsContactName", "claimsContactEmail", "accountsContactName", "accountsContactEmail",
]);

const CATEGORY_LABEL = {
  "reg-cedants": "Cedant", "reg-reinsurance": "Reinsurer", "reg-syndicates": "Lloyd's syndicate",
  "reg-brokers": "Broking partner", "reg-others": "Service counterparty",
};

/* ---------- 1. company profile ---------- */

function profile(c, categoryId) {
  const labels = {
    country: "Country of domicile", kyc: "KYC status", refreshed: "KYC last refreshed", lei: "LEI",
    syndicateNo: "Syndicate number", managingAgent: "Managing agent", rating: "Security rating", ratingAsAt: "Rating as at",
    panel: "Panel", marketForm: "Counterparty form", collateral: "Collateral held", role: "Role", status: "Status",
    commissionSplit: "Default commission split", regulator: "Home regulator", licenceNo: "Licence number",
    licenceCategory: "Licence category", ownership: "Ownership", settlementCurrency: "Settlement currency",
    paymentTerms: "Payment terms", address: "Registered address", notes: "Notes", source: "Source",
  };
  const format = (k, v) => k === "kyc" ? statusPill(v === "Current" ? "Active" : v)
    : k === "status" ? statusPill(v)
    : k === "commissionSplit" ? `${v}%`
    : esc(v);
  const rows = Object.entries(labels)
    .filter(([k]) => c[k] != null && c[k] !== "")
    .map(([k, label]) => row(label, format(k, c[k]))).join("");
  return `<div class="summary-section">
    <div class="summary-head" style="display:flex; justify-content:space-between; align-items:center;">
      <span>Company profile</span>
      <button class="btn ghost" style="padding:2px 8px; font-size:11px;" data-action="edit-profile">Edit</button>
    </div>
    ${row("Category", CATEGORY_LABEL[categoryId] || "—")}
    ${rows || `<div class="summary-row"><span class="muted">No profile details yet</span><span>—</span></div>`}
  </div>`;
}

/* ---------- 2. bank details ---------- */

function bankSection(c) {
  const accounts = bankAccountsOf(c);
  const rows = accounts.map((b) => `<div class="prof-row">
    <div class="prof-main">
      <div class="prof-name">${esc(b.bankName)}${b.primary ? ` ${subBadge("Primary", "good")}` : ""} <span class="sub-badge">${esc(b.ccy)}</span></div>
      <div class="prof-meta">${esc(b.accountName)} · ${b.accountNo ? `A/C ${maskAccount(b.accountNo)}` : ""}${b.iban ? ` · IBAN ${maskAccount(b.iban)}` : ""}${b.swift ? ` · ${esc(b.swift)}` : ""}${b.branch ? ` · ${esc(b.branch)}` : ""}</div>
      ${b.notes ? `<div class="prof-meta">${esc(b.notes)}</div>` : ""}
    </div>
    <div class="prof-actions">
      <button class="btn ghost" data-action="edit-bank" data-id="${b.id}">Edit</button>
      <button class="btn ghost line-remove" data-action="remove-bank" data-id="${b.id}" title="Remove account">✕</button>
    </div>
  </div>`).join("");
  return `<div class="summary-section">
    <div class="summary-head" style="display:flex; justify-content:space-between; align-items:center;">
      <span>Bank details</span>
      <button class="btn ghost" style="padding:2px 8px; font-size:11px;" data-action="add-bank">+ Add account</button>
    </div>
    ${rows || `<div class="empty" style="padding:14px;">No bank account on file. Settlement cannot be instructed without one.</div>`}
  </div>`;
}

/* ---------- 3. people in charge ---------- */

function picSection(c) {
  const groups = picsByDivision(c);
  const body = groups.map((g) => `<div class="prof-division">${esc(g.division)} <span class="kcol-count">${g.pics.length}</span></div>
    ${g.pics.map((p) => `<div class="prof-row">
      <div class="prof-main">
        <div class="prof-name">${esc(p.name)}${p.primary ? ` ${subBadge("Primary", "good")}` : ""}${p.legacy ? ` ${subBadge("from earlier record")}` : ""}</div>
        <div class="prof-meta">${[p.title, p.email ? `<a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : "", p.phone].filter(Boolean).join(" · ") || "No contact details"}</div>
        ${p.notes ? `<div class="prof-meta">${esc(p.notes)}</div>` : ""}
      </div>
      <div class="prof-actions">
        <button class="btn ghost" data-action="edit-pic" data-id="${p.id}">Edit</button>
        <button class="btn ghost line-remove" data-action="remove-pic" data-id="${p.id}" title="Remove PIC">✕</button>
      </div>
    </div>`).join("")}`).join("");
  return `<div class="summary-section">
    <div class="summary-head" style="display:flex; justify-content:space-between; align-items:center;">
      <span>People in charge</span>
      <button class="btn ghost" style="padding:2px 8px; font-size:11px;" data-action="add-pic">+ Add PIC</button>
    </div>
    ${body || `<div class="empty" style="padding:14px;">Nobody on file. Add the people who handle placement, claims and accounting for this counterparty.</div>`}
  </div>`;
}

/* ---------- linked placements (read-only) ---------- */

function linked(c) {
  const programs = state.programs.filter((p) => p.cedant === c.name || (p.marketConfirmations || []).some((mc) => mc.m === c.name));
  if (!programs.length) return "";
  return `<div class="summary-section">
    <div class="summary-head">Placements referencing this name</div>
    ${programs.map((p) => `<div class="summary-row">
      <span><button class="btn ghost" style="padding:2px 8px;" data-action="open-placement" data-id="${p.id}">${p.id}</button> ${typeBadge(p.type)} ${esc(p.terms?.insured || p.cls)}</span>
      <span>${statusPill(stageOf(p).status)} <span class="mono">${fmtFull(p.premium, p.ccy)}</span></span>
    </div>`).join("")}
  </div>`;
}

/* ---------- shell ---------- */

function shell(c) {
  const categoryId = categoryOf(c);
  const sum = profileSummary(c);
  return `<div class="modal-backdrop">
    <div class="modal" style="max-width:760px;">
      <div class="modal-head">
        <div>
          <div class="panel-title" style="margin:0;">${esc(c.name)} ${codeBadge(c)}</div>
          <div class="panel-sub" style="margin:2px 0 0;">${CATEGORY_LABEL[categoryId] || ""}${c.country ? ` · ${esc(c.country)}` : ""} · ${sum.pics} PIC${sum.pics === 1 ? "" : "s"} across ${sum.divisions} division${sum.divisions === 1 ? "" : "s"} · ${sum.bankAccounts} bank account${sum.bankAccounts === 1 ? "" : "s"}${c.profileUpdated ? ` · updated ${c.profileUpdated}` : ""}</div>
        </div>
        <button class="close-x" data-action="close-modal" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        ${!sum.hasBank || !sum.hasPic ? `<div class="banner warn">${icons.info}${!sum.hasPic ? "No person in charge is recorded. " : ""}${!sum.hasBank ? "No bank account is recorded. " : ""}The record is usable on a slip, but the desk cannot chase or settle without them.</div>` : ""}
        <div class="summary">${profile(c, categoryId)}${bankSection(c)}${picSection(c)}${linked(c)}</div>
      </div>
    </div>
  </div>`;
}

/* ---------- forms ---------- */

function profileForm(c) {
  const categoryId = categoryOf(c);
  const knownCountries = [...new Set(allCounterparties().map((x) => x.country).filter(Boolean))].sort();
  const fields = fieldsFor(categoryId, knownCountries)
    .filter((f) => f.name !== "name" && f.type !== "hidden" && !CONTACT_FIELDS.has(f.name))
    .map((f) => ({ ...f, section: f.section === "Primary contact (PIC)" ? "Address" : f.section, value: c[f.name] ?? (f.type === "select" ? f.value : "") }));
  openFormModal({
    title: `Edit ${c.name}`,
    subtitle: "Company profile. The name is the key every placement points at and cannot change here.",
    fields, submitLabel: "Save profile",
    onSubmit: (values) => { updateCounterparty(c.name, values); reopen(); },
  });
}

const picFields = (p = {}) => [
  { name: "name", label: "Name", type: "text", required: true, value: p.name || "", placeholder: "e.g. Rina Hartono" },
  { name: "title", label: "Job title", type: "text", value: p.title || "", placeholder: "e.g. Head of Treaty", half: true },
  { name: "division", label: "Division handled", type: "select", options: DIVISIONS, value: p.division || DIVISIONS[0], half: true,
    hint: "Several people can handle one division." },
  { name: "email", label: "Email", type: "email", value: p.email || "", placeholder: "name@company.com", half: true },
  { name: "phone", label: "Phone", type: "tel", value: p.phone || "", placeholder: "+62 21 5555 0100", half: true },
  { name: "primary", label: "Primary for this division", type: "select", options: ["No", "Yes"], value: p.primary ? "Yes" : "No", half: true },
  { name: "notes", label: "Notes", type: "textarea", rows: 2, value: p.notes || "", placeholder: "Handles which classes, when to use, backup for whom…" },
];
const readPic = (v) => ({ ...v, primary: v.primary === "Yes" });

const bankFields = (b = {}) => [
  { name: "bankName", label: "Bank", type: "text", required: true, value: b.bankName || "", placeholder: "e.g. Bank Mandiri" },
  { name: "accountName", label: "Account name", type: "text", required: true, value: b.accountName || "", placeholder: "As the bank knows the holder" },
  { name: "accountNo", label: "Account number", type: "text", value: b.accountNo || "", half: true },
  { name: "ccy", label: "Currency", type: "select", options: SETTLEMENT_CURRENCIES, value: b.ccy || "USD", half: true },
  { name: "swift", label: "SWIFT / BIC", type: "text", value: b.swift || "", placeholder: "8 or 11 characters", half: true },
  { name: "iban", label: "IBAN", type: "text", value: b.iban || "", placeholder: "Where applicable", half: true },
  { name: "branch", label: "Branch", type: "text", value: b.branch || "", half: true },
  { name: "primary", label: "Primary settlement account", type: "select", options: ["No", "Yes"], value: b.primary ? "Yes" : "No", half: true },
  { name: "notes", label: "Notes", type: "textarea", rows: 2, value: b.notes || "", placeholder: "Intermediary bank, reference format, currency restrictions…" },
];
const readBank = (v) => ({ ...v, primary: v.primary === "Yes" });

function wire() {
  onAction("#modal-root", {
    "edit-profile": () => profileForm(counterpartyNamed(openName)),
    "add-pic": () => openFormModal({
      title: `Add PIC — ${openName}`, fields: picFields(), submitLabel: "Add PIC",
      validate: (v) => validatePic(readPic(v)),
      onSubmit: (v) => { addPic(openName, readPic(v)); reopen(); },
    }),
    "edit-pic": ({ id }) => {
      const pic = picsByDivision(counterpartyNamed(openName)).flatMap((g) => g.pics).find((p) => p.id === id);
      if (!pic) return;
      openFormModal({
        title: `Edit PIC — ${pic.name}`, fields: picFields(pic), submitLabel: "Save",
        validate: (v) => validatePic(readPic(v)),
        onSubmit: (v) => { updatePic(openName, id, readPic(v)); reopen(); },
      });
    },
    "remove-pic": ({ id }) => { removePic(openName, id); repaint(); },
    "add-bank": () => openFormModal({
      title: `Add bank account — ${openName}`, fields: bankFields(), submitLabel: "Add account",
      validate: (v) => validateBankAccount(readBank(v)),
      onSubmit: (v) => { addBankAccount(openName, readBank(v)); reopen(); },
    }),
    "edit-bank": ({ id }) => {
      const b = bankAccountsOf(counterpartyNamed(openName)).find((x) => x.id === id);
      if (!b) return;
      openFormModal({
        title: `Edit bank account — ${b.bankName}`, fields: bankFields(b), submitLabel: "Save",
        validate: (v) => validateBankAccount(readBank(v)),
        onSubmit: (v) => { updateBankAccount(openName, id, readBank(v)); reopen(); },
      });
    },
    "remove-bank": ({ id }) => { removeBankAccount(openName, id); repaint(); },
    "open-placement": ({ id }) => { closeModal(); onOpenPlacement?.(id); },
  });
}

function repaint() {
  const c = counterpartyNamed(openName);
  if (!c) return closeModal();
  updateModal(shell(c), { onMount: wire });
}

function reopen() {
  const c = counterpartyNamed(openName);
  if (c) openModal(shell(c), { onMount: wire, onDismiss: () => { openName = null; } });
}

/**
 * Open a counterparty by its registry name.
 * @param {string} name
 * @param {(programId:string) => void} [openPlacement] called when a linked placement is chosen
 */
export function openCounterpartyDetail(name, openPlacement) {
  const c = counterpartyNamed(name);
  if (!c) return;
  openName = c.name;
  onOpenPlacement = openPlacement || null;
  openModal(shell(c), { onMount: wire, onDismiss: () => { openName = null; } });
}
