# Counterparty fields — what to capture, and why

The registry add-forms are not a guess at what might be useful. Each field
traces to one of three things: a regulatory return that demands it, a
credit-for-reinsurance rule that turns on it, or a step in running a placement
that fails without it.

Required fields are deliberately few. A registry whose form demands thirty
fields gets filled with thirty blanks; the optional fields sit in collapsible
sections and get completed over time.

## Sources

| Source | What it settles |
|---|---|
| [PRA IR.31.01 — Outwards reinsurance balance sheet exposures](https://www.bankofengland.co.uk/-/media/boe/files/prudential-regulation/regulatory-reporting/insurance/ir3101-instructions-outwards-reinsurance-balance-sheet-exposures-29-02-2024.pdf) | The counterparty code and its priority order; recognised counterparty forms; collateral categories |
| [Solvency II S.31.01 — Share of reinsurers](https://www.bankofengland.co.uk/prudential-regulation/publication/2022/november/review-solvency-ii-reporting-phase-2) | Type-of-code list (LEI / specific code), credit quality step |
| [GLEIF — ISO 17442 LEI structure](https://www.gleif.org/en/about-lei/iso-17442-the-lei-code-structure) | LEI format and check digits |
| [NAIC — Credit for Reinsurance](https://content.naic.org/insurance-topics/reinsurance) and [RAA on certified reinsurers](https://www.reinsurance.org/RAA/RAA/Advocacy/Credit-for-Reinsurance-Certified-Reinsurers.aspx) | Why domicile and collateral status are required, not cosmetic |
| [OSFI — Sound Reinsurance Practices and Procedures (2025)](https://www.osfi-bsif.gc.ca/en/guidance/guidance-library/sound-reinsurance-practices-procedures-guideline-2025) | Heightened due diligence on unregistered reinsurers and unregulated cedants |
| [Moody's — Insurance KYC and customer due diligence](https://www.moodys.com/web/en/us/kyc/resources/insights/insurance-kyc-and-aml-requirements-and-customer-due-diligence.html) | KYC status, refresh cadence, screening |
| [Guy Carpenter — reinsurance broking](https://www.guycarp.com/solutions/capabilities/reinsurance-broking.html) | Placement, claims and technical accounting are separate functions with separate contacts |

## The counterparty code

The PRA return identifies every reinsurer by a single code, in a strict priority
order, and this is the rule the forms are built around:

1. **LEI** — ISO 17442, 20 alphanumeric characters, reported as `LEI/…`
2. **Lloyd's Syndicate Code** — 4 numeric, reported as `LSY/…`, and it **takes
   priority over an LEI** when the counterparty is a syndicate
3. **Specific code** — assigned internally, only when neither of the above exists

That is why the Lloyd's page makes the syndicate number **required** while every
other page treats the LEI as optional-but-validated, and why a syndicate's row
badge shows `LSY/4242` rather than its LEI.

The LEI is checksum-validated (ISO 7064 MOD 97-10), not merely length-checked. A
mistyped LEI is worse than a blank one, because it will be reported as though it
were real.

## Required vs optional, by category

Required means the desk cannot transact without it. Everything else is optional.

| Category | Required | Optional |
|---|---|---|
| **Cedants** | Legal name, country of domicile, KYC status, KYC last refreshed | LEI · PIC (name, title, phone, email, address) · claims contact · technical accounting contact · settlement currency · payment terms · home regulator · licence number · notes |
| **Reinsurance** | Legal name, country of domicile, security rating, panel | LEI · PIC · claims & accounting contacts · settlement currency · payment terms · counterparty form · collateral held · rating as at · notes |
| **Lloyd's Syndicates** | Legal name, **syndicate number** | Managing agent · security rating · panel · PIC · claims & accounting contacts · settlement · rating as at · notes |
| **Reinsurance Brokers** | Legal name, country of domicile, role, status | Default commission split % · LEI · PIC · settlement · home regulator · broking licence · notes |
| **Others** | Legal name, country of domicile, role, status | PIC · settlement · notes |

### Why these are required

- **Legal name** — the referential key. A program's `cedant`, a market
  confirmation's `m` and a finance document's `counterparty` all point at a
  registry entry by name and nothing else.
- **Country of domicile** — drives regulatory treatment. Under NAIC credit for
  reinsurance, whether a reinsurer sits in a Qualified or Reciprocal
  Jurisdiction determines how much collateral it must post; OSFI expects
  heightened diligence on counterparties outside its regime.
- **KYC status and refresh date** — a cedant whose KYC is stale can be quoted
  but not bound, so the date is not decoration.
- **Security rating and panel** — a market's rating decides which panel it is
  eligible for. Without them a market cannot be offered capacity.
- **Syndicate number** — the counterparty code itself, for a syndicate.

### Why contacts are split three ways

A reinsurance counterparty does not have "a contact". Placement, claims and
technical accounting are handled by different desks, and a broker holding only
the underwriter's address cannot chase a claim or a settlement. The forms
therefore capture a **primary contact (PIC)** plus optional **claims** and
**technical accounting** contacts.

Emails are format-validated and rendered as `mailto:` links on the registry row,
because the reason to hold the address is to use it.

## Validation

| Rule | Where | Behaviour |
|---|---|---|
| Required fields | form layer | Blocks submit, names the field |
| LEI checksum | `domain/counterparty.js` | ISO 7064 MOD 97-10 |
| Syndicate number | `domain/counterparty.js` | Exactly four digits |
| Email / phone format | `domain/counterparty.js` | Deliberately permissive |
| Commission split range | field schema | 0–100 |
| **Name unique across all categories** | `services/registry.service.js` | Case- and whitespace-insensitive |
| **LEI unique** | `services/registry.service.js` | One LEI identifies one legal entity |
| **Syndicate number unique** | `services/registry.service.js` | Names the existing holder |

A rejected form stays open with everything already typed, and any collapsed
section holding an error is opened automatically.

## Not captured, and why

- **Bank account / settlement instructions.** Deliberately omitted. Payment
  details are the highest-value target in a broking system and belong behind
  separate authorisation and an audit trail, not on an open add-form.
- **Beneficial ownership and sanctions screening results.** Real KYC obligations,
  but they are the output of a screening process, not something typed into a
  form. They belong to a compliance module with its own evidence trail.
- **Credit quality step.** Derived from the rating rather than entered, so it is
  a calculation the accounting layer should own.
