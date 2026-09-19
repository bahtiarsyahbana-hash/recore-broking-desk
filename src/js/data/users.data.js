/**
 * Demo user accounts.
 *
 * ⚠ THIS IS NOT AUTHENTICATION. Credentials are held in plain text in the
 * browser, every password is printed on the sign-in screen, and the check runs
 * entirely client-side. It is a prototype gate that decides which portal and
 * which authority you are demonstrating — nothing here protects anything.
 *
 * Replacing it with real auth means swapping `domain/session.js` for calls to
 * an identity provider and deleting this file. No view reads it directly.
 *
 * A user record carries:
 *   username, password       — the demo credentials, shown on the sign-in screen
 *   name, title, initials    — how the person appears in the app
 *   portal                   — "broker" | "cedant", which workspace they land in
 *   canReleaseSlips          — broker only: may release a slip to market
 *   bypassFourEyes           — broker only: may release their own submission
 *   cedant                   — cedant only: whose book the portal shows
 */
export const USERS = [
  /* ---------- Broker desk ---------- */
  {
    id: "vr",
    username: "vroy",
    password: "victor2026",
    name: "Victor Roy",
    initials: "VR",
    title: "Placement Broker",
    portal: "broker",
    canReleaseSlips: false,
    summary: "Prepares submissions. Cannot release a slip to market.",
  },
  {
    id: "ml",
    username: "mlindqvist",
    password: "maya2026",
    name: "Maya Lindqvist",
    initials: "ML",
    title: "Authorised Signatory",
    portal: "broker",
    canReleaseSlips: true,
    summary: "Releases slips prepared by someone else.",
  },
  {
    id: "ao",
    username: "aokonjo",
    password: "adeola2026",
    name: "Adeola Okonjo",
    initials: "AO",
    title: "Authorised Signatory",
    portal: "broker",
    canReleaseSlips: true,
    summary: "Second signatory, so four-eyes never deadlocks.",
  },
  {
    id: "adm",
    username: "admin",
    password: "admin2026",
    name: "Desk Administrator",
    initials: "AD",
    title: "Administrator",
    portal: "broker",
    canReleaseSlips: true,
    bypassFourEyes: true,
    summary: "Releases anything, including their own submissions.",
  },

  /* ---------- Cedant portal ---------- */
  {
    id: "ced-meridian",
    username: "meridian",
    password: "meridian2026",
    name: "Meridian Mutual Insurance",
    initials: "MM",
    title: "Cedant",
    portal: "cedant",
    cedant: "Meridian Mutual Insurance",
    summary: "Sees only Meridian Mutual's own programs.",
  },
  {
    id: "ced-pacifico",
    username: "pacifico",
    password: "pacifico2026",
    name: "Pacífico General Insurance",
    initials: "PG",
    title: "Cedant",
    portal: "cedant",
    cedant: "Pacífico General Insurance",
    summary: "Sees only Pacífico General's own programs.",
  },
];

export const brokerUsers = () => USERS.filter((u) => u.portal === "broker");
export const cedantUsers = () => USERS.filter((u) => u.portal === "cedant");
