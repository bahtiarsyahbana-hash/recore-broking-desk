/**
 * Placement book — every facultative risk and treaty program the desk is running
 * this underwriting year.
 *
 * Shape of a program:
 *   id, cedant, cls, type, structure, premium, ccy, status, expiry
 *   loss / earned        — drive loss-ratio reporting
 *   premiumPaid          — credit-control gate on claims processing
 *   coBroker             — { name, split } when commission is shared
 *   bindingInstructions  — free text captured at bind
 *   marketConfirmations  — [{ m: market name, s: Sent | Queried | Confirmed,
 *                            line: signed share % }]
 *   preparedBy           — who built the submission
 *   approvedBy           — who released the slip to market (four-eyes)
 *   documents            — [{ name, from, date, type }] the slip dropbox
 *
 * Mutated only through services/placement.service.js.
 */

export const programs = [
  {id:"P-1001", cedant:"Meridian Mutual Insurance", cls:"Property", type:"Excess of Loss", structure:"3-layer tower, $40m xs $5m", premium:4650000, ccy:"USD", status:"Bound", expiry:"2027-01-01", loss:6800000, earned:4650000,
    premiumPaid:true, coBroker:null, bindingInstructions:"Settle via Meridian Bridge client account, 30-day terms.",
    preparedBy:{id:"vr",name:"Victor Roy",title:"Placement Broker"}, approvedBy:{id:"ml",name:"Maya Lindqvist",title:"Authorised Signatory"},
    marketConfirmations:[{m:"Helvetia Continental Re",s:"Confirmed",line:40},{m:"Northbridge Reinsurance SE",s:"Confirmed",line:35},{m:"Comstock Re",s:"Confirmed",line:25}],
    documents:[{name:"Slip v2 — signed.pdf", from:"Broker", date:"2026-01-04", type:"Slip"},{name:"Layer 1 confirmation.pdf", from:"Helvetia Continental Re", date:"2026-01-06", type:"Confirmation"}]},
  {id:"P-1002", cedant:"Pacífico General Insurance", cls:"Property", type:"Quota Share", structure:"35% cession, 28% commission", premium:18400000, ccy:"USD", status:"Bound", expiry:"2027-04-01", loss:8200000, earned:18400000,
    premiumPaid:true, coBroker:{name:"Andean Risk Partners", split:30}, bindingInstructions:"Quarterly bordereaux-driven settlement, USD.",
    preparedBy:{id:"vr",name:"Victor Roy",title:"Placement Broker"}, approvedBy:{id:"ml",name:"Maya Lindqvist",title:"Authorised Signatory"},
    marketConfirmations:[{m:"Andean Capacity Re",s:"Confirmed",line:60},{m:"Northbridge Reinsurance SE",s:"Confirmed",line:40}],
    documents:[{name:"QS slip — signed.pdf", from:"Broker", date:"2026-04-02", type:"Slip"}]},
  {id:"P-1003", cedant:"Sahara Takaful Insurance", cls:"Marine", type:"Facultative", structure:"Single risk · cargo, $40m SI", premium:186000, ccy:"USD", status:"Bound", expiry:"2027-02-14", loss:340000, earned:186000,
    premiumPaid:true, coBroker:null, bindingInstructions:"Single premium, payable at inception.",
    preparedBy:{id:"vr",name:"Victor Roy",title:"Placement Broker"}, approvedBy:{id:"ml",name:"Maya Lindqvist",title:"Authorised Signatory"},
    marketConfirmations:[{m:"Baltic Shield Re",s:"Confirmed",line:100}],
    documents:[{name:"Fac slip — signed.pdf", from:"Broker", date:"2026-02-10", type:"Slip"}]},
  {id:"P-1004", cedant:"Northwind Assurance Co.", cls:"Motor", type:"Surplus", structure:"9 lines xs $500k retention", premium:2260000, ccy:"CAD", status:"Bound", expiry:"2027-01-01", loss:980000, earned:2260000,
    premiumPaid:false, coBroker:null, bindingInstructions:"Monthly bordereaux, CAD settlement.",
    preparedBy:{id:"vr",name:"Victor Roy",title:"Placement Broker"}, approvedBy:{id:"ml",name:"Maya Lindqvist",title:"Authorised Signatory"},
    marketConfirmations:[{m:"Comstock Re",s:"Confirmed",line:100}],
    documents:[{name:"Surplus slip — signed.pdf", from:"Broker", date:"2025-12-20", type:"Slip"}]},
  {id:"P-1005", cedant:"Meridian Mutual Insurance", cls:"Casualty", type:"Quota Share", structure:"20% cession, 25% commission", premium:6100000, ccy:"USD", status:"Renewal Due", expiry:"2026-11-05", loss:2100000, earned:5400000,
    premiumPaid:true, coBroker:null, bindingInstructions:"",
    preparedBy:{id:"vr",name:"Victor Roy",title:"Placement Broker"}, approvedBy:{id:"ml",name:"Maya Lindqvist",title:"Authorised Signatory"},
    marketConfirmations:[{m:"Northbridge Reinsurance SE",s:"Confirmed",line:60},{m:"Comstock Re",s:"Confirmed",line:40}],
    documents:[]},
  {id:"P-1006", cedant:"Pacífico General Insurance", cls:"Property", type:"Excess of Loss", structure:"$30m xs $10m, 2 reinst.", premium:1980000, ccy:"USD", status:"Negotiating", expiry:"2027-06-01", loss:0, earned:0,
    premiumPaid:false, coBroker:null, bindingInstructions:"",
    preparedBy:{id:"vr",name:"Victor Roy",title:"Placement Broker"}, approvedBy:{id:"ml",name:"Maya Lindqvist",title:"Authorised Signatory"},
    marketConfirmations:[{m:"Zenith Re · Syndicate 2044",s:"Confirmed",line:40},{m:"Andean Capacity Re",s:"Queried",line:35},{m:"Baltic Shield Re",s:"Sent",line:25}],
    documents:[{name:"Slip v1 — issued.pdf", from:"Broker", date:"2026-08-28", type:"Slip"},{name:"Query — reinstatement wording.eml", from:"Andean Capacity Re", date:"2026-09-02", type:"Query"}]},
  {id:"P-1007", cedant:"Meridian Mutual Insurance", cls:"Property", type:"Facultative", structure:"Warehouse extension endorsement, $8m SI", premium:64000, ccy:"USD", status:"Cedant Approval", expiry:"2027-01-01", loss:0, earned:0,
    premiumPaid:false, coBroker:null, bindingInstructions:"",
    preparedBy:{id:"vr",name:"Victor Roy",title:"Placement Broker"}, approvedBy:{id:"ml",name:"Maya Lindqvist",title:"Authorised Signatory"},
    marketConfirmations:[{m:"Baltic Shield Re",s:"Confirmed",line:100}],
    documents:[{name:"Slip — confirmed.pdf", from:"Baltic Shield Re", date:"2026-09-12", type:"Confirmation"}]}
];
