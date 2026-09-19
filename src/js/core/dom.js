/**
 * Thin DOM helpers. Kept deliberately small — the app builds markup with
 * template strings and mounts it, rather than pulling in a framework.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Create an element with an optional class and innerHTML. */
export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

/** A label/value line inside a `.calc-out` block. */
export function row(label, value) {
  return `<div class="row"><span>${label}</span><span>${value}</span></div>`;
}

/** Replace a container's contents with `html`. */
export function mount(target, html) {
  const node = typeof target === "string" ? $(target) : target;
  if (node) node.innerHTML = html;
  return node;
}

/**
 * Delegated click handling. Components mark buttons with `data-action` and
 * optional `data-*` payload; this wires one listener per container instead of
 * inline `onclick` attributes and global window functions.
 */
export function onAction(root, handlers) {
  const node = typeof root === "string" ? $(root) : root;
  if (!node) return;
  node.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-action]");
    if (!trigger || !node.contains(trigger)) return;
    const handler = handlers[trigger.dataset.action];
    if (handler) handler(trigger.dataset, trigger, e);
  });
}

/** Wire an `input` listener onto each id in the list. */
export function onInput(ids, handler) {
  ids.forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.addEventListener("input", handler);
  });
}

/** Read a numeric input by id, with a fallback when empty or invalid. */
export function numVal(id, fallback = 0) {
  const node = document.getElementById(id);
  return node ? (+node.value || fallback) : fallback;
}
