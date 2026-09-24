/**
 * Treaty administration seed — agreements negotiated and bound outside
 * Recordes, registered as master records, and the operational records that
 * reference them. Every bordereau, cession, account and settlement carries an
 * `agreementId` pointing at one agreement.
 *
 * Mutated only through services/treaty.service.js.
 */
const who = { id: "vr", name: "Victor Roy", title: "Placement Broker" };

export const treatyAgreements = [
  {
    id: "TA-2026-001", name: "Meridian Mutual Property Catastrophe XoL 2026", cedant: "Meridian Mutual Insurance", cls: "Property",
    inception: "2026-01-01", expiry: "2026-12-31", originalInception: "2021-01-01", ccy: "USD",
    type: "Catastrophe XoL", status: "Active", source: "Manual Registration", origin: null,
    structure: {
      layers: [
        { limit: 5000000, attachment: 5000000, reinstatements: 2, premium: 425000 },
        { limit: 10000000, attachment: 10000000, reinstatements: 1, premium: 420000 },
        { limit: 25000000, attachment: 20000000, reinstatements: 1, premium: 450000 },
      ],
      eventDefinition: "168 consecutive hours, any one event, per LMA 5077 hours clause", premiumBasis: "GNPI",
    },
    panel: [
      { reinsurer: "Helvetia Continental Re", share: 40, role: "Lead", brokeragePct: 10, marketRef: "HCR/2026/0117" },
      { reinsurer: "Northbridge Reinsurance SE", share: 35, role: "Follow", brokeragePct: 10, marketRef: "NB-26-0442" },
      { reinsurer: "Zenith Re · Syndicate 2044", share: 25, role: "Follow", brokeragePct: 10, marketRef: "B0621-2044-26" },
    ],
    reporting: { premiumBdxFrequency: "Quarterly", claimsBdxFrequency: "Quarterly", accountingFrequency: "Quarterly", reportingDeadlineDays: 45,
      paymentWarrantyDays: 60, brokeragePct: 10, commissionPct: null, taxPct: null, settlementCcy: "USD", declarationsRequired: false, cashCallThreshold: 500000 },
    documents: [
      { name: "Signed treaty wording — TA-2026-001.pdf", type: "Signed treaty wording", date: "2025-12-18", from: "Helvetia Continental Re", version: 1 },
      { name: "Slip — Meridian Property Cat 2026.pdf", type: "Slip", date: "2025-12-10", from: "Broker", version: 1 },
      { name: "Cover note — TA-2026-001.pdf", type: "Cover note", date: "2025-12-22", from: "Broker", version: 1 },
    ],
    endorsements: [{ ref: "E1", date: "2026-04-01", effective: "2026-04-01", summary: "Layer 3 reinstatement provisions amended to 1 @ 100%." }],
    audit: [
      { at: "2025-12-22", actor: "Victor Roy", action: "Agreement registered", notes: "Manual registration from signed wording" },
      { at: "2025-12-22", actor: "Maya Lindqvist", action: "Agreement activated", notes: "" },
      { at: "2026-04-01", actor: "Victor Roy", action: "Endorsement E1 recorded", notes: "Reinstatements layer 3" },
    ],
    registeredBy: who, activatedAt: "2025-12-22",
  },
  {
    id: "TA-2026-002", name: "Pacífico General Property Quota Share 2026", cedant: "Pacífico General Insurance", cls: "Property",
    inception: "2026-04-01", expiry: "2027-03-31", originalInception: "2023-04-01", ccy: "USD",
    type: "Quota Share", status: "Active", source: "Manual Registration", origin: null,
    structure: { cessionPct: 35, retentionPct: 65, commissionPct: 28, premiumBasis: "GNPI" },
    panel: [
      { reinsurer: "Andean Capacity Re", share: 60, role: "Lead", brokeragePct: 2.5, marketRef: "ACR-QS-26-09" },
      { reinsurer: "Comstock Re", share: 40, role: "Follow", brokeragePct: 2.5, marketRef: "CR/26/311" },
    ],
    reporting: { premiumBdxFrequency: "Quarterly", claimsBdxFrequency: "Quarterly", accountingFrequency: "Quarterly", reportingDeadlineDays: 60,
      paymentWarrantyDays: 90, brokeragePct: 2.5, commissionPct: 28, taxPct: null, settlementCcy: "USD", declarationsRequired: false, cashCallThreshold: 250000 },
    documents: [
      { name: "Signed treaty wording — TA-2026-002.pdf", type: "Signed treaty wording", date: "2026-03-20", from: "Andean Capacity Re", version: 1 },
      { name: "Slip — Pacífico Property QS 2026.pdf", type: "Slip", date: "2026-03-12", from: "Broker", version: 1 },
    ],
    endorsements: [],
    audit: [
      { at: "2026-03-25", actor: "Victor Roy", action: "Agreement registered", notes: "" },
      { at: "2026-03-26", actor: "Maya Lindqvist", action: "Agreement activated", notes: "" },
    ],
    registeredBy: who, activatedAt: "2026-03-26",
  },
  {
    id: "TA-2025-003", name: "Northwind Motor Surplus 2025/26", cedant: "Northwind Assurance Co.", cls: "Motor",
    inception: "2025-11-01", expiry: "2026-10-31", originalInception: "2019-11-01", ccy: "CAD",
    type: "Surplus", status: "Expiring", source: "Imported", origin: null,
    structure: { retention: 500000, lines: 9, capacity: 4500000, commissionPct: 25, premiumBasis: "Original gross premium" },
    panel: [
      { reinsurer: "Comstock Re", share: 55, role: "Lead", brokeragePct: 5, marketRef: "CR/25/198" },
      { reinsurer: "Northbridge Reinsurance SE", share: 45, role: "Follow", brokeragePct: 5, marketRef: "NB-25-0913" },
    ],
    reporting: { premiumBdxFrequency: "Monthly", claimsBdxFrequency: "Quarterly", accountingFrequency: "Quarterly", reportingDeadlineDays: 30,
      paymentWarrantyDays: 60, brokeragePct: 5, commissionPct: 25, taxPct: 2, settlementCcy: "CAD", declarationsRequired: true, cashCallThreshold: null },
    documents: [
      { name: "Signed treaty wording — TA-2025-003.pdf", type: "Signed treaty wording", date: "2025-10-21", from: "Comstock Re", version: 1 },
      { name: "Endorsement E1 — capacity increase.pdf", type: "Endorsement", date: "2026-02-01", from: "Comstock Re", version: 1 },
    ],
    endorsements: [{ ref: "E1", date: "2026-02-01", effective: "2026-02-01", summary: "Lines increased from 8 to 9; capacity CAD 4.5m." }],
    audit: [
      { at: "2025-10-28", actor: "Victor Roy", action: "Agreement imported", notes: "From legacy treaty register" },
      { at: "2025-10-28", actor: "Maya Lindqvist", action: "Agreement activated", notes: "" },
      { at: "2026-02-01", actor: "Victor Roy", action: "Endorsement E1 recorded", notes: "" },
      { at: "2026-09-01", actor: "Victor Roy", action: "Status → Expiring", notes: "Renewal discussions opened" },
    ],
    registeredBy: who, activatedAt: "2025-10-28",
  },
  {
    id: "TA-2025-004", name: "Sahara Takaful Marine Per Risk XoL 2025", cedant: "Sahara Takaful Insurance", cls: "Marine",
    inception: "2025-07-01", expiry: "2026-06-30", originalInception: "2025-07-01", ccy: "USD",
    type: "Per Risk XoL", status: "Run-off", source: "Manual Registration", origin: null,
    structure: { layers: [
      { limit: 2000000, attachment: 500000, reinstatements: 3, premium: 180000 },
      { limit: 5000000, attachment: 2500000, reinstatements: 2, premium: 150000 },
    ], premiumBasis: "GNPI" },
    panel: [
      { reinsurer: "Baltic Shield Re", share: 70, role: "Lead", brokeragePct: 10, marketRef: "BSR/M/25/07" },
      { reinsurer: "Nanyang Re", share: 30, role: "Follow", brokeragePct: 10, marketRef: "NYR-2025-0630" },
    ],
    reporting: { premiumBdxFrequency: "Quarterly", claimsBdxFrequency: "Monthly", accountingFrequency: "Quarterly", reportingDeadlineDays: 30,
      paymentWarrantyDays: 45, brokeragePct: 10, commissionPct: null, taxPct: null, settlementCcy: "USD", declarationsRequired: false, cashCallThreshold: 250000 },
    documents: [{ name: "Signed treaty wording — TA-2025-004.pdf", type: "Signed treaty wording", date: "2025-06-24", from: "Baltic Shield Re", version: 1 }],
    endorsements: [],
    audit: [
      { at: "2025-06-27", actor: "Victor Roy", action: "Agreement registered", notes: "" },
      { at: "2025-06-27", actor: "Maya Lindqvist", action: "Agreement activated", notes: "" },
      { at: "2026-07-01", actor: "Victor Roy", action: "Status → Run-off", notes: "Not renewed; claims continue to run" },
    ],
    registeredBy: who, activatedAt: "2025-06-27",
  },
  {
    id: "TA-2024-005", name: "Garuda Nusantara Casualty Stop Loss 2024", cedant: "Garuda Nusantara Life", cls: "Casualty",
    inception: "2024-01-01", expiry: "2024-12-31", originalInception: "2024-01-01", ccy: "IDR",
    type: "Stop Loss", status: "Closed", source: "Manual Registration", origin: null,
    structure: { attachmentRatio: 85, limitRatio: 115, subjectPremium: 120000000000, lossRatioBasis: "Incurred / earned" },
    panel: [{ reinsurer: "Nanyang Re", share: 100, role: "Lead", brokeragePct: 7.5, marketRef: "NYR-SL-24-002" }],
    reporting: { premiumBdxFrequency: "Annual", claimsBdxFrequency: "Half-yearly", accountingFrequency: "Annual", reportingDeadlineDays: 90,
      paymentWarrantyDays: 90, brokeragePct: 7.5, commissionPct: null, taxPct: null, settlementCcy: "IDR", declarationsRequired: false, cashCallThreshold: null },
    documents: [{ name: "Signed treaty wording — TA-2024-005.pdf", type: "Signed treaty wording", date: "2023-12-15", from: "Nanyang Re", version: 1 }],
    endorsements: [],
    audit: [
      { at: "2023-12-20", actor: "Victor Roy", action: "Agreement registered", notes: "" },
      { at: "2023-12-20", actor: "Maya Lindqvist", action: "Agreement activated", notes: "" },
      { at: "2026-03-31", actor: "Victor Roy", action: "Status → Closed", notes: "Final account settled" },
    ],
    registeredBy: who, activatedAt: "2023-12-20",
  },
  {
    id: "TA-2026-006", name: "Cempaka Sejahtera Property Quota Share 2026", cedant: "Cempaka Sejahtera Insurance", cls: "Property",
    inception: "2026-10-01", expiry: "2027-09-30", originalInception: "2026-10-01", ccy: "IDR",
    type: "Quota Share", status: "Draft Setup", source: "Manual Registration", origin: null,
    structure: { cessionPct: 40, retentionPct: 60, commissionPct: 30, premiumBasis: "GNPI" },
    panel: [{ reinsurer: "Nanyang Re", share: 60, role: "Lead", brokeragePct: 2.5, marketRef: "" }],
    reporting: { premiumBdxFrequency: "Quarterly", claimsBdxFrequency: "Quarterly", accountingFrequency: null, reportingDeadlineDays: null,
      paymentWarrantyDays: null, brokeragePct: 2.5, commissionPct: 30, taxPct: null, settlementCcy: "IDR", declarationsRequired: false, cashCallThreshold: null },
    documents: [],
    endorsements: [],
    audit: [{ at: "2026-09-10", actor: "Victor Roy", action: "Agreement registered", notes: "Setup in progress — panel 60% placed" }],
    registeredBy: who, activatedAt: null,
  },
];

export const premiumBordereaux = [
  { ref: "PB-0031", agreementId: "TA-2026-002", period: "Q2 2026", grossPremium: 4600000, cededPremium: 1610000, commission: 450800, ccy: "USD", status: "Matched", receivedDate: "2026-07-18", dueDate: "2026-08-30" },
  { ref: "PB-0032", agreementId: "TA-2026-001", period: "Q2 2026", grossPremium: 18200000, cededPremium: 323750, commission: 0, ccy: "USD", status: "Posted", receivedDate: "2026-07-25", dueDate: "2026-08-14" },
  { ref: "PB-0033", agreementId: "TA-2025-003", period: "Jul 2026", grossPremium: 1120000, cededPremium: 486000, commission: 121500, ccy: "CAD", status: "Exception", receivedDate: "2026-08-12", dueDate: "2026-08-31" },
  { ref: "PB-0034", agreementId: "TA-2025-003", period: "Aug 2026", grossPremium: 1090000, cededPremium: 471000, commission: 117750, ccy: "CAD", status: "Received", receivedDate: "2026-09-14", dueDate: "2026-09-30" },
  { ref: "PB-0035", agreementId: "TA-2025-004", period: "Q1 2026", grossPremium: 3100000, cededPremium: 82500, commission: 0, ccy: "USD", status: "Posted", receivedDate: "2026-04-20", dueDate: "2026-04-30" },
];

export const claimsBordereaux = [
  { ref: "CB-0018", agreementId: "TA-2026-001", period: "Q2 2026", claimCount: 3, paid: 2100000, outstanding: 6800000, recoverable: 3900000, ccy: "USD", status: "Under Review", receivedDate: "2026-07-25", dueDate: "2026-08-14" },
  { ref: "CB-0019", agreementId: "TA-2026-002", period: "Q2 2026", claimCount: 31, paid: 1150000, outstanding: 800000, recoverable: 682500, ccy: "USD", status: "Matched", receivedDate: "2026-07-18", dueDate: "2026-08-30" },
  { ref: "CB-0020", agreementId: "TA-2025-004", period: "Jun 2026", claimCount: 2, paid: 340000, outstanding: 1200000, recoverable: 1040000, ccy: "USD", status: "Posted", receivedDate: "2026-07-05", dueDate: "2026-07-31" },
  { ref: "CB-0021", agreementId: "TA-2025-003", period: "Q2 2026", claimCount: 12, paid: 310000, outstanding: 145000, recoverable: 197000, ccy: "CAD", status: "Matched", receivedDate: "2026-07-20", dueDate: "2026-08-31" },
];

export const treatyCessions = [
  { ref: "DC-0107", agreementId: "TA-2025-003", insured: "Northwind fleet — Ontario logistics (412 units)", cls: "Motor", sumInsured: 4200000, retention: 500000, ceded: 3700000, effectiveDate: "2026-06-01", status: "Accepted" },
  { ref: "DC-0108", agreementId: "TA-2025-003", insured: "Great Lakes Haulage Inc. — fleet", cls: "Motor", sumInsured: 2600000, retention: 500000, ceded: 2100000, effectiveDate: "2026-08-15", status: "Declared" },
  { ref: "DC-0109", agreementId: "TA-2025-003", insured: "Prairie Coach Lines — 38 coaches", cls: "Motor", sumInsured: 5100000, retention: 500000, ceded: 4500000, effectiveDate: "2026-09-01", status: "Queried" },
];

export const technicalAccounts = [
  { ref: "TAC-2026-011", agreementId: "TA-2026-002", period: "Q2 2026", premium: 1610000, commission: 450800, claims: 682500, tax: 0, ccy: "USD", status: "Agreed" },
  { ref: "TAC-2026-012", agreementId: "TA-2026-001", period: "Q2 2026", premium: 323750, commission: 0, claims: 0, tax: 0, ccy: "USD", status: "Issued" },
  { ref: "TAC-2026-013", agreementId: "TA-2025-003", period: "Q2 2026", premium: 1420000, commission: 355000, claims: 197000, tax: 28400, ccy: "CAD", status: "Settled" },
  { ref: "TAC-2026-014", agreementId: "TA-2025-004", period: "Q1 2026", premium: 82500, commission: 0, claims: 1040000, tax: 0, ccy: "USD", status: "Issued" },
];

export const treatySettlements = [
  { ref: "ST-0221", agreementId: "TA-2026-002", accountRef: "TAC-2026-011", counterparty: "Andean Capacity Re", amount: 286020, ccy: "USD", dueDate: "2026-09-30", paymentStatus: "Pending" },
  { ref: "ST-0222", agreementId: "TA-2026-002", accountRef: "TAC-2026-011", counterparty: "Comstock Re", amount: 190680, ccy: "USD", dueDate: "2026-09-30", paymentStatus: "Pending" },
  { ref: "ST-0223", agreementId: "TA-2025-003", accountRef: "TAC-2026-013", counterparty: "Comstock Re", amount: 461780, ccy: "CAD", dueDate: "2026-08-31", paymentStatus: "Paid" },
  { ref: "ST-0224", agreementId: "TA-2025-003", accountRef: "TAC-2026-013", counterparty: "Northbridge Reinsurance SE", amount: 377820, ccy: "CAD", dueDate: "2026-08-31", paymentStatus: "Paid" },
  { ref: "ST-0225", agreementId: "TA-2025-004", accountRef: "TAC-2026-014", counterparty: "Baltic Shield Re", amount: -670250, ccy: "USD", dueDate: "2026-08-15", paymentStatus: "Overdue" },
];
