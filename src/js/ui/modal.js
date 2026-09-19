/**
 * Modal host. Overlays render into #modal-root; only one is open at a time.
 * Escape and a backdrop click close whatever is open.
 */
import { $ } from "../core/dom.js";

let onClose = null;

/** Open an overlay with the given markup. `handler` runs after it is in the DOM. */
export function openModal(html, { onMount, onDismiss } = {}) {
  const root = $("#modal-root");
  root.innerHTML = html;
  onClose = onDismiss || null;
  onMount?.(root);
}

/** Replace the open overlay's markup in place, keeping it open. */
export function updateModal(html, { onMount } = {}) {
  const root = $("#modal-root");
  root.innerHTML = html;
  onMount?.(root);
}

export function closeModal() {
  $("#modal-root").innerHTML = "";
  onClose?.();
  onClose = null;
}

export const isModalOpen = () => $("#modal-root").children.length > 0;

/** Wired once at boot. */
export function initModalHost() {
  const root = $("#modal-root");
  root.addEventListener("click", (e) => {
    if (e.target === root.firstElementChild || e.target.closest("[data-action='close-modal']")) {
      closeModal();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isModalOpen()) closeModal();
  });
}

/** Standard overlay chrome. */
export function modalShell({ title, subtitle, body, footer = "", maxWidth }) {
  return `<div class="modal-backdrop">
    <div class="modal"${maxWidth ? ` style="max-width:${maxWidth};"` : ""}>
      <div class="modal-head">
        <div>
          <div class="panel-title" style="margin:0;">${title}</div>
          <div class="panel-sub" style="margin:2px 0 0;">${subtitle || ""}</div>
        </div>
        <button class="close-x" data-action="close-modal">✕</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ""}
    </div>
  </div>`;
}
