# Recordes Reinsurance Broking Desk — Architecture

The prototype was one 1,513-line HTML file. This document describes the structure
it was split into, and the rules that keep it that way as the system grows.

## Layers

Dependencies point downward only. A module may import from the layers below it,
never from the layers above.

```
        ┌──────────────────────────────────────────────┐
        │  views/        one screen each                │
        │  broker/ · cedant/                            │
        └──────────────────────────────────────────────┘
                     │                    │
        ┌────────────▼──────────┐  ┌──────▼─────────────┐
        │  ui/                  │  │  services/         │
        │  badges · charts      │  │  the only writers  │
        │  modal · wizard       │  │  to state          │
        │  program-detail       │  │                    │
        └───────────────────────┘  └────────────────────┘
                     │                    │
        ┌────────────▼────────────────────▼─────────────┐
        │  domain/     pure reinsurance maths            │
        │  quota-share · surplus · xol                   │
        │  technical-account · lifecycle · portfolio     │
        └───────────────────────────────────────────────┘
                              │
        ┌─────────────────────▼─────────────────────────┐
        │  core/       config · store · events           │
        │              router · navigation · format · dom│
        └───────────────────────────────────────────────┘
                              │
        ┌─────────────────────▼─────────────────────────┐
        │  data/       seed fixtures                     │
        └───────────────────────────────────────────────┘
```

### `data/` — fixtures

Seed records only: the counterparty registry, the placement book, bordereaux,
claims and finance documents. No behaviour. Counterparty **names are referential
keys** across programs, claims and finance documents — add entries, never rename
them.

### `core/` — shell services

| Module | Responsibility |
|---|---|
| `config.js` | Desk constants: reporting currency, FX, watch lines, renewal horizon, fixed `TODAY` |
| `format.js` | Money, percentage and date formatting — the only place values are formatted |
| `dom.js` | `$`, `el`, `row`, `mount`, `onAction` (delegated clicks), `onInput`, `numVal` |
| `events.js` | Pub/sub bus and the `TOPICS` a service may publish |
| `store.js` | Live mutable state, the signed-in session, the counterparty registry, and document-numbering sequences |
| `navigation.js` | The nav registry — one entry per module, per role |
| `router.js` | Renders the sidebar, swaps views, owns the role switch |

### `domain/` — reinsurance logic

Pure functions. No DOM, no state, no formatting — terms in, numbers out. This is
where the business is, and it is the layer worth unit-testing first.

- `quota-share.js`, `surplus.js`, `xol.js` — the three treaty forms, plus rate on
  line, tower geometry and reinstatement premium
- `technical-account.js` — the running account per program, and the default
  cession/commission rates by treaty type
- `lifecycle.js` — the placement state machine: the five steps, `canBind`, the
  status implied by a confirmation round, and the **operator guidance**
  (`nextAction`, `bindChecklist`, `confirmationProgress`) that turns that state
  into "here is what to do now and what is blocking it". The guidance lives
  beside the rules rather than in the drawer, so the two cannot drift, and
  `nextAction` always reports the same step number as the journey rail —
  `stepIndexFor(status)` is the single source of truth for position.
- `portfolio.js` — book-level analytics: totals, premium by class, loss ratios,
  renewals due
- `session.js` — sign-in. **Not security**: a client-side string match against
  credentials that ship in the browser and are printed on the sign-in screen.
  Replacing it with real auth means swapping this module and deleting
  `data/users.data.js`; no view reads either directly.
- `authority.js` — who is at the desk and what they may release, including the
  four-eyes rule that a preparer may not approve their own submission. Authority
  now travels with the signed-in user, derived from the same records, rather
  than being declared separately
- `slip-approval.js` — the release gate: signed lines at 100%, cedant KYC
  current, panel named, second authorised person
- `placement-terms.js` — what a submission's terms imply: the structure line as
  it reads on a slip, and the gross and ceded premium each treaty form prices to
- `counterparty.js` — identity rules: LEI checksum (ISO 7064 MOD 97-10),
  Lloyd's syndicate number, email and phone format, and the regulatory
  counterparty code in its PRA priority order

### `services/` — the only writers

Every mutation goes through a service. A service applies the domain rules,
records the paper trail, raises any finance document the transition implies, and
**publishes what changed** on the event bus. Views never mutate state directly.

`placement.service.js` is the spine: `saveDraft` → `submitForApproval` →
`releaseSlip` → `addDocument` → `approveAndBind` → `startRenewal`, which loops
back to the top. `returnToDraft` sends a submission back to its preparer.

**Preparation and release are separate acts**, and that separation is the point.
A draft is internal bookkeeping; releasing a slip puts the firm's name in front
of the market. So `releaseSlip` is guarded by `slip-approval.js` and re-checks
every condition at the moment of release rather than trusting the submit step.

`registry.service.js` guards the one invariant the whole system rests on:
**counterparty names are unique across every category.** A program's `cedant`, a
market confirmation's `m` and a finance document's `counterparty` all point at a
registry entry by name and nothing else, so two counterparties sharing a name
would silently merge their placements, confirmations and invoices. The check is
case- and whitespace-insensitive and spans all five categories.

### `ui/` — shared presentation

`form-modal.js` renders a form from a field schema, validates on submit, and
shows per-field errors **without closing** — a rejected entry keeps everything
already typed. Fields marked `hidden` are carried through to the record without
being shown, which is how the Reinsurance and Lloyd's pages each write their own
fixed market `type`.

`badges.js` holds the single status vocabulary, so a queried market and a KYC
record due for review read the same way everywhere. `charts.js` returns SVG
markup as pure functions. `modal.js` is the overlay host; `submission-wizard.js`
and `program-detail.js` are the two overlays.

### `views/` — one screen each

A view is an object:

```js
export const someView = {
  id: "some-view",       // must match the nav entry's `view`
  render() { … },        // returns the screen's markup
  mount() { … },         // optional: wire listeners, runs once per mount
  refresh() { … },       // optional: re-read state into the DOM
};
```

Some views are generated rather than hand-written: the five Registry pages all
come from `createRegistryView()` in `views/broker/registry.view.js`, which turns
one `REGISTRY_CATEGORIES` entry into a view object. A factory is the right shape
when screens differ only in their records and how a row reads.

Views subscribe to the topics they care about at module scope and call their own
`refresh()` when those fire — which is why binding a placement updates the
placements table, the dashboard KPIs and the finance ledger without any of them
knowing about each other.

## Conventions

- **ES modules, no build step.** The app is served as-is; there is nothing to
  compile. `type="module"` means it must be served over HTTP, not opened from the
  filesystem.
- **No inline `onclick`, no `window.*` handlers.** Interactive elements carry
  `data-action` (plus any `data-*` payload) and a container-level delegated
  listener wired through `onAction`.
- **Formatting is presentation.** Domain and service modules return raw numbers;
  only views and `ui/` format them.
- **CSS is layered** — `tokens → base → layout → components → responsive` — and
  imported in that order by `styles/main.css`. All colour goes through the tokens
  in `styles/tokens.css`; nothing hard-codes a hex value except the chart
  palettes in `core/config.js`.

## Adding to the system

**A new screen:** write `views/<role>/<name>.view.js`, add it to
`views/index.js`, and add a nav entry in `core/navigation.js`. Nothing else
changes.

**A new calculation:** a pure module under `domain/`, called by whichever view or
service needs it. If it posts to an account, call it from a service so the
resulting documents and events are raised consistently.

**A new counterparty category:** add the seed records to
`data/counterparties.data.js`, the live list to `core/store.js`, a collection
mapping to `COLLECTIONS` in `services/registry.service.js`, an entry to
`REGISTRY_CATEGORIES` in `views/broker/registry.view.js`, and a nav entry in
`core/navigation.js`. The page and its add-form are both built by
`createRegistryView()` — there is no per-category view or form file to write.

**A new field on an existing category:** add it to that category's schema in
`views/broker/registry-fields.js`. It renders, validates and saves with no other
change. Give it a `section` to put it in a collapsible optional block, and a
`validate` function for its own rule. See
[COUNTERPARTY-FIELDS.md](COUNTERPARTY-FIELDS.md) for what each field is for and
why it is required or optional.

## Where registry data lives

`data/counterparties.data.js` holds seed fixtures only. The live, mutable lists
are in `core/store.js`, and `reinsuranceCompanies()` / `lloydsSyndicates()` are
**functions, not cached arrays** — they were once module-level `.filter()`
snapshots, which meant a market added at runtime never appeared. Import
counterparties from the store, never from the fixtures, or additions will be
invisible.

## Swapping the fixtures for a backend

`core/store.js` is the seam. It is the only module that knows the data is
in-memory. Replace its getters with fetches and give the services an API client;
no view and no domain module changes.

## Known quirks carried over from the prototype

These behaviours match the original file exactly and were left untouched during
the split. Each is a deliberate carry-over, not a regression:

- The XoL tower renders the cedant retention block **above** the layers, because
  `.tower` uses `flex-direction: column-reverse` while the retention block is
  appended last.
- A market panel's confirmation round confirms every market except every third
  one, which is queried — a simulation, not a rule.
- `technicalAccount()` derives cession and commission from the treaty *type*
  rather than from the program's own slip terms.
- The cedant statement reads the second program in the cedant's book, falling
  back to the first.

## The release gate

Two rules the old flow promised and never enforced now live at the gate:

- **Signed lines total exactly 100%.** The wizard used to tint its total red or
  green and issue the slip regardless. A slip is placed or it is not.
- **Cedant KYC is current.** The registry captured the field and nothing read
  it. A cedant due for review cannot have a slip issued in their name.

Plus the control that makes it a gate at all: **the preparer may not release
their own submission.** `state.seat` decides who is acting, and `preparedBy` /
`approvedBy` are stamped on the record.

### The administrator override

`DESK_USERS.admin` carries `bypassFourEyes: true`, so an administrator releases
a slip without the separate-person rule, including one they prepared
themselves. This keeps the desk moving while the full approval hierarchy is
still being set up.

It is an override, not a hole: when it is used, `releasedUnderOverride` is set
on the placement, the dropbox document is named
*"released under administrator override"*, the checklist relabels itself
*"Released under administrator override"* rather than claiming a second pair of
eyes, and the authority trail carries a notice. A self-approval must never read
the same as a witnessed one.

**To retire it later, delete `bypassFourEyes` from that one record.** Nothing
else reads the flag.

The desk otherwise has **two authorised signatories, not one**. With a single
signatory, any slip that person prepared could never be released by anybody —
four-eyes would deadlock the placement permanently with no way out of the
drawer. Any desk operating this control in earnest has at least two people who
can sign, and `eligibleApprovers()` names them in the UI rather than telling an
operator to go and find "an authorised signatory".

Signed lines are editable **only while the slip is a draft**. Once it is with
the market, the lines are what the reinsurers were asked to sign, and editing
them behind their back would make every confirmation meaningless.

## Fixed since the split

- **The wizard discarded every term it collected.** `structureLine()` read the
  step-2 inputs with `document.getElementById`, but it ran at step 4 — by which
  point `paintWizard` had already replaced that markup, so every lookup returned
  null and the hardcoded fallbacks won. A slip entered at USD 77m and 1.25%
  saved as "Single risk · USD 8.00m SI" with a random premium. Terms are now
  captured into the draft on leaving step 2 (and on Back), and one
  `TERMS_SCHEMA` drives the form, the capture and the review summary so the
  three cannot drift apart again.
- **Premium was invented.** `saveDraft` assigned
  `1_500_000 + Math.random() * 4_000_000` regardless of the terms. It is now
  priced by `estimatedGrossPremium`, and a submission that cannot price itself
  carries nothing rather than a fabricated figure.
- **Password, email, tel and date inputs were unstyled.** The CSS selector
  listed only `text` and `number`, so those controls fell back to native
  browser styling — visibly a different size and shape from the fields beside
  them, on the sign-in form and throughout the registry forms.
- **Four-eyes could deadlock a placement.** With one authorised signatory, a
  slip that signatory prepared was unreleasable by anyone, forever. Fixed by
  adding a second signatory, and by naming the eligible approvers wherever the
  release is blocked.
- **The completed-step count was hardcoded.** The "Bound" card read "Step 5 of
  5" after the rail grew to six, so the card and the rail disagreed on every
  bound placement. It now derives from `LIFECYCLE_STEPS.length`.
- **"Sent for Confirmation" was a dead step.** It was overwritten inside the
  same call that set it, so it never appeared. Issuing a slip *is* sending it,
  so the two are now one step, "Slip Issued".
- **`canBind` accepted stale confirmations.** A program at `Renewal Due` still
  carries the confirmed panel from the *expiring* contract, and `canBind` only
  checked that every confirmation read "Confirmed" — so an expiring placement
  could be bound, raising an invoice for terms no market had agreed. `canBind`
  now excludes any status in which the placement is not in the market, and the
  drawer offers "Start renewal — re-issue slip" instead, which resets the panel
  to Sent.
