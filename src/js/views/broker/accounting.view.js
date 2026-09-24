/**
 * Accounting & finance — the running technical account per program, the aged
 * creditor position, and the finance documents raised by placement events.
 */
import { $, $$, mount, row, onAction } from "../../core/dom.js";
import { fmt, fmtFull } from "../../core/format.js";
import { state } from "../../core/store.js";
import { on, TOPICS } from "../../core/events.js";
import { agedCreditors } from "../../data/finance.data.js";
import { technicalAccount } from "../../domain/technical-account.js";
import { financeBadge } from "../../ui/badges.js";
import { paginate, paginationControls, createPager } from "../../ui/pagination.js";

/** Program whose technical account is on screen. */
let selectedId = null;

function paintTechnicalAccount() {
  const p = state.programs.find((x) => x.id === selectedId) || state.programs[0];
  if (!p) return;
  const t = technicalAccount(p);
  $("#acc-sub").textContent = `${p.type} · ${p.structure} · ${p.ccy}`;
  mount("#acc-out",
    row("Ceded / treaty premium", fmtFull(t.ceded, p.ccy)) +
    row("Ceding commission", "−" + fmtFull(t.cedingCommission, p.ccy)) +
    row("Brokerage", "−" + fmtFull(t.brokerage, p.ccy)) +
    row("Claims booked", "−" + fmtFull(t.claims, p.ccy)) +
    row("Net technical result", fmtFull(t.net, p.ccy)));
}

/** Aged balances the desk owes its markets; 60d+ buckets are flagged. */
function agedTable() {
  const bucket = (v, tone) => v
    ? (tone ? `<span class="pill ${tone}" style="padding:1px 7px;">${fmt(v)}</span>` : fmt(v))
    : "—";

  return `<div class="table-wrap"><table>
    <thead><tr><th>Market</th><th class="num">Current</th><th class="num">30d</th><th class="num">60d</th><th class="num">90d+</th></tr></thead>
    <tbody>${agedCreditors.map((a) => `<tr>
      <td>${a.m}</td>
      <td class="num">${fmt(a.cur)}</td>
      <td class="num">${bucket(a.d30)}</td>
      <td class="num">${bucket(a.d60, "warn")}</td>
      <td class="num">${bucket(a.d90, "bad")}</td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}

const pager = createPager(() => accountingView.refresh());

const financeRow = (f) => `<tr>
    <td class="mono">${f.id}</td>
    <td>${financeBadge(f.type)}</td>
    <td>${f.program}</td>
    <td>${f.counterparty}</td>
    <td class="num">${fmtFull(f.amount, f.ccy)}</td>
    <td>${f.date}</td>
    <td>${f.co ? `<span class="pill info">${f.co}</span>` : "—"}</td>
  </tr>`;

export const accountingView = {
  id: "accounting",

  render: () => `<section class="view">
    <div class="view-head">
      <div>
        <h1>Accounting &amp; Finance</h1>
        <p>Technical accounts and finance documents.</p>
      </div>
    </div>
    <div class="tabs" id="acc-tabs">
      <div class="tab active" data-a="tech">Technical Accounts</div>
      <div class="tab" data-a="finance">Finance Documents</div>
    </div>

    <div id="acc-tech">
      <div class="field" style="max-width:360px;">
        <label>Select program</label>
        <select id="acc-select"></select>
      </div>
      <div class="cols-2">
        <div class="card">
          <div class="panel-title">Technical account</div>
          <div class="panel-sub" id="acc-sub"></div>
          <div class="calc-out" id="acc-out"></div>
        </div>
        <div class="card">
          <div class="panel-title">Aged creditor position — reinsurers</div>
          <div class="panel-sub">Balances due from the desk to its markets</div>
          <div id="aged-table"></div>
        </div>
      </div>
    </div>

    <div id="acc-finance" hidden>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Doc #</th><th>Type</th><th>Program</th><th>Counterparty</th>
            <th class="num">Amount</th><th>Date</th><th>Co-broking</th>
          </tr></thead>
          <tbody id="finance-body"></tbody>
        </table>
      </div>
      <div id="finance-pager"></div>
    </div>
  </section>`,

  mount() {
    $$("#acc-tabs .tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        $$("#acc-tabs .tab").forEach((x) => x.classList.remove("active"));
        tab.classList.add("active");
        $("#acc-tech").hidden = tab.dataset.a !== "tech";
        $("#acc-finance").hidden = tab.dataset.a !== "finance";
      });
    });

    pager.wire("#view-root");

    $("#acc-select").addEventListener("change", (e) => {
      selectedId = e.target.value;
      paintTechnicalAccount();
    });
  },

  refresh() {
    const select = $("#acc-select");
    if (!select) return;
    // Keep the operator's selection across re-renders where the program survives.
    if (!state.programs.some((p) => p.id === selectedId)) selectedId = state.programs[0]?.id ?? null;
    select.innerHTML = state.programs
      .map((p) => `<option value="${p.id}"${p.id === selectedId ? " selected" : ""}>${p.id} · ${p.cedant} · ${p.cls}</option>`)
      .join("");

    paintTechnicalAccount();
    mount("#aged-table", agedTable());
    const page = paginate(state.financeDocs, pager.page);
    mount("#finance-body", page.items.map(financeRow).join(""));
    mount("#finance-pager", paginationControls(page, { unit: "documents" }));
  },
};

[TOPICS.PROGRAMS, TOPICS.FINANCE, TOPICS.BORDEREAUX].forEach((topic) =>
  on(topic, () => { if (document.getElementById("acc-select")) accountingView.refresh(); })
);
