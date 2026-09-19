/**
 * Registry — the counterparty address book behind every submission.
 *
 * Each category is its own page, because the categories are not
 * interchangeable: what a counterparty may do on a slip depends on which one
 * it sits in. A cedant cedes risk, a reinsurer signs a line, a Lloyd's
 * syndicate signs through the market, a co-broker shares commission without
 * taking any risk, and "others" never appears on the underwriting panel at all.
 *
 * The pages differ only in their records, how a row reads and what a new entry
 * must supply, so they are built from one definition list through a shared
 * factory. Adding a category means adding an entry to REGISTRY_CATEGORIES and a
 * nav entry in core/navigation.js.
 */
import { $, mount, onAction } from "../../core/dom.js";
import { on, TOPICS } from "../../core/events.js";
import { state, reinsuranceCompanies, lloydsSyndicates, allCounterparties } from "../../core/store.js";
import { fieldsFor } from "./registry-fields.js";
import { registryRow, statusPill, emptyState, contactLine, codeBadge } from "../../ui/badges.js";
import { icons } from "../../ui/icons.js";
import { openFormModal } from "../../ui/form-modal.js";
import { paginate, paginationControls, createPager } from "../../ui/pagination.js";
import { addCounterparty, validateCounterparty } from "../../services/registry.service.js";

/**
 * @typedef {object} RegistryCategory
 * @property {string} id       view id, matching its nav entry
 * @property {string} title    page heading
 * @property {string} intro    what this category is, and why it is separate
 * @property {string} unit     noun for the record count, e.g. "cedants"
 * @property {string} addLabel button label
 * @property {string} formNote banner shown above the form
 * @property {() => object[]} entries  the records, read at refresh time
 * @property {(entry: object) => string} row  one row's markup
 */

/** @type {RegistryCategory[]} */
export const REGISTRY_CATEGORIES = [
  {
    id: "reg-cedants",
    title: "Cedants",
    intro: "Insurers ceding business to the desk. KYC status governs whether a new risk may be accepted from them — a counterparty due for review can still be quoted, but not bound.",
    unit: "cedants",
    addLabel: "Add Cedant",
    formNote: "A new cedant becomes selectable on the submission wizard straight away. KYC must be current before any placement for them can bind.",
    entries: () => state.cedants,
    // KYC state reuses the shared status vocabulary rather than inventing tones.
    row: (c) => registryRow(
      c.name,
      [c.country, c.licenceCategory, c.refreshed ? `KYC refreshed ${c.refreshed}` : null]
        .filter(Boolean).join(" · "),
      // "Current" reads as good; "Review due" warns; "Not assessed" is neutral
      // — imported records have simply never been onboarded.
      statusPill(c.kyc === "Current" ? "Active" : c.kyc) + codeBadge(c),
      contactLine(c),
    ),
  },
  {
    id: "reg-reinsurance",
    title: "Reinsurance",
    intro: "Company-form reinsurers who sign lines on the desk's slips. Security rating drives which panel a market is eligible for.",
    unit: "reinsurers",
    addLabel: "Add Reinsurer",
    formNote: "A new reinsurer joins the capacity panel in the submission wizard and the accumulation report immediately, with nil committed capacity until it signs a line.",
    entries: reinsuranceCompanies,
    row: (m) => registryRow(
      m.name,
      `${m.panel} · security ${m.rating}${m.collateral && m.collateral !== "None — unsecured" ? ` · ${m.collateral}` : ""}`,
      codeBadge(m),
      contactLine(m),
    ),
  },
  {
    id: "reg-syndicates",
    title: "Lloyd's Syndicates",
    intro: "Capacity written through Lloyd's, by syndicate. Signed the same way as company-form capacity, but ranked and reported separately.",
    unit: "syndicates",
    addLabel: "Add Syndicate",
    formNote: "Name the syndicate as it is written on a slip — managing agent and number, e.g. \"Marlow Underwriting · Syndicate 1918\".",
    entries: lloydsSyndicates,
    row: (m) => registryRow(
      m.name,
      `${m.panel} · security ${m.rating}${m.managingAgent ? ` · ${m.managingAgent}` : ""}`,
      codeBadge(m),
      contactLine(m),
    ),
  },
  {
    id: "reg-brokers",
    title: "Reinsurance Brokers",
    intro: "Co-broking and local placement partners. They share brokerage on a slip rather than take a signed line, so they carry no risk and never appear on the market panel.",
    unit: "broking partners",
    addLabel: "Add Broking Partner",
    formNote: "Broking partners share commission, not risk. They are never offered as capacity on the submission wizard's market panel.",
    entries: () => state.brokers,
    row: (b) => registryRow(
      b.name,
      `${b.country} · ${b.role}${b.commissionSplit ? ` · ${b.commissionSplit}% split` : ""}`,
      statusPill(b.status) + codeBadge(b),
      contactLine(b),
    ),
  },
  {
    id: "reg-others",
    title: "Others",
    intro: "Service counterparties outside the underwriting panel — claims TPAs, catastrophe modeling, actuarial advisers and captive vehicles.",
    unit: "counterparties",
    addLabel: "Add Counterparty",
    formNote: "Service counterparties sit outside the underwriting panel entirely — they take no line and share no brokerage.",
    entries: () => state.others,
    row: (o) => registryRow(
      o.name,
      `${o.country} · ${o.role}`,
      statusPill(o.status),
      contactLine(o),
    ),
  },
];

/**
 * Build a registry page from its category definition.
 * @param {RegistryCategory} category
 */
/**
 * Everything on a record that a person might search by. Built from the values
 * rather than a named list, so a field added to the schema is searchable
 * without anyone remembering to update this.
 */
const searchText = (entry) => Object.values(entry)
  .filter((v) => typeof v === "string")
  .join(" ")
  .toLowerCase();

export function createRegistryView(category) {
  /** Reset per mount, so switching pages does not carry a stale filter. */
  let query = "";
  const pager = createPager(() => view.refresh());
  /** Countries already on the registry, offered as type-ahead suggestions so
   *  the book does not drift into "USA" and "United States" as two places. */
  const knownCountries = () =>
    [...new Set(allCounterparties().map((c) => c.country).filter(Boolean))].sort();

  function openAddForm() {
    const schema = fieldsFor(category.id, knownCountries());
    // Hidden fields carry fixed values through to the record untouched.
    const fixed = Object.fromEntries(
      schema.filter((f) => f.type === "hidden").map((f) => [f.name, f.value]),
    );

    openFormModal({
      title: category.addLabel,
      subtitle: `New entry on the ${category.title} registry`,
      intro: category.formNote,
      fields: schema,
      submitLabel: category.addLabel,
      // Field-level rules run first; this is the cross-record uniqueness check.
      validate: (values) => validateCounterparty(category.id, values),
      onSubmit: (values) => addCounterparty(category.id, { ...values, ...fixed }),
    });
  }

  const view = {
    id: category.id,

    render: () => `<section class="view">
      <div class="view-head">
        <div>
          <h1>${category.title}</h1>
          <p>${category.intro}</p>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="chip" id="${category.id}-count"></span>
          <button class="btn primary" data-action="add">${icons.plus}${category.addLabel}</button>
        </div>
      </div>
      <div class="toolbar">
        <input type="search" class="reg-search" id="${category.id}-search"
          placeholder="Search ${category.unit} by name, country or role"
          aria-label="Search ${category.title}">
      </div>
      <div class="reg-page" id="${category.id}-list"></div>
    </section>`,

    mount() {
      onAction("#view-root", { add: openAddForm });
      query = "";
      pager.reset();
      pager.wire("#view-root");
      $(`#${category.id}-search`)?.addEventListener("input", (e) => {
        query = e.target.value.trim().toLowerCase();
        // A narrowed list starts again at the top; page 7 of the old results
        // means nothing once the filter changes.
        pager.reset();
        view.refresh();
      });
    },

    refresh() {
      const all = category.entries();
      const terms = query.split(/\s+/).filter(Boolean);
      // Every term must appear somewhere, so "re indonesia" narrows rather
      // than widening the way a match-any search would.
      const shown = terms.length
        ? all.filter((e) => { const hay = searchText(e); return terms.every((t) => hay.includes(t)); })
        : all;

      const page = paginate(shown, pager.page);

      mount(`#${category.id}-list`, shown.length
        ? `<div class="reg-list">${page.items.map(category.row).join("")}</div>`
          + paginationControls(page, { unit: category.unit })
        : emptyState(terms.length
            ? `No ${category.unit} match "${query}".`
            : `No ${category.unit} on file yet.`));

      mount(`#${category.id}-count`, terms.length
        ? `${shown.length} of ${all.length} ${category.unit}`
        : `${all.length} ${category.unit}`);
    },
  };

  // Repaint when this page is on screen and the registry changes.
  on(TOPICS.REGISTRY, () => {
    if (document.getElementById(`${category.id}-list`)) view.refresh();
  });

  return view;
}

/** One view per category, in sidebar order. */
export const registryViews = REGISTRY_CATEGORIES.map(createRegistryView);
