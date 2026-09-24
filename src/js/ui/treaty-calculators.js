/**
 * Treaty calculators — the what-if surface that used to be the whole Treaty
 * Engine page, now embedded under an agreement's Structure tab and prefilled
 * from its terms. All arithmetic stays in js/domain/.
 */
import { $, $$, mount, row } from "../core/dom.js";
import { fmt, fmtFull, pct } from "../core/format.js";
import { TOWER_COLORS } from "../core/config.js";
import { rateOnLine, towerTop, baseRetention, computeReinstatement } from "../domain/xol.js";
import { quotaShareResult, surplusResult, computeStopLoss, towerLayers, towerIssues } from "../domain/treaty.js";

const field = (id, label, value, step = 1) => `<div class="field"><label for="${id}">${label}</label><input type="number" id="${id}" value="${value ?? ""}" step="${step}"></div>`;
const val = (id, fallback = 0) => { const n = document.getElementById(id); return n ? (+n.value || fallback) : fallback; };

/** Markup for the calculator that fits this treaty type. */
export function renderCalculator(a) {
  const s = a.structure || {};
  const ccy = a.ccy;
  switch (a.type) {
    case "Quota Share":
      return `<div class="panel-title" style="font-size:12.5px;">Quota share what-if</div>
        <div class="panel-sub">Cession ${s.cessionPct ?? "—"}% · commission ${s.commissionPct ?? "—"}% · brokerage ${a.reporting?.brokeragePct ?? 0}%</div>
        <div class="field-row">${field("tc-gnpi", `Premium (${ccy})`, 10000000, 10000)}${field("tc-brok", "Brokerage %", a.reporting?.brokeragePct ?? 0, 0.25)}</div>
        <div class="calc-out" id="tc-out"></div>`;
    case "Surplus":
      return `<div class="panel-title" style="font-size:12.5px;">Surplus what-if — one risk</div>
        <div class="panel-sub">Retention ${fmt(s.retention || 0, ccy)} · ${s.lines ?? "—"} lines · capacity ${fmt((s.retention || 0) * ((s.lines || 0) + 1), ccy)}</div>
        <div class="field-row">${field("tc-si", `Risk sum insured (${ccy})`, (s.retention || 500000) * 6, 50000)}${field("tc-prem", `Gross premium for the risk (${ccy})`, 62000, 500)}</div>
        <div class="calc-out" id="tc-out"></div>`;
    case "Stop Loss":
      return `<div class="panel-title" style="font-size:12.5px;">Stop loss what-if</div>
        <div class="panel-sub">Attaches at ${s.attachmentRatio ?? "—"}% loss ratio, covers to ${s.limitRatio ?? "—"}% · ${s.lossRatioBasis || "basis not set"}</div>
        <div class="field-row">${field("tc-subject", `Subject premium (${ccy})`, s.subjectPremium || 0, 1000)}${field("tc-lr", "Actual loss ratio %", (s.attachmentRatio || 0) + 10, 0.5)}</div>
        <div class="calc-out" id="tc-out"></div>`;
    case "Per Risk XoL":
    case "Catastrophe XoL":
      return `<div class="panel-title" style="font-size:12.5px;">Tower</div>
        <div class="panel-sub">Each layer at its actual attachment on a linear loss scale; rate on line where a layer premium is recorded</div>
        <div class="tower" id="tc-tower"></div>
        <div class="panel-title" style="font-size:12.5px; margin-top:16px;">Reinstatement premium what-if</div>
        <div class="panel-sub">Pro-rata as to amount and, where selected, as to time</div>
        <div class="field-row">${field("ri-limit", `Layer limit (${ccy})`, s.layers?.[0]?.limit || 0, 100000)}${field("ri-loss", `Loss recovered (${ccy})`, Math.round((s.layers?.[0]?.limit || 0) * 0.65), 100000)}</div>
        <div class="field-row">${field("ri-prem", `Original layer premium (${ccy})`, s.layers?.[0]?.premium || 0, 10000)}${field("ri-pct", "Reinstatement %", 100, 5)}</div>
        <div class="field"><label>Time remaining in period</label><input type="range" id="ri-time" min="0" max="100" value="40"><div class="hint"><span id="ri-time-label">40%</span> of the period remains when the loss occurs</div></div>
        <div class="calc-out" id="ri-out"></div>`;
    default:
      return "";
  }
}

/** Wire the calculator inputs and paint the first result. */
export function mountCalculator(a) {
  const s = a.structure || {};
  const ccy = a.ccy;
  const paint = {
    "Quota Share": () => {
      const r = quotaShareResult(s, val("tc-gnpi"), val("tc-brok"));
      mount("#tc-out", row("Ceded premium", fmtFull(r.ceded, ccy)) + row("Ceding commission", fmtFull(r.cedingCommission, ccy)) + row("Brokerage", fmtFull(r.brokerage, ccy)) + row("Net premium to reinsurers", fmtFull(r.netToReinsurers, ccy)));
    },
    "Surplus": () => {
      const r = surplusResult(s, val("tc-si"), val("tc-prem"));
      mount("#tc-out", row("Max treaty capacity", fmtFull(r.maxCapacity, ccy)) + row("Ceded sum insured", fmtFull(r.cededSumInsured, ccy)) + row("Cession %", pct(r.cessionPct)) + row("Ceded premium", fmtFull(r.cededPremium, ccy)));
    },
    "Stop Loss": () => {
      const r = computeStopLoss({ subjectPremium: val("tc-subject"), attachmentRatio: Number(s.attachmentRatio) || 0, limitRatio: Number(s.limitRatio) || 0, lossRatio: val("tc-lr") });
      mount("#tc-out", row("Attachment (loss)", fmtFull(r.attachment, ccy)) + row("Cover (limit)", fmtFull(r.limit, ccy)) + row("Cedant's loss at this ratio", fmtFull(r.loss, ccy)) + row("Recovery from treaty", fmtFull(r.recovery, ccy)));
    },
    "Per Risk XoL": paintXol, "Catastrophe XoL": paintXol,
  }[a.type];
  if (!paint) return;
  function paintXol() {
    mount("#tc-tower", towerHtml(s.layers || []));
    const time = val("ri-time");
    const r = computeReinstatement({ limit: val("ri-limit", 1), lossRecovered: val("ri-loss"), layerPremium: val("ri-prem"), reinstatementPct: val("ri-pct"), timeRemainingPct: time });
    const label = $("#ri-time-label"); if (label) label.textContent = `${time}%`;
    mount("#ri-out", row("Layer used (% of limit)", pct(r.amountFraction * 100)) + row("Time fraction applied", pct(time)) + row("Reinstatement premium due", fmtFull(r.premiumDue, ccy)));
  }
  $$("#tc-gnpi, #tc-brok, #tc-si, #tc-prem, #tc-subject, #tc-lr, #ri-limit, #ri-loss, #ri-prem, #ri-pct, #ri-time").forEach((i) => i.addEventListener("input", paint));
  paint();
}

/** The tower drawing, lifted from the former calculator page. */
export function towerHtml(layersIn) {
  const layers = towerLayers(layersIn);
  if (!layers.length) return '<p class="tower-empty">No layers recorded on this agreement.</p>';
  if (layers.some((l) => !(l.limit > 0) || l.ret < 0)) return '<p class="tower-status tower-status--issue" role="status">Every layer needs a positive limit and a non-negative attachment.</p>';
  const top = towerTop(layers); const retention = baseRetention(layers);
  const position = (v) => v / top * 100;
  const issues = towerIssues(layersIn);
  const issueText = ({ from, to, covering }) => `${covering.length ? "Overlap" : "Uninsured gap"}: ${fmtFull(from)}–${fmtFull(to)} · ${fmtFull(to - from)}${covering.length ? ` · Layers ${covering.join(", ")}` : ""}`;
  const ticks = Array.from({ length: 5 }, (_, i) => { const v = top * i / 4; return `<div class="tower-tick" style="bottom:${position(v)}%"><span class="mono">${fmt(v)}</span></div>`; }).join("");
  const bands = layers.map((l, i) => `<div class="tower-track" style="--tower-color:${TOWER_COLORS[i % TOWER_COLORS.length]}"><span class="tower-track-label mono">L${i + 1}</span><div class="tower-band" style="bottom:${position(l.ret)}%;height:${position(l.limit)}%" title="Layer ${i + 1}: ${fmtFull(l.ret)}–${fmtFull(l.ret + l.limit)}"></div></div>`).join("");
  const issueBands = issues.map((x) => `<div class="tower-issue-band ${x.covering.length ? "tower-issue-band--overlap" : ""}" style="bottom:${position(x.from)}%;height:${position(x.to - x.from)}%" title="${issueText(x)}"></div>`).join("");
  const details = layers.map((l, i) => `<li class="tower-detail" style="--tower-color:${TOWER_COLORS[i % TOWER_COLORS.length]}">
      <div><strong>Layer ${i + 1}</strong><span class="tower-terms mono">${fmt(l.limit)} xs ${fmt(l.ret)}</span></div>
      <div class="tower-detail-metrics"><span>Premium <b class="mono">${l.premium != null ? fmtFull(l.premium) : "not set"}</b></span><span>ROL <b class="mono">${l.premium != null ? `${rateOnLine(l.limit, l.premium).toFixed(2)}%` : "—"}</b></span><span>Reinstatements <b class="mono">${layersIn[i].reinstatements ?? "—"}</b></span></div>
      <span class="tower-range mono">${fmtFull(l.ret)} → ${fmtFull(l.ret + l.limit)}</span></li>`).join("");
  return `<div class="tower-heading"><span>Loss scale · linear</span><span class="mono">Top ${fmt(top)}</span></div>
    <p class="tower-status ${issues.length ? "tower-status--issue" : "tower-status--good"}" role="status">${issues.length ? "Coverage discontinuities — review the bands below" : "Continuous cover above retention"}</p>
    <div class="tower-chart" role="img" aria-label="Tower from zero to ${fmtFull(top)}; retention ${fmtFull(retention)}">
      <div class="tower-axis">${ticks}</div>
      <div class="tower-plot-scroll"><div class="tower-plot" style="--tower-tracks:${layers.length}">
        <div class="tower-retention" style="height:${position(retention)}%" title="Cedant retention: ${fmtFull(retention)}"></div>${issueBands}<div class="tower-tracks">${bands}</div>
      </div></div>
    </div>
    <p class="tower-retention-key">Cedant retention <strong class="mono">${fmtFull(retention)}</strong> · bottom of scale</p>
    ${issues.length ? `<ul class="tower-issues">${issues.map((x) => `<li>${issueText(x)}</li>`).join("")}</ul>` : ""}
    <ol class="tower-details">${details}</ol>`;
}
