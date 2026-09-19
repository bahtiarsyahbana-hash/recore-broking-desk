/**
 * Treaty calculation engine — a what-if surface over the same formulas that
 * post to every technical account.
 *
 * Three tabs, one per treaty form. All arithmetic lives in js/domain/; this
 * module only reads inputs, calls the domain, and paints the result.
 */
import { $, $$, mount, row, onInput, numVal, onAction } from "../../core/dom.js";
import { fmt, fmtFull, pct } from "../../core/format.js";
import { TOWER_COLORS } from "../../core/config.js";
import { computeQuotaShare } from "../../domain/quota-share.js";
import { computeSurplus } from "../../domain/surplus.js";
import { rateOnLine, towerTop, baseRetention, computeReinstatement } from "../../domain/xol.js";
import { icons } from "../../ui/icons.js";

/** The tower being modelled. Editing a layer re-derives its rate on line. */
let layers = [
  { limit: 5_000_000,  ret: 5_000_000,  rol: 8.5 },
  { limit: 10_000_000, ret: 10_000_000, rol: 4.2 },
  { limit: 25_000_000, ret: 20_000_000, rol: 1.8 },
];

/* ---------- quota share ---------- */

function paintQuotaShare() {
  const r = computeQuotaShare({
    gnpi: numVal("qs-gnpi"),
    cessionPct: numVal("qs-cession"),
    commissionPct: numVal("qs-comm"),
    brokeragePct: numVal("qs-brok"),
  });
  mount("#qs-out",
    row("Ceded premium", fmtFull(r.ceded)) +
    row("Ceding commission", fmtFull(r.cedingCommission)) +
    row("Brokerage", fmtFull(r.brokerage)) +
    row("Net premium to reinsurers", fmtFull(r.netToReinsurers)));
}

/* ---------- surplus ---------- */

function paintSurplus() {
  const r = computeSurplus({
    sumInsured: numVal("sp-si"),
    retention: numVal("sp-ret", 1),
    lines: numVal("sp-lines"),
    premium: numVal("sp-prem"),
  });
  mount("#sp-out",
    row("Max treaty capacity", fmtFull(r.maxCapacity)) +
    row("Ceded sum insured", fmtFull(r.cededSumInsured)) +
    row("Cession %", pct(r.cessionPct)) +
    row("Ceded premium", fmtFull(r.cededPremium)));
}

/* ---------- excess of loss: layer editor + tower ---------- */

/** Premium currently entered against a layer, falling back to its ROL. */
const enteredPremium = (layer, i) => {
  const input = $(`[data-i="${i}"][data-k="premium"]`);
  return input ? (+input.value || 0) : Math.round(layer.limit * layer.rol / 100);
};

function paintLayerEditor() {
  mount("#layer-rows", layers.map((l, i) => `<div class="layer-row">
    <div class="field" style="margin-bottom:0;"><label>Layer ${i + 1} limit</label>
      <input type="number" step="500000" value="${l.limit}" data-i="${i}" data-k="limit"></div>
    <div class="field" style="margin-bottom:0;"><label>Attachment (xs)</label>
      <input type="number" step="500000" value="${l.ret}" data-i="${i}" data-k="ret"></div>
    <div class="field" style="margin-bottom:0;"><label>Layer premium</label>
      <input type="number" step="10000" value="${l.premium ?? Math.round(l.limit * l.rol / 100)}" data-i="${i}" data-k="premium"></div>
    <div class="field" style="margin-bottom:0;"><label>Rate on line</label>
      <div class="calc-out" style="padding:8px 10px;"><span class="mono" id="rol-${i}"></span></div></div>
    <button class="btn ghost" title="Remove layer" data-action="remove-layer" data-i="${i}" style="padding:8px;">✕</button>
  </div>`).join(""));

  $$("#layer-rows input").forEach((input) => {
    input.addEventListener("input", () => {
      layers[+input.dataset.i][input.dataset.k] = +input.value || 0;
      paintRateOnLine();
      paintTower();
    });
  });

  paintRateOnLine();
  paintTower();
}

function paintRateOnLine() {
  layers.forEach((l, i) => {
    const target = document.getElementById(`rol-${i}`);
    if (target) target.textContent = rateOnLine(l.limit, enteredPremium(l, i)).toFixed(2) + "%";
  });
}

/** Draw every band at its actual attachment on a shared, linear loss scale. */
function paintTower() {
  if (!layers.length) {
    mount("#tower-viz", '<p class="tower-empty">No layers yet. Add a layer to see the programme.</p>');
    return;
  }
  // Inputs remain editable; do not draw invalid terms as plausible coverage.
  if (layers.some(l => !Number.isFinite(l.ret) || l.ret < 0 ||
      !Number.isFinite(l.limit) || l.limit <= 0 || !Number.isFinite(l.ret + l.limit))) {
    mount("#tower-viz", '<p class="tower-status tower-status--issue" role="status">Enter a positive limit and a non-negative attachment for every layer to draw the tower.</p>');
    return;
  }

  const top = towerTop(layers);
  const retention = baseRetention(layers);
  const position = value => value / top * 100;
  const money = value => fmtFull(value);
  // Sweep all boundaries, rather than comparing neighbours: this also handles
  // reordered, nested and multiple overlapping layers without false gaps.
  const boundaries = [...new Set([retention, ...layers.flatMap(l => [l.ret, l.ret + l.limit])])]
    .sort((a, b) => a - b);
  const issues = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const from = boundaries[i];
    const to = boundaries[i + 1];
    const covering = layers.flatMap((l, index) => l.ret <= from && l.ret + l.limit >= to ? [index + 1] : []);
    if (covering.length !== 1) issues.push({ from, to, covering });
  }
  const issueText = ({ from, to, covering }) =>
    `${covering.length ? "Overlap" : "Uninsured gap"}: ${money(from)}–${money(to)} · ${money(to - from)}${covering.length ? ` · Layers ${covering.join(", ")}` : ""}`;
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const value = top * i / 4;
    return `<div class="tower-tick" style="bottom:${position(value)}%"><span class="mono">${fmt(value)}</span></div>`;
  }).join("");
  const bands = layers.map((l, i) => `<div class="tower-track" style="--tower-color:${TOWER_COLORS[i % TOWER_COLORS.length]}">
    <span class="tower-track-label mono">L${i + 1}</span>
    <div class="tower-band" style="bottom:${position(l.ret)}%;height:${position(l.limit)}%"
      title="Layer ${i + 1}: ${money(l.ret)}–${money(l.ret + l.limit)}"></div>
  </div>`).join("");
  const issueBands = issues.map(issue => `<div class="tower-issue-band ${issue.covering.length ? "tower-issue-band--overlap" : ""}"
    style="bottom:${position(issue.from)}%;height:${position(issue.to - issue.from)}%" title="${issueText(issue)}"></div>`).join("");
  const details = layers.map((l, i) => {
    const premium = l.premium ?? enteredPremium(l, i);
    const rol = rateOnLine(l.limit, premium);
    return `<li class="tower-detail" style="--tower-color:${TOWER_COLORS[i % TOWER_COLORS.length]}">
      <div><strong>Layer ${i + 1}</strong><span class="tower-terms mono">${fmt(l.limit)} xs ${fmt(l.ret)}</span></div>
      <div class="tower-detail-metrics"><span>Premium <b class="mono">${money(premium)}</b></span><span>ROL <b class="mono">${rol.toFixed(2)}%</b></span></div>
      <span class="tower-range mono">${money(l.ret)} → ${money(l.ret + l.limit)}</span>
    </li>`;
  }).join("");

  mount("#tower-viz", `
    <div class="tower-heading"><span>Loss scale · linear</span><span class="mono">Top ${fmt(top)}</span></div>
    <p class="tower-status ${issues.length ? "tower-status--issue" : "tower-status--good"}" role="status">${issues.length ? "Coverage discontinuities — review the bands below" : "Continuous cover above retention"}</p>
    <div class="tower-chart" role="img" aria-label="Linear loss scale from zero to ${money(top)}. Cedant retention ${money(retention)} at the bottom. Each layer has its own track. ${issues.length ? issues.map(issueText).join(". ") : "No gaps or overlaps."} Layer amounts are listed below.">
      <div class="tower-axis">${ticks}</div>
      <div class="tower-plot-scroll"><div class="tower-plot" style="--tower-tracks:${layers.length}">
        <div class="tower-retention" style="height:${position(retention)}%" title="Cedant retention: ${money(retention)}"></div>
        ${issueBands}<div class="tower-tracks">${bands}</div>
      </div></div>
    </div>
    <p class="tower-retention-key">Cedant retention <strong class="mono">${money(retention)}</strong> · bottom of scale</p>
    ${issues.length ? `<ul class="tower-issues">${issues.map(issue => `<li>${issueText(issue)}</li>`).join("")}</ul>` : ""}
    <ol class="tower-details">${details}</ol>
  `);
}

/* ---------- reinstatement ---------- */

function paintReinstatement() {
  const timeLeft = numVal("ri-time");
  const r = computeReinstatement({
    limit: numVal("ri-limit", 1),
    lossRecovered: numVal("ri-loss"),
    layerPremium: numVal("ri-prem"),
    reinstatementPct: numVal("ri-pct"),
    timeRemainingPct: timeLeft,
  });
  $("#ri-time-label").textContent = timeLeft + "%";
  mount("#ri-out",
    row("Layer used (% of limit)", pct(r.amountFraction * 100)) +
    row("Time fraction applied", pct(timeLeft)) +
    row("Reinstatement premium due", fmtFull(r.premiumDue)));
}

/* ---------- view ---------- */

export const treatyView = {
  id: "treaty",

  render: () => `<section class="view">
    <div class="view-head">
      <div>
        <h1>Treaty Calculation Engine</h1>
        <p>The same audited formulas that post to every technical account — try terms before they go on a slip.</p>
      </div>
    </div>
    <div class="tabs" id="treaty-tabs">
      <div class="tab active" data-t="qs">Quota Share</div>
      <div class="tab" data-t="surplus">Surplus</div>
      <div class="tab" data-t="xol">Excess of Loss</div>
    </div>

    <div id="treaty-qs">
      <div class="cols-2">
        <div class="card">
          <div class="panel-title">Quota share terms</div>
          <div class="panel-sub">Cedant: Pacífico General Insurance · Property QS · UWY 2026</div>
          <div class="field-row">
            <div class="field"><label>Gross Net Premium Income</label><input type="number" id="qs-gnpi" value="18400000" step="10000"></div>
            <div class="field"><label>Cession %</label><input type="number" id="qs-cession" value="35" step="0.5"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Ceding commission %</label><input type="number" id="qs-comm" value="28" step="0.5"></div>
            <div class="field"><label>Brokerage %</label><input type="number" id="qs-brok" value="2.5" step="0.25"></div>
          </div>
          <div class="hint">Sliding-scale commission and profit commission are configured per treaty; this quick engine uses the flat rate above.</div>
        </div>
        <div class="card">
          <div class="panel-title">Result</div>
          <div class="panel-sub">Recomputes live as terms change</div>
          <div class="calc-out" id="qs-out"></div>
        </div>
      </div>
    </div>

    <div id="treaty-surplus" hidden>
      <div class="cols-2">
        <div class="card">
          <div class="panel-title">Surplus treaty terms</div>
          <div class="panel-sub">Cedant: Northwind Assurance Co. · Motor Surplus · UWY 2026</div>
          <div class="field-row">
            <div class="field"><label>Risk sum insured</label><input type="number" id="sp-si" value="4500000" step="50000"></div>
            <div class="field"><label>Cedant retention (line)</label><input type="number" id="sp-ret" value="500000" step="10000"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Treaty lines (max multiple)</label><input type="number" id="sp-lines" value="9" step="1"></div>
            <div class="field"><label>Gross premium for this risk</label><input type="number" id="sp-prem" value="62000" step="500"></div>
          </div>
        </div>
        <div class="card">
          <div class="panel-title">Result</div>
          <div class="panel-sub">Cession % varies by risk size, capped at treaty lines</div>
          <div class="calc-out" id="sp-out"></div>
        </div>
      </div>
    </div>

    <div id="treaty-xol" hidden>
      <div class="cols-2">
        <div class="card">
          <div class="panel-title">Layer tower — Meridian Mutual Property XL</div>
          <div class="panel-sub">Build the tower layer by layer; rate on line is calculated per layer</div>
          <div id="layer-rows"></div>
          <button class="btn ghost" data-action="add-layer" style="margin-top:4px;">${icons.plus}Add layer</button>
          <div style="margin-top:18px;">
            <div class="panel-title" style="font-size:12.5px;">Tower visualization</div>
            <div class="tower" id="tower-viz" style="margin-top:8px;"></div>
          </div>
        </div>
        <div class="card">
          <div class="panel-title">Reinstatement premium calculator</div>
          <div class="panel-sub">Pro-rata as to amount and, where selected, as to time</div>
          <div class="field-row">
            <div class="field"><label>Layer limit</label><input type="number" id="ri-limit" value="10000000" step="500000"></div>
            <div class="field"><label>Loss recovered</label><input type="number" id="ri-loss" value="6500000" step="100000"></div>
          </div>
          <div class="field-row">
            <div class="field"><label>Original layer premium</label><input type="number" id="ri-prem" value="850000" step="10000"></div>
            <div class="field"><label>Reinstatement %</label><input type="number" id="ri-pct" value="100" step="5"></div>
          </div>
          <div class="field">
            <label>Time remaining in period (pro-rata temporis)</label>
            <input type="range" id="ri-time" min="0" max="100" value="40">
            <div class="hint"><span id="ri-time-label">40%</span> of the annual period remains when the loss occurs</div>
          </div>
          <div class="calc-out" id="ri-out" style="margin-top:8px;"></div>
        </div>
      </div>
    </div>
  </section>`,

  mount() {
    $$("#treaty-tabs .tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        $$("#treaty-tabs .tab").forEach((x) => x.classList.remove("active"));
        tab.classList.add("active");
        ["qs", "surplus", "xol"].forEach((k) => {
          $(`#treaty-${k}`).hidden = (k !== tab.dataset.t);
        });
      });
    });

    onInput(["qs-gnpi", "qs-cession", "qs-comm", "qs-brok"], paintQuotaShare);
    onInput(["sp-si", "sp-ret", "sp-lines", "sp-prem"], paintSurplus);
    onInput(["ri-limit", "ri-loss", "ri-prem", "ri-pct", "ri-time"], paintReinstatement);

    onAction("#view-root", {
      "add-layer": () => {
        layers.push({ limit: 10_000_000, ret: towerTop(layers), rol: 2.5 });
        paintLayerEditor();
      },
      "remove-layer": ({ i }) => {
        layers.splice(+i, 1);
        paintLayerEditor();
      },
    });
  },

  refresh() {
    paintQuotaShare();
    paintSurplus();
    paintLayerEditor();
    paintReinstatement();
  },
};
