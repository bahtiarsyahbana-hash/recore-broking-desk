/**
 * Schema-driven form modal.
 *
 * Give it a list of field definitions and it renders the form, collects the
 * values, validates and shows per-field errors **without closing** — a rejected
 * entry keeps everything already typed.
 *
 * Fields carrying a `section` are grouped into a collapsible block beneath the
 * always-visible ones. That split is the point: a counterparty cannot be
 * created without its identity, but its contacts and settlement terms are
 * things a desk fills in over time, and burying the required fields inside a
 * thirty-field wall is how registries end up full of blanks.
 *
 * Field definition:
 *   { name, label, type: "text"|"email"|"tel"|"select"|"date"|"number"|"textarea"|"hidden",
 *     required?, value?, placeholder?, hint?, options?, suggestions?,
 *     half?, section?, validate?: (value, allValues) => string | null }
 */
import { $, $$ } from "../core/dom.js";
import { openModal, updateModal, closeModal } from "./modal.js";

const esc = (v) => String(v ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const isHidden = (f) => f.type === "hidden";

function control(field, value) {
  const id = `f-${field.name}`;
  const listId = field.suggestions ? `${id}-options` : null;
  const datalist = listId
    ? `<datalist id="${listId}">${field.suggestions.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>`
    : "";

  switch (field.type) {
    case "select":
      return `<select id="${id}" name="${field.name}">${
        field.options.map((o) => `<option${o === value ? " selected" : ""}>${esc(o)}</option>`).join("")
      }</select>`;
    case "textarea":
      return `<textarea id="${id}" name="${field.name}" rows="${field.rows || 2}" placeholder="${esc(field.placeholder)}">${esc(value)}</textarea>`;
    default:
      return `<input type="${field.type || "text"}" id="${id}" name="${field.name}" value="${esc(value)}"
        placeholder="${esc(field.placeholder)}"${listId ? ` list="${listId}" autocomplete="off"` : ""}>${datalist}`;
  }
}

function fieldBlock(field, values, errors) {
  const error = errors[field.name];
  return `<div class="field${error ? " has-error" : ""}">
    <label for="f-${field.name}">${esc(field.label)}${field.required ? '<span class="req" aria-hidden="true"> *</span>' : ""}</label>
    ${control(field, values[field.name] ?? field.value ?? "")}
    ${error ? `<div class="field-error" role="alert">${esc(error)}</div>`
            : field.hint ? `<div class="hint">${esc(field.hint)}</div>` : ""}
  </div>`;
}

/** Consecutive `half` fields are paired into a two-column row. */
function rows(fields, values, errors) {
  const out = [];
  for (let i = 0; i < fields.length; i++) {
    if (fields[i].half && fields[i + 1]?.half) {
      out.push(`<div class="field-row">${fieldBlock(fields[i], values, errors)}${fieldBlock(fields[i + 1], values, errors)}</div>`);
      i++;
    } else {
      out.push(fieldBlock(fields[i], values, errors));
    }
  }
  return out.join("");
}

/** Group by `section`, preserving definition order; undefined section first. */
function sectioned(fields, values, errors) {
  const groups = new Map();
  fields.filter((f) => !isHidden(f)).forEach((f) => {
    const key = f.section || "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  });

  return [...groups.entries()].map(([name, group]) => {
    if (!name) return rows(group, values, errors);
    // Opened automatically when something inside it needs attention.
    const hasError = group.some((f) => errors[f.name]);
    // Count only what the operator actually changed — a select sitting on its
    // default has a value, but nobody filled it in.
    const filled = group.filter((f) => {
      const value = String(values[f.name] ?? "").trim();
      return value && value !== String(f.value ?? "");
    }).length;
    return `<details class="form-section"${hasError ? " open" : ""}>
      <summary>
        <span>${esc(name)}</span>
        <span class="form-section-note">${filled ? `${filled} filled` : "optional"}</span>
      </summary>
      <div class="form-section-body">${rows(group, values, errors)}</div>
    </details>`;
  }).join("");
}

/**
 * Run required checks, then each field's own validator. A field's validator
 * only sees a non-empty value — an optional field left blank is always valid.
 */
export function validateFields(fields, values) {
  const errors = {};
  fields.filter((f) => !isHidden(f)).forEach((field) => {
    const value = String(values[field.name] ?? "").trim();
    if (field.required && !value) {
      errors[field.name] = `${field.label} is required.`;
      return;
    }
    if (!value) return;
    const message = field.validate?.(value, values);
    if (message) errors[field.name] = message;
  });
  return errors;
}

/**
 * Open a form.
 *
 * @param {object} config
 * @param {string} config.title
 * @param {string} [config.subtitle]
 * @param {string} [config.intro]  a banner above the fields
 * @param {object[]} config.fields
 * @param {string} [config.submitLabel]
 * @param {(values:object) => Record<string,string>} [config.validate] extra,
 *        cross-field validation run after the per-field checks pass
 * @param {(values:object) => void} config.onSubmit  called only when valid
 */
export function openFormModal({
  title, subtitle, intro, fields,
  submitLabel = "Save", validate, onSubmit,
}) {
  let values = Object.fromEntries(fields.map((f) => [f.name, f.value ?? ""]));
  let errors = {};

  const shell = () => `<div class="modal-backdrop">
    <div class="modal" style="max-width:580px;">
      <div class="modal-head">
        <div>
          <div class="panel-title" style="margin:0;">${esc(title)}</div>
          <div class="panel-sub" style="margin:2px 0 0;">${esc(subtitle || "")}</div>
        </div>
        <button class="close-x" data-action="close-modal" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        ${intro ? `<div class="banner">${intro}</div>` : ""}
        <form id="entity-form" novalidate>${sectioned(fields, values, errors)}</form>
      </div>
      <div class="modal-foot">
        <div class="hint">${fields.some((f) => f.required) ? "* required" : ""}</div>
        <div style="display:flex; gap:8px;">
          <button class="btn" data-action="close-modal">Cancel</button>
          <button class="btn primary" data-form="submit">${esc(submitLabel)}</button>
        </div>
      </div>
    </div>
  </div>`;

  /** Read the live DOM rather than trusting the last keystroke event. */
  function readForm() {
    const form = $("#entity-form");
    if (!form) return values;
    fields.forEach((f) => {
      const control = form.elements[f.name];
      if (control) values[f.name] = control.value;
    });
    return values;
  }

  function submit() {
    const entered = readForm();
    errors = validateFields(fields, entered);
    if (!Object.keys(errors).length && validate) errors = validate(entered);

    if (Object.keys(errors).length) {
      repaint();
      $$(".field.has-error input, .field.has-error select, .field.has-error textarea")[0]?.focus();
      return;
    }
    closeModal();
    onSubmit(entered);
  }

  function wire() {
    $("[data-form='submit']").addEventListener("click", submit);

    const form = $("#entity-form");
    form.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
        e.preventDefault();
        submit();
      }
    });
    // Clear a field's error as soon as it is edited.
    form.addEventListener("input", (e) => {
      if (!errors[e.target.name]) return;
      delete errors[e.target.name];
      const field = e.target.closest(".field");
      field?.classList.remove("has-error");
      field?.querySelector(".field-error")?.remove();
    });

    form.querySelector("input, select, textarea")?.focus();
  }

  const repaint = () => updateModal(shell(), { onMount: wire });

  openModal(shell(), { onMount: wire });
}
