/**
 * Finance service — raises the invoices, credit notes and debit notes that flow
 * from placement events, and owns document numbering.
 */
import { state, nextInvoiceNo, nextCreditNoteNo, nextDebitNoteNo } from "../core/store.js";
import { todayISO } from "../core/config.js";
import { emit, TOPICS } from "../core/events.js";

function post(doc) {
  state.financeDocs.unshift(doc);
  emit(TOPICS.FINANCE, doc);
  return doc;
}

/** Co-broker label as it appears on a finance document. */
const coBrokerLabel = (coBroker) =>
  coBroker ? `${coBroker.name} · ${coBroker.split}%` : null;

/** Premium invoice raised to the market panel at bind. */
export function raiseInvoice({ program, counterparty, amount, ccy, coBroker }) {
  return post({
    id: nextInvoiceNo(), type: "Invoice",
    program, counterparty, amount, ccy,
    date: todayISO(), co: coBrokerLabel(coBroker),
  });
}

/** Credit note — return premium on a cancellation or downward endorsement. */
export function raiseCreditNote({ program, counterparty, amount, ccy, coBroker }) {
  return post({
    id: nextCreditNoteNo(), type: "Credit Note",
    program, counterparty, amount, ccy,
    date: todayISO(), co: coBrokerLabel(coBroker),
  });
}

/** Debit note — additional premium on an upward endorsement or reinstatement. */
export function raiseDebitNote({ program, counterparty, amount, ccy, coBroker }) {
  return post({
    id: nextDebitNoteNo(), type: "Debit Note",
    program, counterparty, amount, ccy,
    date: todayISO(), co: coBrokerLabel(coBroker),
  });
}
