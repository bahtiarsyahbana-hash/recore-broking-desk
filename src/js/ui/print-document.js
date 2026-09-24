/**
 * Printable finance document — one issued Invoice, Debit Note, Credit Note or
 * Closing Slip rendered as a standalone page and sent to the browser's own
 * print dialog, which also saves it as PDF. No library, no server.
 */
import { counterpartyNamed } from "../core/store.js";
import { BROKING_FIRM } from "../core/config.js";
import { brandMark } from "./brand.js";
import { picsOf, bankAccountsOf, maskAccount } from "../domain/counterparty-profile.js";
import { fromCents, formatShare } from "../domain/billing.js";

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (cents, ccy) => `${ccy} ${fromCents(cents).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The counterparty's finance contact, falling back to the primary PIC. */
function financeContact(entry) {
  const pics = picsOf(entry);
  return pics.find((p) => p.division === "Technical Accounting / Finance") || pics.find((p) => p.primary) || pics[0] || null;
}

export function documentHtml(batch, doc) {
  const c = counterpartyNamed(doc.counterparty) || { name: doc.counterparty };
  const pic = financeContact(c);
  const isSlip = doc.docType === "Closing Slip";
  const bank = isSlip ? bankAccountsOf(c)[0] : null;
  const rows = doc.lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="n">${money(l.cents, doc.ccy)}</td></tr>`).join("");
  const payment = isSlip
    ? (bank ? `We will remit the net amount to ${esc(bank.bankName)} · ${esc(bank.accountName)} · A/C ${esc(maskAccount(bank.accountNo || bank.iban))}${bank.swift ? ` · ${esc(bank.swift)}` : ""}, on receipt of the cedant's premium.`
      : "No bank account is on file for this reinsurer. Remittance cannot be made until one is recorded.")
    : doc.total <= 0
      ? "This amount is due to you. It will be settled against your account or paid to the bank account you have given us."
      : doc.payTo
        ? `Please pay ${esc(money(doc.total, doc.ccy))} by ${esc(doc.dueDate || "the due date")} to <strong>${esc(doc.payTo.bankName)}</strong> · ${esc(doc.payTo.accountName)} · A/C ${esc(doc.payTo.accountNo || "—")}${doc.payTo.iban ? ` · IBAN ${esc(doc.payTo.iban)}` : ""}${doc.payTo.swift ? ` · SWIFT ${esc(doc.payTo.swift)}` : ""}${doc.payTo.branch ? ` · ${esc(doc.payTo.branch)}` : ""}, quoting ${esc(doc.id)}.`
        : `No collection account in ${esc(doc.ccy)} was on file when this document was issued. Contact ${esc(BROKING_FIRM)} for payment instructions.`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(doc.id)} · ${esc(doc.docType)}</title>
<style>
  :root{ --ink:#001233; --soft:#616c80; --line:#e2e2e2; --tint:#f2f2f2; --accent:#0a369d; }
  *{ box-sizing:border-box; } body{ margin:0; font:13px/1.45 "IBM Plex Sans",system-ui,sans-serif; color:var(--ink); background:#fff; }
  .page{ max-width:780px; margin:32px auto; padding:0 28px; }
  header{ display:flex; justify-content:space-between; align-items:flex-start; gap:20px; padding-bottom:18px; border-bottom:2px solid var(--ink); }
  .brand{ display:flex; gap:12px; align-items:center; } .brand svg{ width:44px; height:44px; color:var(--ink); }
  .firm{ font:600 18px Georgia,serif; } .sub{ font-size:11px; color:var(--soft); text-transform:uppercase; letter-spacing:.04em; }
  h1{ font:600 22px Georgia,serif; margin:0; text-align:right; } .no{ text-align:right; font-family:ui-monospace,monospace; font-size:13px; margin-top:4px; }
  .grid{ display:grid; grid-template-columns:1fr 1fr; gap:18px; margin:22px 0; }
  .box h3{ margin:0 0 6px; font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--soft); }
  .box p{ margin:0; } dl{ display:grid; grid-template-columns:auto 1fr; gap:4px 14px; margin:0; } dt{ color:var(--soft); } dd{ margin:0; font-family:ui-monospace,monospace; }
  table{ width:100%; border-collapse:collapse; margin-top:6px; } th{ text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--soft); border-bottom:1px solid var(--line); padding:6px 0; }
  td{ padding:8px 0; border-bottom:1px solid var(--line); } .n{ text-align:right; font-family:ui-monospace,monospace; white-space:nowrap; }
  tfoot td{ font-weight:700; border-top:2px solid var(--ink); border-bottom:none; font-size:14px; }
  .note{ margin-top:22px; padding:12px 14px; background:var(--tint); border-radius:8px; font-size:12px; }
  footer{ margin-top:28px; font-size:11px; color:var(--soft); display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .actions{ text-align:right; margin:16px auto 0; max-width:780px; padding:0 28px; }
  .actions button{ font:600 12.5px system-ui; padding:8px 14px; border-radius:8px; border:1px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer; }
  @media print{ .actions{ display:none; } .page{ margin:0 auto; } }
</style></head><body>
<div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div>
<div class="page">
  <header>
    <div class="brand">${brandMark("pd-")}<div><div class="firm">${esc(BROKING_FIRM)}</div><div class="sub">Reinsurance broker</div></div></div>
    <div><h1>${esc(doc.docType)}</h1><div class="no">${esc(doc.id)}</div></div>
  </header>
  <div class="grid">
    <div class="box"><h3>${isSlip ? "Reinsurer" : "Bill to"}</h3>
      <p><strong>${esc(c.name)}</strong></p>
      ${c.address ? `<p>${esc(c.address)}</p>` : ""}${c.country ? `<p>${esc(c.country)}</p>` : ""}
      ${pic ? `<p style="margin-top:6px;">Attn: ${esc(pic.name)}${pic.email ? ` · ${esc(pic.email)}` : ""}</p>` : ""}
    </div>
    <div class="box"><h3>Details</h3><dl>
      <dt>Issue date</dt><dd>${esc(doc.issueDate)}</dd>
      ${doc.dueDate ? `<dt>Due date</dt><dd>${esc(doc.dueDate)}</dd>` : ""}
      ${batch.paymentWarrantyDays ? `<dt>Payment warranty</dt><dd>${esc(batch.paymentWarrantyDays)} days from ${esc(batch.basisDate)}</dd>` : ""}
      <dt>Reference</dt><dd>${esc(batch.sourceLabel)}</dd>
      <dt>Cedant</dt><dd>${esc(batch.cedant)}</dd>
      ${isSlip ? `<dt>Share</dt><dd>${esc(formatShare(doc.share))}</dd>` : ""}
      <dt>Currency</dt><dd>${esc(doc.ccy)}</dd>
    </dl></div>
  </div>
  <table><thead><tr><th>Description</th><th class="n">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td>${isSlip ? "Net due to reinsurer" : doc.total < 0 ? "Total due to you" : "Total due"}</td><td class="n">${money(doc.total, doc.ccy)}</td></tr></tfoot>
  </table>
  <div class="note">${payment}</div>
  <footer><span>Prepared by ${esc(batch.preparedBy?.name)} · approved by ${esc(batch.approvedBy?.name)}${batch.overrideUsed ? " (administrator override)" : ""}</span><span>Batch ${esc(batch.ref)}</span></footer>
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
