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
import { statusPill, emptyState, codeBadge } from "../../ui/badges.js";
import { picsOf, bankAccountsOf } from "../../domain/counterparty-profile.js";
import { icons } from "../../ui/icons.js";
import { openFormModal } from "../../ui/form-modal.js";
import { paginate, paginationControls, createPager } from "../../ui/pagination.js";
import { addCounterparty, validateCounterparty } from "../../services/registry.service.js";
import { openCounterpartyDetail } from "../../ui/counterparty-detail.js";
import { openProgramDetail } from "../../ui/program-detail.js";
import { showView } from "../../core/router.js";

/**
 * @typedef {object} RegistryCategory
 * @property {string} id       view id, matching its nav entry
 * @property {string} title    page heading
 * @property {string} intro    one line saying what this category is
 * @property {string} unit     noun for the record count, e.g. "cedants"
 * @property {string} addLabel button label
 * @property {string} formNote banner shown above the form
 * @property {() => object[]} entries  the records, read at refresh time
 * @property {RegistryColumn[]} columns  the category's own table columns, between
 *           the shared Name column and the shared PIC / Profile columns
 */

/**
 * @typedef {object} RegistryColumn
 * @property {string} label
 * @property {(entry: object) => string} cell  markup for one cell
 * @property {boolean} [num]  right-aligned numeric column
 */

/* ---------- shared cells ---------- */

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const dash = '<span class="muted">—</span>';
const text = (key) => (e) => (e[key] ? esc(e[key]) : dash);

/** Primary person in charge: the structured PIC list, falling back to legacy contact fields. */
function primaryPic(e) {
  const pics = picsOf(e);
  if (!pics.length) return dash;
  const p = pics.find((x) => x.primary) || pics[0];
  const more = pics.length > 1 ? ` <span class="reg-more">+${pics.length - 1}</span>` : "";
  return `<div class="reg-pic">${esc(p.name)}${more}</div>${p.email ? `<a class="reg-pic-mail" href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : p.division ? `<div class="reg-pic-mail">${esc(p.division)}</div>` : ""}`;
}

/** How complete the record is: PICs and bank accounts on file. */
function profileCell(e) {
  const pics = picsOf(e).length;
  const banks = bankAccountsOf(e).length;
  const tag = (n, one, many) => `<span class="reg-count${n ? "" : " is-zero"}">${n} ${n === 1 ? one : many}</span>`;
  return `${tag(pics, "PIC", "PICs")} ${tag(banks, "bank", "banks")}`;
}

const nameCell = (e) => `<div class="reg-name">${esc(e.name)}</div>${codeBadge(e)}`;

/** @type {RegistryCategory[]} */
export const REGISTRY_CATEGORIES = [
  {
    id: "reg-cedants",
    title: "Cedants",
    intro: "Insurers ceding business to the desk.",
    unit: "cedants",
    addLabel: "Add Cedant",
    formNote: "A new cedant becomes selectable on the submission wizard straight away. KYC must be current before any placement for them can bind.",
    entries: () => state.cedants,
    columns: [
      { label: "Country", cell: text("country") },
      { label: "Licence", cell: text("licenceCategory") },
      // "Current" reads as good; "Review due" warns; "Not assessed" is neutral
      // — imported records have simply never been onboarded.
      { label: "KYC", cell: (c) => statusPill(c.kyc === "Current" ? "Active" : c.kyc) },
      { label: "KYC refreshed", cell: text("refreshed") },
    ],
  },
  {
    id: "reg-reinsurance",
    title: "Reinsurance",
    intro: "Company-form reinsurers signing lines on the desk's slips.",
    unit: "reinsurers",
    addLabel: "Add Reinsurer",
    formNote: "A new reinsurer joins the capacity panel in the submission wizard and the accumulation report immediately, with nil committed capacity until it signs a line.",
    entries: reinsuranceCompanies,
    columns: [
      { label: "Country", cell: text("country") },
      { label: "Panel", cell: text("panel") },
      { label: "Security", cell: text("rating") },
      { label: "Collateral", cell: (m) => (m.collateral && m.collateral !== "None — unsecured" ? esc(m.collateral) : dash) },
    ],
  },
  {
    id: "reg-syndicates",
    title: "Lloyd's Syndicates",
    intro: "Capacity written through Lloyd's, by syndicate.",
    unit: "syndicates",
    addLabel: "Add Syndicate",
    formNote: "Name the syndicate as it is written on a slip — managing agent and number, e.g. \"Marlow Underwriting · Syndicate 1918\".",
    entries: lloydsSyndicates,
    columns: [
      { label: "Syndicate", cell: (m) => (m.syndicateNo ? `<span class="mono">${esc(m.syndicateNo)}</span>` : dash) },
      { label: "Managing agent", cell: text("managingAgent") },
      { label: "Panel", cell: text("panel") },
      { label: "Security", cell: text("rating") },
    ],
  },
  {
    id: "reg-brokers",
    title: "Reinsurance Brokers",
    intro: "Co-broking partners who share brokerage, not risk.",
    unit: "broking partners",
    addLabel: "Add Broking Partner",
    formNote: "Broking partners share commission, not risk. They are never offered as capacity on the submission wizard's market panel.",
    entries: () => state.brokers,
    columns: [
      { label: "Country", cell: text("country") },
      { label: "Role", cell: text("role") },
      { label: "Split", cell: (b) => (b.commissionSplit != null && b.commissionSplit !== "" ? `${esc(b.commissionSplit)}%` : dash), num: true },
      { label: "Status", cell: (b) => (b.status ? statusPill(b.status) : dash) },
    ],
  },
  {
    id: "reg-others",
    title: "Others",
    intro: "Service counterparties outside the underwriting panel.",
    unit: "counterparties",
    addLabel: "Add Counterparty",
    formNote: "Service counterparties sit outside the underwriting panel entirely — they take no line and share no brokerage.",
    entries: () => state.others,
    columns: [
      { label: "Country", cell: text("country") },
      { label: "Role", cell: text("role") },
      { label: "Status", cell: (o) => (o.status ? statusPill(o.status) : dash) },
    ],
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

/** The category's records as a table: Name, its own columns, then PIC and Profile. */
function registryTable(category, items) {
  const heads = ["Name", ...category.columns.map((c) => c.label), "Primary PIC", "Profile", ""];
  const numAt = new Set(category.columns.flatMap((c, i) => (c.num ? [i + 1] : [])));
  const row = (e) => `<tr class="reg-tr" data-action="open-entry" data-name="${esc(e.name)}" tabindex="0" aria-label="Open ${esc(e.name)}">
    <td class="reg-td-name">${nameCell(e)}</td>
    ${category.columns.map((c) => `<td${c.num ? ' class="num"' : ""}>${c.cell(e)}</td>`).join("")}
    <td class="reg-td-pic">${primaryPic(e)}</td>
    <td class="reg-td-profile">${profileCell(e)}</td>
    <td class="reg-td-open"><span class="reg-open" aria-hidden="true">Manage →</span></td>
  </tr>`;
  return `<div class="table-wrap reg-table"><table>
    <thead><tr>${heads.map((h, i) => `<th${numAt.has(i) ? ' class="num"' : ""}>${h}</th>`).join("")}</tr></thead>
    <tbody>${items.map(row).join("")}</tbody>
  </table></div>`;
}

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
      onSubmit: (values) => {
        const stored = addCounterparty(category.id, { ...values, ...fixed });
        // Straight into the record, so bank details and PICs can be added now.
        openEntry(stored.name);
      },
    });
  }

  const openEntry = (name) => openCounterpartyDetail(name, (programId) => { showView("placements"); openProgramDetail(programId); });

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
      onAction("#view-root", {
        add: openAddForm,
        "open-entry": ({ name }, trigger, e) => {
          // A mailto link inside the row is a link, not an open.
          if (e?.target?.closest("a")) return;
          openEntry(name);
        },
      });
      $("#view-root")?.addEventListener("keydown", (e) => {
        const t = e.target.closest?.("[data-action='open-entry']");
        if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openEntry(t.dataset.name); }
      });
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
        ? registryTable(category, page.items)
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
