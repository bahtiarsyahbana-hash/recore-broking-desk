/**
 * Counterparty registry — the address book behind every submission.
 *
 * Names are referential keys across programs, claims and finance documents.
 * Renaming an entry here breaks those links; add rather than rename.
 *
 * These are seed fixtures. The live, mutable copies live in core/store.js and
 * are written only by services/registry.service.js — import from the store, not
 * from here, or additions made in the app will not be visible.
 */

// Cedant book — original 4 (referenced by exact name across programs/claims/finance,
// do not rename) plus a broader SEA cedant book reflecting the desk's regional registry.
export const cedants = [
  {name:"Meridian Mutual Insurance", country:"United States", kyc:"Current", refreshed:"2026-03-11"},
  {name:"Pacífico General Insurance", country:"Chile", kyc:"Current", refreshed:"2026-01-22"},
  {name:"Sahara Takaful Insurance", country:"United Arab Emirates", kyc:"Current", refreshed:"2025-11-08"},
  {name:"Northwind Assurance Co.", country:"Canada", kyc:"Review due", refreshed:"2025-06-02"},
  {name:"Garuda Nusantara Life", country:"Indonesia", kyc:"Current", refreshed:"2026-07-19"},
  {name:"Cempaka Sejahtera Insurance", country:"Indonesia", kyc:"Current", refreshed:"2026-05-02"},
  {name:"Selat General Takaful", country:"Malaysia", kyc:"Review due", refreshed:"2025-09-30"},
  {name:"Raffles Harbour Insurance", country:"Singapore", kyc:"Current", refreshed:"2026-04-14"},
  {name:"Chao Phraya General Insurance", country:"Thailand", kyc:"Current", refreshed:"2026-02-27"},
  {name:"Mekong Delta Assurance", country:"Vietnam", kyc:"Review due", refreshed:"2025-08-11"}
];
// Underwriting markets — company-form reinsurers and Lloyd's syndicates, tagged by
// `type` so the registry can split them while the wizard/report code below keeps
// treating this as one flat capacity panel. The original 6 entries are referenced by
// exact name in marketConfirmations elsewhere in this file — do not rename/remove them.
export const markets = [
  {name:"Helvetia Continental Re", rating:"AA- (S&P)", panel:"Property Cat", capacity:0, type:"Reinsurance"},
  {name:"Zenith Re · Syndicate 2044", rating:"A+ (AM Best)", panel:"Property Cat", capacity:0, type:"Lloyds Syndicate"},
  {name:"Andean Capacity Re", rating:"A (S&P)", panel:"LatAm Treaty", capacity:0, type:"Reinsurance"},
  {name:"Northbridge Reinsurance SE", rating:"AA (S&P)", panel:"Global Treaty", capacity:0, type:"Reinsurance"},
  {name:"Comstock Re", rating:"A- (AM Best)", panel:"Global Treaty", capacity:0, type:"Reinsurance"},
  {name:"Baltic Shield Re", rating:"A (S&P)", panel:"Marine & Cargo", capacity:0, type:"Reinsurance"},
  {name:"Nanyang Re", rating:"A (S&P)", panel:"SEA Treaty", capacity:0, type:"Reinsurance"},
  {name:"Meridian Gulf Re", rating:"A (AM Best)", panel:"Energy & Property", capacity:0, type:"Reinsurance"},
  {name:"Sequoia Continental Re", rating:"AA- (S&P)", panel:"Global Treaty", capacity:0, type:"Reinsurance"},
  {name:"Tyrrhenian Re", rating:"A- (S&P)", panel:"Marine & Cargo", capacity:0, type:"Reinsurance"},
  {name:"Anatolia Re", rating:"B+ (AM Best)", panel:"Regional Property", capacity:0, type:"Reinsurance"},
  {name:"Sahel Re", rating:"B (AM Best)", panel:"Regional Property", capacity:0, type:"Reinsurance"},
  {name:"Marlow Underwriting · Syndicate 1918", rating:"A+ (AM Best)", panel:"Property Cat", capacity:0, type:"Lloyds Syndicate"},
  {name:"Copperfield Re · Syndicate 3350", rating:"A+ (AM Best)", panel:"Marine & Cargo", capacity:0, type:"Lloyds Syndicate"},
  {name:"Sextant Re · Syndicate 2711", rating:"A+ (AM Best)", panel:"SEA Treaty", capacity:0, type:"Lloyds Syndicate"}
];
// Reinsurance brokers — co-broking / local placement partners who share commission on
// a slip rather than take a signed line. "Andean Risk Partners" is the co-broker
// already referenced on P-1002 and in Accounting/Finance — kept first for consistency.
export const brokers = [
  {name:"Andean Risk Partners", country:"Chile", role:"Co-broker", status:"Active"},
  {name:"Nusantara Re Brokers", country:"Indonesia", role:"Local placement partner", status:"Active"},
  {name:"Selendang Reinsurance Brokers", country:"Indonesia", role:"Local placement partner", status:"Active"},
  {name:"Marina Bay Re Partners", country:"Singapore", role:"Co-broker", status:"Active"},
  {name:"Kinabalu Reinsurance Services", country:"Malaysia", role:"Local placement partner", status:"Review due"}
];
// Others — service counterparties outside the underwriting panel (claims TPAs,
// catastrophe modeling, actuarial, offshore captive vehicles).
export const others = [
  {name:"Northshore Claims TPA", country:"United Kingdom", role:"Claims TPA", status:"Active"},
  {name:"Tremor Risk Analytics", country:"United States", role:"Cat modeling vendor", status:"Active"},
  {name:"Kestrel Actuarial Services", country:"Singapore", role:"Actuarial consultancy", status:"Active"},
  {name:"Labuan Sentinel Re", country:"Malaysia (Labuan)", role:"Captive reinsurer", status:"Review due"}
];


/**
 * The capacity line each market has agreed to make available to the desk —
 * what they are willing to write, not what they have written.
 *
 * Actual exposure is never read from here: it is derived from the lines signed
 * on real placements (see `exposureByReinsurer`). These two used to be
 * conflated, which let the accumulation report show a market 7x its true
 * exposure and give capacity to markets carrying no placement at all.
 */
export const capacityLines = {
  "Helvetia Continental Re": 12400000,
  "Zenith Re · Syndicate 2044": 9800000,
  "Andean Capacity Re": 6100000,
  "Northbridge Reinsurance SE": 15200000,
  "Comstock Re": 4300000,
  "Baltic Shield Re": 2600000,
  "Nanyang Re": 7400000,
  "Meridian Gulf Re": 3900000,
  "Sequoia Continental Re": 10800000,
  "Tyrrhenian Re": 2100000,
  "Anatolia Re": 900000,
  "Sahel Re": 600000,
  "Marlow Underwriting · Syndicate 1918": 8600000,
  "Copperfield Re · Syndicate 3350": 3200000,
  "Sextant Re · Syndicate 2711": 5100000,
};
