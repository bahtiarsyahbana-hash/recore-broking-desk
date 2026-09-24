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
- `lifecycle.js` — the placement state machine. Six Kanban stages
  (`LIFECYCLE_STEPS`: Intake, Draft Slip, Market Negotiation, Proposal Sent,
  Cedant Approved, Bound Issued) over eleven canonical statuses (`STATUS`), with
  `stageOf(program)` giving column, index and substatus badge. It keeps four
  things apart: market backup (`Backup Secured`, derived from confirmed lines)
  is not cedant approval; cedant approval (`Cedant Approved`, awaiting
  instruction) is not an instruction to bind (`Bind Instructed`, recorded with a
  reference); binding is a separate act; and the four-eyes release gate sits
  between Draft Slip and Placed to Market. `normaliseStatus` maps the statuses
  earlier versions wrote — Slip Issued → Placed to Market, Negotiating →
  Market Negotiation, Cedant Approval → Proposal Sent — on read, so seeded and
  historical records are never rewritten. The **operator guidance**
  (`nextAction`, `bindChecklist`) lives beside the rules so the two cannot
  drift; `stepIndexFor(status)` is the single source of truth for position.
- `panel.js` — the market panel as capacity. One vocabulary for a horizontal
  quota-share panel (`marketConfirmations`) and a layered excess-of-loss tower
  (`layers[].markets`, flattened into `marketConfirmations` with a `layer`
  index). `capacityUnits` yields one unit per slip or per layer, each of which
  must reach exactly 100% signed and 100% confirmed on its own; market response
  statuses (Sent → Reviewing → Quoted/Queried → Confirmed/Declined) and the
  moves a broker may record between them.
- `intake.js` — the intake queue rules: statuses Draft → Received → Under
  Review → Accepted / Revision Requested / Declined → Converted to Placement,
  readiness for acceptance, and `intakeToDraft`, the copy handed to the
  placement so the intake stays immutable. New placements are Quota Share or
  Excess of Loss only (`PLACEMENT_TYPES`); payment warranty is one of 15, 30,
  45, 60 or 90 days (`PAYMENT_WARRANTY_DAYS`).
- `treaty.js` — treaty administration. Agreements negotiated and bound outside
  Recordes are registered as master records (five types: Quota Share, Surplus,
  Per Risk XoL, Catastrophe XoL, Stop Loss; statuses Draft Setup → Active →
  Expiring / Run-off → Closed, moved only by explicit action). Per-type
  structure validation (every XoL layer checked on its own; stop-loss ratios
  ordered), panel rules (exactly 100% signed before activation),
  `activationChecklist` / `canActivate`, the expiry indicator, and validation
  for every workstream record — premium bordereau, claims bordereau, individual
  cession (only where the agreement requires declarations), technical account,
  settlement — each of which must reference an agreement that is not Closed.
  Calculations reuse `quota-share.js`, `surplus.js` and `xol.js`.
- `billing.js` — premium billing. Money flows cedant → broker → reinsurers, so
  one billing event produces a document to the cedant (Invoice; Debit or
  Credit Note for an endorsement; Credit Note when a treaty account favours the
  cedant) and a Closing Slip per reinsurer: its share of premium less
  commission, less brokerage (deducted from the remittance and kept by the
  broker), less any tax withheld. Amounts are integer cents split by largest
  remainder, so the batch always balances: cedant total = remittances +
  brokerage + taxes held. Custom tax and levy rules (nothing preset) choose
  their document by who bears them. Due date = basis date + payment warranty:
  the bound date for a placement, the endorsement date for an endorsement,
  the Agreed date for a treaty technical account. `issueAuthority` is the
  four-eyes rule: the preparer may not issue; the approver needs signing
  authority; an administrator's self-approval is recorded as an override.
- `portfolio.js` — book-level analytics: totals, premium by class, loss ratios,
  renewals due, and **concentration** — premium by cedant, exposure by
  reinsurer, and `concentration()`, which ranks any `{name: amount}` map into
  shares with the tail collapsed so the percentages still sum to 100
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
`releaseSlip` (place to market) → `recordMarketResponse` (one line at a time,
until Backup Secured is derived) → `recordProposalSent` → `recordCedantApproval`
or `recordCedantRevision` → `recordBindInstruction` → `executeBinding` →
`startRenewal`, which loops back to the top. `returnToDraft` sends a submission
back to its preparer; `reviseSlip` takes an in-market slip back to Draft as a
new slip version, resetting every response and invalidating any cedant approval
or bind instruction. A market response recorded after a proposal has gone to
the cedant marks that proposal stale, voids the approval and any instruction to
bind, and drops the placement back to the market stage the panel now supports;
restoring the capacity later does not revive them — a new proposal version and
a new approval are required. After "Cedant requested revision" the same terms
cannot go back as a new proposal: `revisionRequired` stays set until
`reviseSlip` has produced a new slip version. A slip cannot be submitted or
placed without an agreed payment warranty (`paymentWarrantyCheck`); the value is
never defaulted, and the period's start date is deliberately not modelled.
Nothing simulates a counterparty: a market's response is what a broker recorded. Every write appends to `program.history`
(actor, timestamp, action, notes, slip and proposal version). `executeBinding`
freezes the agreed terms in `boundTerms`, issues an RI Slip to the cedant and a
Binding Slip to each reinsurer (type, version, recipient, issue date, issuer,
delivery status), then raises the market invoice as before.

`treaty.service.js` is the only writer to `state.treaty`: `registerAgreement`
(unique agreement number; saved as Draft Setup, or activated when every gate
holds), `updateAgreement`, `activateAgreement`, `setAgreementStatus`,
documents and endorsements, the five workstream writers and `setRecordStatus`.
Every write appends to the agreement's audit trail. Treaty Engine does not
pass through Placement; `origin` is a nullable reference kept for future
integration. The former calculator page lives on as `ui/treaty-calculators.js`,
embedded under an agreement's Structure tab and prefilled from its terms.

`billing.service.js` is the only writer to `state.billing`. Binding a
placement, `recordEndorsement` on a bound placement, and a treaty technical
account moving to Agreed each create a **Draft** batch and nothing more — no
document number is consumed. The preparer sets commission and brokerage
explicitly and submits; a different authorised person approves, which
numbers every document in order (the cedant document, then each Closing Slip)
and freezes them. A correction is `raiseCancellation`: a reversing batch with
every line negated, issued under the same four-eyes, which marks the original
Cancelled only when it issues. The broker's own bank accounts live in
`state.billing.brokerAccounts` (Finance → Bank Accounts): one primary per
currency, purpose Collection, Remittance or Both. The primary active
collection account in a document's currency is copied onto every invoice and
debit note at issue, so editing an account later never changes a document
already sent; no other currency's account is ever substituted. A missing
collection account shows on the checklist as a warning, not a block.
Documents print through a hidden frame to the browser's print dialog
(`ui/print-document.js`) in one plain layout: the document title top left
and the broker's mark and name top right; number, issue and due dates, the
broker's legal name, address, postal code and email on the left and the
recipient in the same shape on the right; a Description / Tax / Amount /
Total table (`invoiceTable` moves each configured tax into the Tax column of
the line it is levied on); then Subtotal, Discount when there is one,
VAT / Tax and Amount due. The broker's details come from
`state.billing.brokerProfile` (Finance → Broker Profile) and, like the
recipient's registry details, are copied onto the document at issue. Invoices raised by the earlier
desk directly to reinsurers (`state.financeDocs`) stay readable as Legacy;
`finance.service.js` is no longer called.

`payments.service.js` is the only writer to `state.billing.receipts` and
`state.billing.remittances`. `recordReceipt` takes money received against an
issued invoice or debit note — in its currency, into a collection account,
never more than is outstanding — and splits it with `allocateReceipt`
(`domain/payments.js`): cumulatively, so each part-payment takes its share of
"paid so far" and the last one lands every Closing Slip, the brokerage and
the taxes held on their exact figures. Each share becomes a Draft remittance
to that reinsurer. A remittance is approved by a second authorised person
only when the reinsurer has an active account in that currency (copied onto
the record at approval), then marked Paid with the date, the broker's
remittance account and the bank reference. `reverseReceipt` cancels the
unpaid remittances drafted from it and is refused once one is paid; an
invoice with live receipts cannot be cancelled. When every invoice and debit
note billed to a placement is paid, `setPremiumPaid` releases the claims
credit-control hold. Remittances from treaty billing show in the agreement's
Settlements tab, and manual settlements are refused for those accounts.
Credit-note refunds to cedants are a later phase.

Drawers bind their click handlers to their own `.modal-backdrop` element, not
to the shared `#modal-root`: the element is replaced on every repaint and
removed on close, so one drawer's handlers never fire in another.

`intake.service.js` owns the broker intake queue. `createManualIntake` records
a request that arrived by email, phone, WhatsApp or meeting; `createPortalIntake`
is what the cedant portal's Submit a Risk now calls. `acceptIntake` freezes the
intake, creates a Draft Slip through `createDraftFromIntake` with a copy of the
data, and cross-references the two.

**Preparation and release are separate acts**, and that separation is the point.
A draft is internal bookkeeping; releasing a slip puts the firm's name in front
of the market. So `releaseSlip` is guarded by `slip-approval.js` and re-checks
every condition at the moment of release rather than trusting the submit step.

`registry.service.js` also owns the counterparty **profile**: `updateCounterparty`
edits the company profile (never the name), and `addPic` / `updatePic` /
`removePic` and `addBankAccount` / `updateBankAccount` / `removeBankAccount`
maintain the people in charge — several per division, one primary per
division — and the settlement accounts, one primary. The rules live in
`domain/counterparty-profile.js`, which also folds the earlier single-contact
fields into the PIC list on read so nothing is migrated. `ui/counterparty-detail.js`
is the drawer every registry row opens.

`registry.service.js` guards the one invariant the whole system rests on:
**counterparty names are unique across every category.** A program's `cedant`, a
market confirmation's `m` and a finance document's `counterparty` all point at a
registry entry by name and nothing else, so two counterparties sharing a name
would silently merge their placements, confirmations and invoices. The check is
case- and whitespace-insensitive and spans all five categories.

### `ui/` — shared presentation

`pagination.js` paginates every list in the app at ten rows a page. Two pure
functions plus a small state holder, so a 418-record registry and a four-row
claims table behave identically in code — the controls simply do not render
when everything already fits. A `name` scopes the controls to one pager,
because Reports has two paginated lists on one view and either set of buttons
would otherwise move both.

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

**A paginated list:** slice with `paginate()`, render
`paginationControls(page, { unit, name })` beneath, and keep a `createPager()`
whose callback re-runs the view's `refresh`. Reset it whenever a filter changes
the list — page 7 of the old results means nothing once the filter moves. Where
a row's action carries its index, pair each item with its real index *before*
slicing: the claims table dispatches on it.

**A new field on an existing category:** add it to that category's schema in
`views/broker/registry-fields.js`. It renders, validates and saves with no other
change. Give it a `section` to put it in a collapsible optional block, and a
`validate` function for its own rule. See
[COUNTERPARTY-FIELDS.md](COUNTERPARTY-FIELDS.md) for what each field is for and
why it is required or optional.

## Where registry data lives

Two sources, merged by `register()` in `core/store.js`:

- `data/counterparties.data.js` — the **demo book**: the handful of fictional
  counterparties that the placements, claims and finance documents refer to by
  name. Small and hand-maintained.
- `data/reference.data.js` — **651 imported records** from the reference
  workbook: 408 SEA cedants, 123 reinsurers, 44 Lloyd's syndicates, 52 broking
  partners, 24 captives. Generated by `scripts/import/`, never hand-edited.

The demo entries are listed first and win any name clash, so an import can
never displace a counterparty the book depends on. Everything is then sorted
alphabetically, because at this volume the registry is a directory and
directories are read by searching.

Imported cedants carry `kyc: "Not assessed"` — a third state beside Current and
Review due. Nobody has onboarded them, and a status of Current would be a
fabricated compliance position, so the release gate correctly refuses to place
for them.

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

- **The submission wizard did not survive the import.** Step 3 rendered one
  number input per market, which was fine for six and unusable for 182, and the
  cedant step was a 418-option `<select>`. Both are now search-driven: markets
  are found and added to the slip, and the cedant is a validated type-ahead that
  refuses a name the registry does not hold.
- **The accumulation report showed invented numbers.** `committedCapacity` was
  a stored map with no relationship to the placements, so the report overstated
  Helvetia 7x, understated Andean 2x, and gave capacity to nine markets that
  carried no placement at all. Exposure is now derived from the lines actually
  signed (`exposureByReinsurer`), and the stored figure is kept — renamed
  `capacityLines` — as what it honestly is: the line a market has agreed to
  make available, which makes utilisation computable. Two markets turn out to
  be over their agreed line.
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
