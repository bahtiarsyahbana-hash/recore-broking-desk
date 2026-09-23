/**
 * Broker intake queue — requests for cover that have not yet become placements.
 *
 * Shape of an intake:
 *   id, status, source (manual | portal | email), channel (email | phone |
 *   WhatsApp | meeting | other), receivedFrom, receivedDate,
 *   cedant, insuredName, cls, requestedType, sumInsured, ccy, rate,
 *   paymentWarrantyDays, notes, createdBy, placementId (once converted),
 *   history — [{ at, actor, action, notes }]
 *
 * Mutated only through services/intake.service.js.
 */
export const intakes = [
  {
    id: "IN-1001", status: "Received", source: "manual", channel: "email",
    receivedFrom: "Dewi Hartono, Meridian Mutual", receivedDate: "2026-09-15",
    cedant: "Meridian Mutual Insurance", insuredName: "Tanjung Priok Container Terminal",
    cls: "Property", requestedType: "Excess of Loss", sumInsured: 85000000, ccy: "USD", rate: 0.65,
    paymentWarrantyDays: 60, notes: "Port terminal, new crane installation. Wants a layered programme above a USD 5m retention.",
    createdBy: { id: "vr", name: "Victor Roy", title: "Placement Broker" },
    history: [
      { at: "2026-09-15", actor: "Victor Roy", action: "Intake created", notes: "Typed up from email" },
      { at: "2026-09-15", actor: "Victor Roy", action: "Marked received", notes: "" },
    ],
  },
  {
    id: "IN-1002", status: "Under Review", source: "portal", channel: "other",
    receivedFrom: "Cedant portal", receivedDate: "2026-09-17",
    cedant: "Pacífico General Insurance", insuredName: "Andina Foods Cold Chain S.A.",
    cls: "Property", requestedType: "Quota Share", sumInsured: 24000000, ccy: "USD", rate: null,
    paymentWarrantyDays: 30, notes: "Cold-storage warehouses, three sites. Rate to be quoted by the market.",
    createdBy: { id: "ced-pacifico", name: "Pacífico General Insurance", title: "Cedant" },
    history: [
      { at: "2026-09-17", actor: "Pacífico General Insurance", action: "Submitted from portal", notes: "" },
      { at: "2026-09-18", actor: "Victor Roy", action: "Review started", notes: "" },
    ],
  },
];
