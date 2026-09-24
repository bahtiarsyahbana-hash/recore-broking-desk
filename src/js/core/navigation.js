/**
 * Navigation registry — the single place a module is added to the desk.
 *
 * Each entry names the view id (which must match a view module's `id`), the
 * sidebar label, its icon and the section heading it sits under. The router
 * renders the sidebar from this; nothing about navigation lives in the HTML.
 */
import { icons } from "../ui/icons.js";
import { currentCedant } from "./store.js";

export const ROLES = {
  BROKER: "broker",
  CEDANT: "cedant",
};

/** Broker desk — the full placement, accounting and claims workspace. */
export const brokerNav = [
  { section: "Broker Desk" },
  { view: "dashboard",   label: "Dashboard",     icon: icons.dashboard },
  { view: "intake",      label: "Intake",        icon: icons.inbox },
  { view: "placements",  label: "Placements",    icon: icons.placements },
  { view: "treaty",      label: "Treaty Engine", icon: icons.treaty },
  { view: "claims",      label: "Claims",        icon: icons.claims },
  { view: "accounting",  label: "Finance",       icon: icons.accounting },
  { view: "reports",     label: "Reports",       icon: icons.reports },
  { section: "Registry" },
  { view: "reg-cedants",     label: "Cedants",             icon: icons.cedant },
  { view: "reg-reinsurance", label: "Reinsurance",         icon: icons.reinsurance },
  { view: "reg-syndicates",  label: "Lloyd's Syndicates",  icon: icons.syndicate },
  { view: "reg-brokers",     label: "Reinsurance Brokers", icon: icons.brokers },
  { view: "reg-others",      label: "Others",              icon: icons.others },
];

/** Cedant portal — the optional, restricted mirror of one cedant's own book. */
export const cedantNav = [
  { section: () => `Cedant Portal · ${currentCedant()}` },
  { view: "c-programs",  label: "My Programs",      icon: icons.folder },
  { view: "c-submit",    label: "Submit a Risk",    icon: icons.plusCircle },
  { view: "c-bdx",       label: "Upload Bordereau", icon: icons.upload },
  { view: "c-statement", label: "Account Statement", icon: icons.statement },
];

/** Per-role chrome: landing view, avatar initials and the sidebar footer note. */
export const roleChrome = {
  [ROLES.BROKER]: {
    nav: brokerNav,
    landing: "dashboard",
    avatar: "VR",
    footer: "Underwriting year 2026 · USD reporting",
  },
  [ROLES.CEDANT]: {
    nav: cedantNav,
    landing: "c-programs",
    avatar: "MM",
    footer: "Meridian Mutual Insurance · read-only",
  },
};
