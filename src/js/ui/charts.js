/**
 * Hand-rolled inline SVG charts.
 *
 * Every chart is a pure function returning markup, so a view can render one
 * without owning any drawing code. Colours come from CSS custom properties
 * wherever possible so the charts follow the theme.
 */
import { CHART_COLORS, LOSS_RATIO_WATCH_LINE, CONCENTRATION_WATCH_PCT } from "../core/config.js";
import { fmt, pct } from "../core/format.js";

/**
 * Vertical bars with a value above each and a label beneath.
 * @param {Record<string, number>} data  category → amount
 */
export function barChart(data) {
  const categories = Object.keys(data);
  if (!categories.length) return "";
  const max = Math.max(...categories.map((c) => data[c]));
  const barW = 48, gap = 28, h = 160;
  const w = categories.length * (barW + gap);

  const bars = categories.map((c, i) => {
    const bh = Math.max(4, data[c] / max * h);
    const x = i * (barW + gap) + gap / 2;
    return `<rect x="${x}" y="${h - bh}" width="${barW}" height="${bh}" rx="4" fill="${CHART_COLORS[i % CHART_COLORS.length]}"></rect>`
      + `<text x="${x + barW / 2}" y="${h + 18}" text-anchor="middle" font-size="11" fill="var(--ink-soft)" font-family="IBM Plex Sans">${c}</text>`
      + `<text x="${x + barW / 2}" y="${h - bh - 6}" text-anchor="middle" font-size="10.5" fill="var(--ink)" font-family="IBM Plex Mono">${fmt(data[c])}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${w} ${h + 30}" width="100%" height="200" preserveAspectRatio="xMinYMid meet">${bars}</svg>`;
}

/**
 * Trend line with a shaded area and the watch line marked.
 * @param {number[]} series  percentages, oldest first
 */
export function lineChart(series) {
  const w = 440, h = 140, pad = 14;
  const pts = series.map((v, i) => [
    pad + i * ((w - 2 * pad) / (series.length - 1)),
    h - (v / 100) * h,
  ]);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${path} L${pts.at(-1)[0]},${h} L${pts[0][0]},${h} Z`;
  const watchY = h - (LOSS_RATIO_WATCH_LINE / 100) * h;
  const last = pts.at(-1);

  return `<svg viewBox="0 0 ${w} ${h + 26}" width="100%" height="180" preserveAspectRatio="xMinYMid meet">`
    + `<line x1="${pad}" y1="${watchY}" x2="${w - pad}" y2="${watchY}" stroke="var(--line)" stroke-dasharray="3,3"/>`
    + `<path d="${area}" fill="var(--marine)" opacity="0.12"></path>`
    + `<path d="${path}" fill="none" stroke="var(--marine)" stroke-width="2.5"></path>`
    + pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 4 : 2.5}" fill="var(--marine)"></circle>`).join("")
    + `<text x="${pad}" y="${watchY - 5}" font-size="10" fill="var(--ink-soft)" font-family="IBM Plex Mono">${LOSS_RATIO_WATCH_LINE}% watch line</text>`
    + `<text x="${last[0]}" y="${last[1] - 10}" text-anchor="end" font-size="11" fill="var(--marine-ink)" font-family="IBM Plex Mono">${pct(series.at(-1))}</text>`
    + `</svg>`;
}

/**
 * Horizontal loss-ratio bars, coloured against the appetite thresholds.
 * @param {{id:string, lossRatio:number}[]} rows
 */
export function lossRatioBars(rows) {
  const w = 460, barH = 26, gap = 14, labelW = 90;
  const max = Math.max(100, ...rows.map((r) => r.lossRatio));
  const trackW = w - labelW - 10;

  const bars = rows.map((r, i) => {
    const y = i * (barH + gap);
    const filled = trackW * Math.min(r.lossRatio, max) / max;
    const color = r.lossRatio > 90 ? "var(--bad)" : r.lossRatio > LOSS_RATIO_WATCH_LINE ? "var(--warn)" : "var(--good)";
    return `<text x="0" y="${y + barH / 2 + 4}" font-size="11.5" fill="var(--ink)" font-family="IBM Plex Mono">${r.id}</text>`
      + `<rect x="${labelW}" y="${y}" width="${trackW}" height="${barH}" rx="5" fill="var(--surface-2)"></rect>`
      + `<rect x="${labelW}" y="${y}" width="${Math.max(2, filled)}" height="${barH}" rx="5" fill="${color}"></rect>`
      + `<text x="${labelW + Math.max(2, filled) + 8}" y="${y + barH / 2 + 4}" font-size="11.5" fill="var(--ink)" font-family="IBM Plex Mono">${r.lossRatio.toFixed(0)}%</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${w} ${rows.length * (barH + gap)}" width="100%" height="${rows.length * (barH + gap)}">${bars}</svg>`;
}

/**
 * Ranked share bars — who holds how much of the book.
 *
 * Drawn as HTML rather than SVG on purpose: counterparty names are long and
 * unpredictable ("Marlow Underwriting · Syndicate 1918"), and text flow handles
 * that at any width where an SVG label would need truncating or clipping.
 *
 * @param {{rows: object[], total: number, flagged: object[]}} result from concentration()
 * @param {{format?: (n:number) => string, empty?: string}} [options]
 */
export function concentrationBars(result, { format = fmt, empty = "Nothing to show yet." } = {}) {
  if (!result.rows.length) return `<div class="empty">${empty}</div>`;

  const rows = result.rows.map((row) => {
    const flagged = !row.isOther && row.share >= CONCENTRATION_WATCH_PCT;
    return `<div class="conc-row${row.isOther ? " is-other" : ""}${flagged ? " is-flagged" : ""}">
      <div class="conc-head">
        <span class="conc-name">${row.name}</span>
        <span class="conc-figures"><span class="mono">${format(row.value)}</span><span class="conc-share mono">${row.share.toFixed(1)}%</span></span>
      </div>
      <div class="conc-bar"><span style="width:${Math.max(row.share, 0.8)}%"></span></div>
    </div>`;
  }).join("");

  const note = result.flagged.length
    ? `<div class="conc-note">${result.flagged.length === 1
        ? `${result.flagged[0].name} alone is ${result.flagged[0].share.toFixed(0)}% of the total.`
        : `${result.flagged.length} counterparties are each at or above ${CONCENTRATION_WATCH_PCT}%.`}</div>`
    : "";

  return rows + note;
}
