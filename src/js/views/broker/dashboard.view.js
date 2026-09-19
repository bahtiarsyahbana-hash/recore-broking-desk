/**
 * Broker dashboard — the whole book on one screen: KPIs, the 60-day renewal
 * loop, premium mix, loss-ratio trend and recent activity.
 */
import { mount, onAction } from "../../core/dom.js";
import { fmt, pct } from "../../core/format.js";
import { state } from "../../core/store.js";
import { on, TOPICS } from "../../core/events.js";
import { TODAY, LOSS_RATIO_WATCH_LINE, RENEWAL_URGENT_DAYS } from "../../core/config.js";
import { agedCreditorTotal } from "../../data/finance.data.js";
import { portfolioTotals, premiumByClass, openClaims, renewalsDue } from "../../domain/portfolio.js";
import { barChart, lineChart } from "../../ui/charts.js";
import { emptyState } from "../../ui/badges.js";
import { icons } from "../../ui/icons.js";
import { openWizard } from "../../ui/submission-wizard.js";
import { openProgramDetail } from "../../ui/program-detail.js";
import { startRenewal } from "../../services/placement.service.js";
import { showView } from "../../core/router.js";

/** Historical loss-ratio quarters; the live figure is appended as the latest. */
const TREND_HISTORY = [58, 64, 61, 70, 66];

/** Straight-through feed from placement, bordereaux and claims. */
const ACTIVITY = [
  ["P-1001 Layer 2 reinstatement premium posted", "Accounting", "2h ago"],
  ["Q2 2026 loss bordereau flagged — currency mismatch", "Bordereaux", "5h ago"],
  ["Sahara Takaful cargo claim moved to Paid", "Claims", "1d ago"],
  ["P-1006 Cat XL — 4 of 6 markets signed (78%)", "Placements", "1d ago"],
];

function kpiCards() {
  const totals = portfolioTotals(state.programs);
  const open = openClaims(state.claims).length;

  return [
    { label: "Bound premium (USD eq.)", value: fmt(totals.premium), delta: "+8.4% vs prior year", up: true },
    { label: "Portfolio loss ratio", value: pct(totals.lossRatio),
      delta: totals.lossRatio > LOSS_RATIO_WATCH_LINE ? `above ${LOSS_RATIO_WATCH_LINE}% watch line` : "within appetite",
      up: totals.lossRatio <= LOSS_RATIO_WATCH_LINE },
    { label: "Open claims", value: open, delta: `${open} across ${state.programs.length} programs`, up: true },
    { label: "Aged reinsurer creditor", value: fmt(agedCreditorTotal), delta: "3 balances > 60 days", up: false },
  ].map((k) => `<div class="card">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-delta ${k.up ? "up" : "down"}">${k.delta}</div>
    </div>`).join("");
}

/** Renewals inside the horizon, each able to re-open its own lifecycle. */
function renewalRows() {
  const due = renewalsDue(state.programs, TODAY);
  if (!due.length) return emptyState("Nothing due for renewal in the next 60 days.");

  return due.map(({ program, days }) => `<div class="confirm-row">
      <span><strong>${program.id}</strong> · ${program.cedant} · ${program.cls} ${program.type} — expires ${program.expiry}</span>
      <span style="display:flex; align-items:center; gap:10px;">
        <span class="pill ${days <= RENEWAL_URGENT_DAYS ? "bad" : "warn"}">${days} days</span>
        <button class="btn primary" style="padding:6px 12px;" data-action="start-renewal" data-id="${program.id}">Start Renewal (Draft)</button>
      </span>
    </div>`).join("");
}

const activityRows = () => ACTIVITY.map(([what, where, when]) =>
  `<div style="display:flex; justify-content:space-between; gap:10px; padding:9px 0; border-bottom:1px solid var(--line-soft); font-size:13px;">
    <span>${what}</span><span style="color:var(--ink-soft); white-space:nowrap;">${where} · ${when}</span>
  </div>`).join("");

export const dashboardView = {
  id: "dashboard",

  render: () => `<section class="view">
    <div class="view-head">
      <div>
        <h1>Broking Desk</h1>
        <p>Every program the desk is running this underwriting year — facultative and treaty, proportional and non-proportional, in one book.</p>
      </div>
      <button class="btn primary" data-action="new-submission">${icons.plus}New Submission</button>
    </div>

    <div class="grid-kpi" id="kpi-row"></div>

    <div class="card" style="margin-bottom:16px;">
      <div class="panel-title">Renewals due in 60 days</div>
      <div class="panel-sub">The lifecycle loops itself — each one re-opens as a draft, pre-populated from the expiring terms, and goes back through approval before it reaches the market</div>
      <div id="renewals-list"></div>
    </div>

    <div class="cols-2">
      <div class="card">
        <div class="panel-title">Bound premium by class of business</div>
        <div class="panel-sub">Gross premium, USD equivalent, current underwriting year</div>
        <div id="chart-bar"></div>
      </div>
      <div class="card">
        <div class="panel-title">Loss ratio trend</div>
        <div class="panel-sub">Incurred / earned, trailing quarters</div>
        <div id="chart-line"></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="panel-title">Recent activity</div>
      <div class="panel-sub">Straight-through from placement, bordereaux and claims</div>
      <div id="activity-feed">${activityRows()}</div>
    </div>
  </section>`,

  mount() {
    onAction("#view-root", {
      "new-submission": () => openWizard((id) => { showView("placements"); openProgramDetail(id); }),
      "start-renewal": ({ id }) => { startRenewal(id); openProgramDetail(id); },
    });
  },

  refresh() {
    const totals = portfolioTotals(state.programs);
    mount("#kpi-row", kpiCards());
    mount("#renewals-list", renewalRows());
    mount("#chart-bar", barChart(premiumByClass(state.programs)));
    mount("#chart-line", lineChart([...TREND_HISTORY, totals.lossRatio]));
  },
};

// The dashboard summarises the whole book, so it re-reads on any book change.
[TOPICS.PROGRAMS, TOPICS.CLAIMS, TOPICS.FINANCE].forEach((topic) =>
  on(topic, () => { if (document.getElementById("kpi-row")) dashboardView.refresh(); })
);
