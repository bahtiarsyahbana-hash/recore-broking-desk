/**
 * Printable finance document — one issued Invoice, Debit Note, Credit Note or
 * Closing Slip rendered as a standalone page and sent to the browser's own
 * print dialog, which also saves it as PDF. No library, no server.
 */
import { state, counterpartyNamed } from "../core/store.js";
import { brandMark } from "./brand.js";
import { picsOf, bankAccountsOf, maskAccount } from "../domain/counterparty-profile.js";
import { fromCents, formatShare, invoiceTable } from "../domain/billing.js";

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (cents, ccy) => `${ccy} ${fromCents(cents).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The counterparty's finance contact, falling back to the primary PIC. */
function financeContact(entry) {
  const pics = picsOf(entry);
  return pics.find((p) => p.division === "Technical Accounting / Finance") || pics.find((p) => p.primary) || pics[0] || null;
}

/** Broker details: the copy taken at issue, else the live profile (drafts never print). */
function fromBlock(doc) {
  if (doc.from) return doc.from;
  const p = state.billing.brokerProfile;
  return { legalName: p.legalName, address: p.address, postalCode: p.postalCode, country: p.country, email: p.email };
}

/** Recipient details: the copy taken at issue, else the registry record now. */
function toBlock(doc) {
  if (doc.billTo) return doc.billTo;
  const c = counterpartyNamed(doc.counterparty) || { name: doc.counterparty };
  const pic = financeContact(c);
  return { legalName: c.name, address: c.address || "", postalCode: c.postalCode || "", country: c.country || "", email: pic?.email || "", attention: pic?.name || "" };
}

/** Legal name, full address with postal code, email — the same shape on both sides. */
const party = (p) => `<p class="strong">${esc(p.legalName)}</p>
  ${p.address ? `<p>${esc(p.address).replace(/\n/g, "<br>")}</p>` : ""}
  ${p.postalCode || p.country ? `<p>${[p.postalCode, p.country].filter(Boolean).map(esc).join(" · ")}</p>` : ""}
  ${p.email ? `<p>${esc(p.email)}</p>` : ""}
  ${p.attention ? `<p class="muted">Attn: ${esc(p.attention)}</p>` : ""}`;

export function documentHtml(batch, doc) {
  const isSlip = doc.docType === "Closing Slip";
  const from = fromBlock(doc);
  const to = toBlock(doc);
  const t = invoiceTable(doc.lines);
  const m = (cents) => money(cents, doc.ccy);

  const c = counterpartyNamed(doc.counterparty) || {};
  const bank = isSlip ? bankAccountsOf(c)[0] : null;
  const payment = isSlip
    ? (bank ? `${esc(bank.bankName)} · ${esc(bank.accountName)} · A/C ${esc(maskAccount(bank.accountNo || bank.iban))}${bank.swift ? ` · ${esc(bank.swift)}` : ""}` : "No bank account on file for this reinsurer.")
    : doc.total <= 0 ? "Settled against your account or paid to the bank account you give us."
      : doc.payTo ? `${esc(doc.payTo.bankName)} · ${esc(doc.payTo.accountName)} · A/C ${esc(doc.payTo.accountNo || "—")}${doc.payTo.iban ? ` · IBAN ${esc(doc.payTo.iban)}` : ""}${doc.payTo.swift ? ` · SWIFT ${esc(doc.payTo.swift)}` : ""}`
        : `No collection account in ${esc(doc.ccy)} was on file at issue. Contact us for payment instructions.`;

  const rows = t.rows.map((r, i) => `<tr>
      <td>${esc(r.description)}${i === 0 ? `<div class="muted">${esc(batch.sourceLabel)}${isSlip ? ` · ${esc(formatShare(doc.share))} share` : ""}</div>` : ""}${r.taxes.length ? `<div class="muted">${r.taxes.map(esc).join(" · ")}</div>` : ""}</td>
      <td class="n">${r.tax ? m(r.tax) : "—"}</td>
      <td class="n">${r.kind === "tax-row" ? "—" : m(r.amount)}</td>
      <td class="n">${m(r.total)}</td></tr>`).join("");

  const dueLabel = isSlip ? "Net payable" : doc.total < 0 ? "Amount credited" : "Amount due";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.id)} · ${esc(doc.docType)}</title>
<style>
  *{ box-sizing:border-box; }
  body{ margin:0; font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; color:#111; background:#fff; }
  .page{ max-width:760px; margin:32px auto; padding:0 28px; }
  .top{ display:flex; justify-content:space-between; align-items:center; gap:20px; margin-bottom:28px; }
  h1{ margin:0; font-size:28px; font-weight:700; }
  .brand{ display:flex; align-items:center; gap:10px; font-weight:600; font-size:15px; text-align:right; }
  .brand svg{ width:36px; height:36px; color:#111; flex:none; }
  .info{ display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:28px; }
  .block{ margin-bottom:18px; } .block:last-child{ margin-bottom:0; }
  .label{ font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:#666; margin-bottom:4px; }
  .block p{ margin:0; } .strong{ font-weight:600; } .muted{ color:#666; font-size:11.5px; }
  dl{ display:grid; grid-template-columns:auto 1fr; gap:2px 14px; margin:0; } dt{ color:#666; } dd{ margin:0; }
  table{ width:100%; border-collapse:collapse; }
  th{ text-align:left; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.05em; color:#666; padding:8px 0; border-bottom:1px solid #111; }
  td{ padding:9px 0; border-bottom:1px solid #e5e5e5; vertical-align:top; }
  th.n, td.n{ text-align:right; white-space:nowrap; padding-left:16px; font-variant-numeric:tabular-nums; }
  .totals{ margin:18px 0 0 auto; width:300px; }
  .totals div{ display:flex; justify-content:space-between; padding:4px 0; font-variant-numeric:tabular-nums; }
  .totals .due{ margin-top:8px; padding-top:10px; border-top:2px solid #111; font-size:20px; font-weight:700; }
  .actions{ max-width:760px; margin:16px auto 0; padding:0 28px; text-align:right; }
  .actions button{ font:600 12.5px system-ui; padding:8px 14px; border-radius:6px; border:1px solid #111; background:#111; color:#fff; cursor:pointer; }
  @media print{ .actions{ display:none; } .page{ margin:0 auto; } }
</style></head><body>
<div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="page">
  <div class="top">
    <h1>${esc(doc.docType)}</h1>
    <div class="brand">${brandMark("pd-")}<span>${esc(from.legalName)}</span></div>
  </div>
  <div class="info">
    <div>
      <div class="block"><div class="label">Information</div><dl>
        <dt>${esc(doc.docType)} number</dt><dd>${esc(doc.id)}</dd>
        <dt>Date issued</dt><dd>${esc(doc.issueDate)}</dd>
        <dt>Date due</dt><dd>${esc(doc.dueDate || "—")}</dd>
      </dl></div>
      <div class="block"><div class="label">From</div>${party(from)}</div>
      <div class="block"><div class="label">${isSlip ? "Remit to" : "Payment to"}</div><p>${payment}</p></div>
    </div>
    <div>
      <div class="block"><div class="label">${isSlip ? "Payable to" : "Bill to"}</div>${party(to)}</div>
    </div>
  </div>
  <table>
    <thead><tr><th>Description</th><th class="n">Tax</th><th class="n">Amount</th><th class="n">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>${m(t.subtotal)}</span></div>
    ${t.discount ? `<div><span>Discount</span><span>${m(t.discount)}</span></div>` : ""}
    <div><span>VAT / Tax</span><span>${m(t.tax)}</span></div>
    <div class="due"><span>${dueLabel}</span><span>${m(t.amountDue)}</span></div>
  </div>
</div></body></html>`;
}

/**
 * Print the document through a hidden frame, so the browser's print dialog
 * opens straight away (and offers Save as PDF) without a pop-up tab that a
 * blocker could stop. The frame removes itself after printing.
 */
export function openPrintable(batch, doc) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.title = `${doc.docType} ${doc.id}`;
  frame.style.cssText = "position:fixed; right:0; bottom:0; width:0; height:0; border:0; visibility:hidden;";
  frame.dataset.printDoc = doc.id;
  frame.srcdoc = documentHtml(batch, doc);
  frame.addEventListener("load", () => {
    const w = frame.contentWindow;
    if (!w) return;
    w.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 0));
    w.focus();
    w.print();
    // Browsers that never fire afterprint still clean up.
    setTimeout(() => frame.isConnected && frame.remove(), 120_000);
  });
  document.body.appendChild(frame);
  return frame;
}
