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
      broker/             dashboard, placements, treaty, bordereaux, claims,
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

**Broker desk** — the full workspace. The placement lifecycle runs Draft →
Pending Approval → Slip Issued → Negotiating → Cedant Approval → Bound, and
loops back through the 60-day renewal list.

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
states what is still holding the bind. The only hard gate is that **every named
market must be Confirmed**; binding instructions are optional.

The dashboard shows **concentration** alongside the totals: premium by cedant
and exposure by reinsurer, each ranked with a flag when a single counterparty
holds a quarter of the book or more. A desk's two largest commercial risks are
a client too big to lose and a market too big to fail, and neither is visible
in a total.

**Registry** — the counterparty address book, one page per category: Cedants,
Reinsurance, Lloyd's Syndicates, Reinsurance Brokers and Others. They are kept
apart because the categories are not interchangeable — what a counterparty may
do on a slip depends on which one it sits in.

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
