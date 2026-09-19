/**
 * Finance documents — invoices, credit notes and debit notes flowing from every
 * bind, endorsement and cancellation.
 *
 * The aged creditor position is desk-level and sits alongside the documents.
 * Mutated only through services/finance.service.js.
 */

export const financeDocs = [
  {id:"INV-2031", type:"Invoice", program:"P-1001", counterparty:"Helvetia Continental Re", amount:1320000, ccy:"USD", date:"2026-01-05", co:null},
  {id:"INV-2032", type:"Invoice", program:"P-1002", counterparty:"Andean Capacity Re", amount:1932000, ccy:"USD", date:"2026-04-03", co:"Andean Risk Partners · 30%"},
  {id:"CN-0114", type:"Credit Note", program:"P-1004", counterparty:"Comstock Re", amount:64000, ccy:"CAD", date:"2026-07-18", co:null},
  {id:"DN-0087", type:"Debit Note", program:"P-1001", counterparty:"Northbridge Reinsurance SE", amount:221000, ccy:"USD", date:"2026-08-20", co:null}
];

/** Balances the desk owes its markets, bucketed by age. */
export const agedCreditors = [
  {m:"Helvetia Continental Re", cur:420000, d30:0, d60:180000, d90:0},
  {m:"Andean Capacity Re", cur:210000, d30:95000, d60:0, d90:60000},
  {m:"Northbridge Reinsurance SE", cur:640000, d30:0, d60:0, d90:0}
];

/** Headline aged creditor figure shown on the dashboard. */
export const agedCreditorTotal = 2140000;
