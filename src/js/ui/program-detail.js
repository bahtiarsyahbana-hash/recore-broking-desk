/**
 * Program lifecycle drawer — where a placement is walked from slip to bind.
 *
 * The drawer answers three questions in order, top to bottom:
 *   1. Where is this placement?      — the journey rail
 *   2. What do I do next, and why?   — the next-action card, with the button
 *   3. What is still holding it up?  — the bind checklist
 *
 * All of that reasoning comes from domain/lifecycle.js, so the guidance can
 * never drift from the rules that actually govern the transitions. The drawer
 * only reads state and paints; every action delegates to placement.service.js.
 */
import { $, onAction } from "../core/dom.js";
import { programById, currentUser, cedantNamed } from "../core/store.js";
import { statusPill } from "./badges.js";
import { icons } from "./icons.js";
import { openModal, updateModal, closeModal } from "./modal.js";
import {
  LIFECYCLE_STEPS, stepIndexFor, confirmationProgress,
  nextAction, bindChecklist, isPreMarket,
} from "../domain/lifecycle.js";
import { releaseChecklist, signedLines } from "../domain/slip-approval.js";
import {
  sendSlipToMarkets, addDocument, approveAndBind, startRenewal,
  submitForApproval, releaseSlip, returnToDraft,
  setSignedLine, removeMarketFromDraft,
} from "../services/placement.service.js";

let openId = null;

/* ---------- 1. the journey rail ---------- */

/**
 * Five steps as a numbered rail. Completed steps carry a tick, the current one
 * is filled, the rest are outlined — so the distance still to travel is
 * legible at a glance rather than implied by a colour bar.
 */
function journey(program) {
  const current = stepIndexFor(program.status);

  const steps = LIFECYCLE_STEPS.map((label, i) => {
    const state = i < current ? "done" : i === current ? "current" : "todo";
    const marker = state === "done" ? "✓" : String(i + 1);
    return `<li class="journey-step ${state}">
      <span class="journey-marker">${marker}</span>
      <span class="journey-label">${label}</span>
    </li>`;
  }).join("");

  return `<ol class="journey" aria-label="Placement lifecycle">${steps}</ol>`;
}

/* ---------- 2. the next action ---------- */

/** The instructions box travels with the bind button, not away from it. */
const instructionsBox = (program) => `<div class="field" style="margin:14px 0 12px;">
  <label for="detail-instructions">Binding instructions <span class="optional-tag">optional</span></label>
  <textarea id="detail-instructions" rows="2"
    placeholder="e.g. Settle within 30 days via client account; subject to updated loss bordereau.">${program.bindingInstructions || ""}</textarea>
  <div class="hint">Payment terms, subjectivities and special conditions. Recorded on the placement at bind.</div>
</div>`;

function nextActionCard(program) {
  const next = nextAction(program, {
    user: currentUser(),
    cedant: cedantNamed(program.cedant),
  });

  // Nothing left to do — say what happened instead of offering an action.
  if (!next) {
    return `<div class="next-action done">
      <div class="next-action-body">
        <div class="next-action-kicker">${icons.check}Step ${LIFECYCLE_STEPS.length} of ${LIFECYCLE_STEPS.length} · complete</div>
        <h4>Bound</h4>
        <p>Instructions on file: ${program.bindingInstructions || "none recorded"}. The premium invoice has been raised to the panel, and this placement re-opens for renewal 60 days before ${program.expiry}.</p>
      </div>
    </div>`;
  }

  const stepNo = next.stepIndex + 1;
  const button = `<button class="btn primary next-action-btn" data-action="${next.action}"${next.blocked ? " disabled" : ""}>${next.actionLabel}</button>`;
  const secondary = next.secondaryAction
    ? `<button class="btn next-action-secondary" data-action="${next.secondaryAction.action}">${next.secondaryAction.label}</button>`
    : "";

  return `<div class="next-action${next.blocked ? " blocked" : ""}">
    <div class="next-action-body">
      <div class="next-action-kicker">Do this next · step ${stepNo} of ${LIFECYCLE_STEPS.length}</div>
      <h4>${next.title}</h4>
      <p>${next.detail}</p>
      ${next.needsInstructions ? instructionsBox(program) : ""}
      ${next.blockedReason ? `<div class="next-action-block">${icons.info}${next.blockedReason}</div>` : ""}
      <div class="next-action-actions">${button}${secondary}</div>
    </div>
  </div>`;
}

/* ---------- 3. the bind gate, stated plainly ---------- */

/**
 * Which gate is in front of this placement. Before the slip is released it is
 * the release checklist — panel, signed lines, cedant KYC, four-eyes. After it
 * is in market, it is the bind checklist.
 */
function checklist(program) {
  if (program.status === "Bound") return "";

  const preMarket = isPreMarket(program);
  const items = preMarket
    ? releaseChecklist(program, cedantNamed(program.cedant), currentUser())
    : bindChecklist(program);
  const heading = preMarket ? "Before this slip can be released" : "Before this can bind";

  const rows = items.map((item) => {
    const glyph = item.state === "done" ? "✓"
                : item.state === "blocking" ? "!"
                : item.state === "optional" ? "○" : "·";
    return `<li class="check-item ${item.state}">
      <span class="check-glyph">${glyph}</span>
      <span class="check-text">
        <span class="check-label">${item.label}</span>
        <span class="check-detail">${item.detail}</span>
      </span>
    </li>`;
  }).join("");

  return `<div class="panel-title" style="font-size:12.5px;">${heading}</div>
    <ul class="checklist">${rows}</ul>`;
}

/** Who prepared the submission and who released it — the four-eyes record. */
function provenance(program) {
  if (!program.preparedBy && !program.approvedBy) return "";
  const line = (label, who) => who
    ? `<div class="confirm-row"><span>${label}</span><span class="prov-who">${who.name} · ${who.title}</span></div>`
    : "";
  return `<div class="panel-title" style="font-size:12.5px; margin-top:16px;">Authority trail</div>
    ${line("Prepared by", program.preparedBy)}
    ${line("Released by", program.approvedBy)}
    ${program.releasedUnderOverride
      ? `<div class="override-note">${icons.info}Released under administrator override — the preparer approved their own submission.</div>`
      : ""}`;
}

/* ---------- the market panel and the dropbox ---------- */

function marketPanel(program) {
  const p = confirmationProgress(program);
  const pctConfirmed = p.total ? Math.round(p.confirmed / p.total * 100) : 0;

  const bar = p.total ? `<div class="confirm-progress">
    <div class="confirm-bar"><span style="width:${pctConfirmed}%"></span></div>
    <div class="confirm-count">${p.confirmed} of ${p.total} confirmed${p.queried ? ` · ${p.queried} queried` : ""}</div>
  </div>` : "";

  // A draft is the only stage where the panel may still be changed: once the
  // slip is out, the lines are what the market was asked to sign.
  const editable = program.status === "Draft";

  const rows = program.marketConfirmations
    .map((mc) => editable
      ? `<div class="confirm-row">
          <span>${mc.m}</span>
          <span class="line-edit">
            <input type="number" min="0" max="100" step="1" value="${mc.line ?? 0}"
              data-line-for="${mc.m}" aria-label="Signed line for ${mc.m}">
            <span class="line-pct">%</span>
            <button class="btn ghost line-remove" data-action="remove-market" data-market="${mc.m}"
              title="Take ${mc.m} off the slip">✕</button>
          </span>
        </div>`
      : `<div class="confirm-row">
          <span>${mc.m}${mc.line ? ` <span class="signed-line">${mc.line}%</span>` : ""}</span>
          ${statusPill(mc.s)}
        </div>`)
    .join("");

  // Before release, the panel is measured by its signed lines rather than by
  // confirmations nobody has been asked for yet.
  const total = signedLines(program);
  const linesNote = isPreMarket(program)
    ? `<div class="confirm-count">Signed lines ${total}%${total === 100 ? " — fully placed" : ` — ${(100 - total).toFixed(0)}% outstanding`}</div>`
    : "";

  return `<div class="panel-title" style="font-size:12.5px;">${isPreMarket(program) ? "Market panel" : "Reinsurer confirmations"}</div>
    ${isPreMarket(program) ? linesNote : bar}${rows || `<div class="empty" style="padding:14px;">No markets on this slip.</div>`}`;
}

function documentPanel(program) {
  const rows = program.documents.length
    ? program.documents.map((d) => `<div class="doc-row"><span>
        <span class="d-name">${d.name}</span><br>
        <span class="d-meta">${d.type} · from ${d.from} · ${d.date}</span>
      </span></div>`).join("")
    : `<div class="empty" style="padding:16px;">No documents yet.</div>`;

  return `<div class="panel-title" style="font-size:12.5px; margin-top:16px;">Document dropbox</div>${rows}`;
}

/* ---------- assembly ---------- */

function body(program) {
  return journey(program)
    + nextActionCard(program)
    + `<div class="cols-2" style="margin-top:18px;">
        <div>${marketPanel(program)}${documentPanel(program)}</div>
        <div>${checklist(program)}${provenance(program)}</div>
      </div>`;
}

function shell(p) {
  return `<div class="modal-backdrop">
    <div class="modal" style="max-width:720px;">
      <div class="modal-head">
        <div>
          <div class="panel-title" style="margin:0;">${p.id} · ${p.cedant}</div>
          <div class="panel-sub" style="margin:2px 0 0;">${p.cls} · ${p.type} · ${p.structure}</div>
        </div>
        <button class="close-x" data-action="close-modal" aria-label="Close">✕</button>
      </div>
      <div class="modal-body" id="detail-body">${body(p)}</div>
    </div>
  </div>`;
}

function wire() {
  // Repaint on commit rather than on each keystroke, so the field keeps focus
  // while a number is being typed.
  document.querySelectorAll("[data-line-for]").forEach((input) => {
    const commit = () => {
      setSignedLine(openId, input.dataset.lineFor, input.value);
      repaint();
    };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); });
  });

  onAction("#modal-root", {
    "start-renewal": () => { startRenewal(openId); repaint(); },
    "submit-approval": () => { submitForApproval(openId); repaint(); },
    "release-slip": () => { releaseSlip(openId); repaint(); },
    "return-to-draft": () => { returnToDraft(openId, "terms need rework"); repaint(); },
    "remove-market": ({ market }) => { removeMarketFromDraft(openId, market); repaint(); },
    "send-slip": () => { sendSlipToMarkets(openId); repaint(); },
    "add-document": () => { addDocument(openId); repaint(); },
    "bind": () => {
      approveAndBind(openId, $("#detail-instructions")?.value);
      repaint();
    },
  });
}

function repaint() {
  const p = programById(openId);
  if (!p) return closeModal();
  updateModal(shell(p), { onMount: wire });
}

/** Open the lifecycle drawer on a program. */
export function openProgramDetail(id) {
  const p = programById(id);
  if (!p) return;
  openId = id;
  openModal(shell(p), { onMount: wire, onDismiss: () => { openId = null; } });
}
