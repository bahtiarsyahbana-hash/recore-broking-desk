# Recordes Reinsurance Broking Desk

Interactive prototype of a reinsurance broker core system — facultative and
treaty placement, quota share / surplus / excess-of-loss calculators, bordereaux,
claims, accounting, and an optional cedant portal.

## Running it

```bash
npm run dev
```

Then open <http://localhost:4173> and sign in. Every demo account and its
password is printed on the sign-in screen — click one to fill the form.

| Username | Password | Who |
|---|---|---|
| `vroy` | `victor2026` | Victor Roy · Placement Broker — prepares, cannot release |
| `mlindqvist` | `maya2026` | Maya Lindqvist · Authorised Signatory |
| `aokonjo` | `adeola2026` | Adeola Okonjo · Authorised Signatory |
| `admin` | `admin2026` | Desk Administrator — releases anything, including own work |
| `meridian` | `meridian2026` | Cedant portal · Meridian Mutual Insurance |
| `pacifico` | `pacifico2026` | Cedant portal · Pacífico General Insurance |

**This sign-in is not security.** Credentials live in the browser, the check is
a client-side string match, and the passwords are printed on screen on purpose.
It decides which workspace opens and whose authority applies — nothing more.

There is no build step, no bundler and no dependencies — `npm install` is not
needed and `node_modules` stays empty. The dev server is a ~60-line zero-
dependency script (`scripts/dev-server.mjs`) whose only job is to serve `src/`
over HTTP, because the app uses ES modules and opening `src/index.html` from the
filesystem will not work.

Override the port with `PORT=8080 npm run dev`. Any other static server rooted at
`src/` does the job equally well, e.g. `npx serve src`.

## Deploying

The app is static — `src/` is the whole site, with no build step. `vercel.json`
points Vercel at it:

```json
{ "framework": null, "outputDirectory": "src" }
```

Nothing is compiled, so `npm install` and a build command are both unnecessary.
Any static host works the same way: serve `src/` at the root.

**Before deploying anywhere public, read this.** The sign-in is not
authentication — every password is printed on the screen, so a deployment is
readable by anyone who has the URL. `src/robots.txt` keeps it out of search
results, but that is a courtesy, not a control. If the deployment should not be
public, put Vercel's Deployment Protection in front of it.

## Layout

```
src/
  index.html              app shell only — sidebar, topbar, view mount, modal mount
  styles/
    main.css              entry point; imports the layers in cascade order
    tokens.css            colour, elevation, the dark palette
    base.css              resets and typography
    layout.css            app grid, sidebar, topbar
    components/           buttons, cards, tables, pills, forms, tabs, tower,
                          modal, banner, lifecycle, misc
    responsive.css        narrow-viewport overrides (loaded last)
  js/
    main.js               bootstrap
    core/                 config, store, events, router, navigation, format, dom
    data/                 seed fixtures
    domain/               pure reinsurance maths + the placement state machine
    services/             the only writers to state; they publish what changed
    ui/                   badges, charts, icons, modal host, wizard, detail drawer
    views/
      broker/             dashboard, placements, treaty, claims,
                          accounting, reports, and the five registry pages
      cedant/             programs, submit, bordereau, statement
scripts/
  dev-server.mjs          zero-dependency static server for `npm run dev`
docs/
  ARCHITECTURE.md         the layering rules and how to extend the system
  COUNTERPARTY-FIELDS.md  what the registry forms capture, and the sources why
Recordes-Broking-Desk.html  the original single-file prototype, kept for reference
```

## What the desk does

**Broker desk** — the full workspace. A request for cover starts in the
**Intake** queue (recorded by the desk from email, phone, WhatsApp or a
meeting, or sent from the cedant portal) and, once accepted, becomes a
placement. The placement lifecycle runs Draft Slip → internal approval →
Placed to Market → Market Negotiation → Backup Secured → Proposal Sent →
Cedant Negotiation → Cedant Approved (awaiting instruction to bind) → Bind
Instructed → Bound Issued, and loops back through the 60-day renewal list.
Market backup is not cedant approval, cedant approval is not an instruction to
bind, and binding is its own recorded act.

The Placements page shows the same book as a **Kanban** board (one column per
stage, substatus on each card, counts per column, no drag-and-drop — a status
changes only through a recorded action), a **Table** or a compact **List**; the
choice is remembered for the browser session. Open intakes appear in the
board's Intake column and open the intake drawer. New placements are Quota Share
(one horizontal panel) or Excess of Loss (a layered tower, each layer with its
own panel that must sign to exactly 100%); historical Facultative and Surplus
records remain visible.

The wizard's final step is a **full summary of the placement** — the risk, the
terms as entered with the gross and ceded premium they price to, and the market
panel with each signed line and the total — read before anything is saved.

Preparing a submission and releasing it to market are **separate acts by
different people**. The wizard saves a draft; an authorised signatory reviews
and releases it. The preparer cannot release their own slip, and the gate
enforces that signed lines total exactly 100% and the cedant's KYC is current.
Who you are follows from the account you sign in with — there is no seat or
role switcher inside the app. A broker cannot step into the cedant portal, and
a cedant sees only their own book. To release a slip you prepared yourself, sign
out and back in as a signatory; the administrator account can release anything,
and the record is marked whenever that override is used. Where a release is blocked, the drawer names who
can release it rather than leaving you to work it out. Binding raises the market invoice automatically.
Claims are held by credit control while their program's premium is outstanding.

The lifecycle drawer walks an operator through that journey rather than leaving
them to infer it: a numbered rail shows where the placement is, a **next-action
card** names the one thing to do now and why — "Resolve 1 open query · Andean
Capacity Re has queried the terms" — with its button attached, and a checklist
states what is still holding the bind. The hard gates are that **confirmed
signed lines total exactly 100%** on every layer, that the cedant's approval
and then their **instruction to bind** have been recorded, and that any cedant
revision after approval has invalidated both. The separate free-text **binding
notes** (payment terms, subjectivities and special conditions) are optional;
the cedant's instruction to bind is not.
Binding freezes the terms and issues the RI slip and binding slips, each with a
delivery status.

**Treaty Engine** administers treaty contracts already negotiated and bound
outside Recordes. The broker registers each Treaty Agreement (a five-step
wizard: basics, structure by type, reinsurer panel, reporting and accounting,
documents and summary) and then manages its premium bordereaux, claims
bordereaux, individual cessions, technical accounts, settlements, documents,
endorsements and audit trail under it. The register offers Table, List and
Cards with filters for cedant, class, contract period, status, treaty type,
reinsurer and currency. An agreement activates only when its panel totals
exactly 100%; a Closed agreement takes no new transactions; only agreements
configured to require declarations accept individual cessions.

**Finance** bills premium the way it flows: an invoice to the cedant and a
**Closing Slip** to each reinsurer, with brokerage deducted from the
remittance. Binding a placement, endorsing a bound placement, or agreeing a
treaty technical account prepares a draft; a second authorised person
approves and issues it, and every document is numbered at issue and frozen
thereafter. Due dates run from the bound, endorsement or agreed date plus the
payment warranty. Taxes and levies are custom rules the desk configures. The
broker's own bank accounts are kept under Finance → Bank Accounts, and the
primary collection account in the document's currency is printed on each
invoice as its payment instructions.
Receipts from the cedant are recorded against each invoice, part-payments
included; each one drafts remittances to the reinsurers pro rata, which a
second authorised person approves before the transfer is recorded. Paying
every invoice and debit note on a placement lifts the claims credit-control
hold. Credit-note refunds and aging come in later phases.

Every **Registry** entry opens to a drawer where the desk views or manages the
company profile, the bank accounts settlement runs through, and the people in
charge grouped by the division they handle — placement, claims, technical
accounting, compliance, management — with several people allowed per division.

Tests: `npm test` runs the domain rules (lifecycle, panel capacity, intake, registry profile, treaty administration, billing)
with Node's built-in test runner; there are no dependencies.

The dashboard shows **concentration** alongside the totals: premium by cedant
and exposure by reinsurer, each ranked with a flag when a single counterparty
holds a quarter of the book or more. A desk's two largest commercial risks are
a client too big to lose and a market too big to fail, and neither is visible
in a total.

**Registry** — the counterparty address book, one page per category: Cedants,
Reinsurance, Lloyd's Syndicates, Reinsurance Brokers and Others. They are kept
apart because the categories are not interchangeable — what a counterparty may
do on a slip depends on which one it sits in.

The registry holds **651 imported counterparties** — SEA cedants, global and
offshore reinsurers, Lloyd's syndicates and Indonesian broking partners — on top
of the demo book. Every page is searchable; imported cedants show `Not assessed`
KYC until somebody onboards them, and the slip release gate refuses to place for
them until then. See [scripts/import/](scripts/import/README.md) to regenerate
from a reissued workbook.

Each page has its own add-form, asking only for what that category needs. A
small required set sits above collapsible optional sections for contacts,
settlement terms and security — see
[docs/COUNTERPARTY-FIELDS.md](docs/COUNTERPARTY-FIELDS.md) for what each field is
for and the regulatory source behind it.

Names, LEIs and syndicate numbers must each be unique across the whole registry,
because the rest of the system refers to a counterparty by name alone. LEIs are
checksum-validated to ISO 17442. A new cedant is immediately selectable in the
submission wizard; a new market joins the capacity panel and the accumulation
report with nil committed capacity.

**Cedant portal** — an optional, restricted module. A cedant sees only its own
programs, its own submissions and its own statement; never the market panel, the
desk's accounting, or another cedant's book.

## Extending it

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The short version:
dependencies point downward (`views → ui/services → domain → core → data`), every
mutation goes through a service, and services publish on the event bus rather
than calling renderers directly.
