# Design brief — XoL tower visualisation

**Paste this whole file into ChatGPT (or any model) as the task.** It contains
the real code, the design tokens and the constraints, so the answer can be
dropped straight into the codebase.

---

## 1. What this is

ReCore is a reinsurance broking application. This task is to redesign **one
component**: the layer-tower visualisation on the Treaty Engine's *Excess of
Loss* tab.

### Domain context you need

In excess-of-loss reinsurance, a cedant (an insurance company) keeps the first
slice of any loss and buys cover above it in stacked bands called **layers**.

A layer is written `5m xs 5m` — "5 million in excess of 5 million" — meaning it
pays the slice of a loss between 5m and 10m, nothing below, nothing above.

The current tower being modelled:

| Band | Attaches at | Exhausts at | Limit | Premium | Rate on line |
|---|---|---|---|---|---|
| Cedant retention | 0 | 5m | 5m | — | — |
| Layer 1 | 5m | 10m | 5m | 425,000 | 8.50% |
| Layer 2 | 10m | 20m | 10m | 420,000 | 4.20% |
| Layer 3 | 20m | 45m | 25m | 450,000 | 1.80% |

**Rate on line** = premium ÷ limit. Its inverse is roughly the payback period.
Lower layers are hit often so cost far more per dollar of cover; higher layers
are cheap because they only respond to catastrophes. A broker reads the tower to
judge whether a quoted layer is dear or cheap, and to see the shape of the
programme at a glance.

Key relationship: **a layer's attachment point should equal the top of the layer
below it.** Gaps mean uninsured bands; overlaps mean paying twice.

---

## 2. The two problems to solve

1. **The retention block renders in the wrong place.** It is appended last into
   a `flex-direction: column-reverse` container, so it appears at the *top* of
   the tower. It is the *first* 5m of loss and belongs at the bottom, beneath
   Layer 1. The picture currently contradicts the numbers.

2. **Nothing shows whether the layers fit together.** Set Layer 2's attachment
   to 15m and there is a silent 5m gap with no cover, drawn as though the tower
   were continuous. Gaps and overlaps must be visible.

Beyond fixing those, the redesign should make the tower genuinely informative:
the current version is a stack of coloured bars where **height is proportional
to limit only**, so it conveys size but not position, and nothing shows where a
given loss would land.

---

## 3. Hard constraints — read these before writing any code

The answer is unusable if it breaks any of these.

- **Vanilla JavaScript, ES modules, no build step.** No React, no Vue, no JSX,
  no TypeScript, no Tailwind, no CSS-in-JS, no npm packages. The app is served
  as static files and has zero dependencies.
- **Rendering style:** a function returns an HTML string, which is assigned to a
  container's `innerHTML`. Inline SVG is welcome and probably the right tool.
- **All colour must come from CSS custom properties** (listed below). Do not
  hardcode hex values except the tower palette already provided. The app has a
  dark theme behind `:root[data-theme="dark"]`, so anything hardcoded breaks it.
- **Must work from 320px to 1400px wide.** The container is roughly 380–620px on
  desktop and full-width on mobile.
- **No external requests** — no fonts, images, icon libraries or CDN scripts.
- **Keep the existing function signature** `paintTower()` and the mount target
  `#tower-viz`, or state clearly what you changed and why.
- Fonts available: `'IBM Plex Sans'` (body), `'IBM Plex Mono'` (all numbers),
  `'Fraunces'` (headings). Numbers use `font-variant-numeric: tabular-nums`.

---

## 4. The current code, verbatim

### The renderer — `src/js/views/broker/treaty.view.js`

```js
function paintTower() {
  const top = towerTop(layers) || 1;
  const retention = baseRetention(layers);

  const layerBlocks = layers.map((l, i) => {
    const h = Math.max(28, l.limit / top * 220);
    const rol = rateOnLine(l.limit, enteredPremium(l, i));
    return `<div class="layer" style="height:${h}px; background:${TOWER_COLORS[i % TOWER_COLORS.length]};">
      <span>Layer ${i + 1} · ${fmt(l.limit)} xs ${fmt(l.ret)}</span>
      <span class="mono">ROL ${rol.toFixed(1)}%</span>
    </div>`;
  }).join("");

  const retentionBlock = retention > 0
    ? `<div class="retention" style="height:${Math.min(Math.max(20, retention / top * 220), 60)}px;">Cedant retention — ${fmt(retention)}</div>`
    : "";

  mount("#tower-viz", layerBlocks + retentionBlock);
}
```

### The styles — `src/styles/components/tower.css`

```css
.tower{ display:flex; flex-direction:column-reverse; gap:2px; }
.tower .layer{ border-radius:6px; padding:8px 12px; color:#fff; font-size:12px;
  display:flex; justify-content:space-between; align-items:center; gap:8px; }
.tower .retention{ background:repeating-linear-gradient(45deg, var(--surface-2),
  var(--surface-2) 6px, var(--line) 6px, var(--line) 12px);
  color:var(--ink-soft); border-radius:6px; padding:6px 12px; font-size:11.5px;
  text-align:center; }
```

### Data shape

`layers` is an array, lowest layer first:

```js
[
  { limit: 5000000,  ret: 5000000,  rol: 8.5 },   // ret = attachment point
  { limit: 10000000, ret: 10000000, rol: 4.2 },
  { limit: 25000000, ret: 20000000, rol: 1.8 },
]
```

A layer may also carry `premium` (a number) once the user types one; when absent
it is derived as `limit * rol / 100`.

### Helpers already available — `src/js/domain/xol.js`

```js
rateOnLine(limit, premium)   // → percentage
towerTop(layers)             // → highest point any layer reaches
baseRetention(layers)        // → lowest attachment point in the tower
layerPremium(layer)          // → explicit premium, else derived from rol
```

### Formatting — `src/js/core/format.js`

```js
fmt(4650000)      // → "USD 4.65m"   compact
fmtFull(4650000)  // → "USD 4,650,000"
pct(59.94)        // → "59.9%"
```

### Palette — `src/js/core/config.js`

```js
export const TOWER_COLORS = ["#b1701c", "#1f6f78", "#3a5f8a", "#a97a2f", "#7a5aa8"];
```

---

## 5. Design tokens — use these, not hex values

```css
--ink: #10192b;          /* primary text        */
--ink-soft: #3a4457;     /* secondary text      */
--bg: #ffffff;
--surface: #ffffff;
--surface-2: #f3f4f6;    /* subtle fills        */
--line: rgba(16,25,43,.12);
--line-soft: rgba(16,25,43,.07);
--marine: #1f6f78;       /* primary accent      */
--marine-ink: #123f45;
--marine-tint: #e2eeee;
--brass: #a97a2f;
--brass-tint: #f3e6cd;
--good: #1e7a4c;   --good-tint: #e2f1e7;
--warn: #b1701c;   --warn-tint: #f7ecd8;
--bad:  #a83a3a;   --bad-tint:  #f6e3e1;
--info: #3a5f8a;   --info-tint: #e5ecf5;
--radius: 10px;
--shadow: 0 1px 2px rgba(16,25,43,.05), 0 6px 20px -10px rgba(16,25,43,.14);
```

Every one of these is redefined under `:root[data-theme="dark"]`, so using the
variables means dark mode works for free.

House style: restrained, editorial, dense with information but calm. Thin
1px borders, generous whitespace, muted institutional colour. It should look
like a professional financial instrument, not a consumer dashboard. No gradients
beyond the existing ones, no drop shadows on small elements, no animation
beyond short functional transitions.

---

## 6. What to deliver

1. **A replacement `paintTower()` function**, complete and runnable, in the same
   vanilla style (template string → `innerHTML`).
2. **The CSS to accompany it**, using only the tokens above.
3. **A short rationale** — 5–10 sentences on what you changed and why, in terms
   of what a reinsurance broker needs to read off the picture.

Please also say explicitly what you did about:
- the retention sitting at the bottom where it belongs
- gaps and overlaps between layers being visible
- whether vertical position now represents the actual loss scale (0 → tower top)
  rather than each band being sized only by its own limit

## 7. Questions worth considering — not requirements

Ignore any that do not earn their place:

- Should the vertical axis be **linear in money**, so a 25m layer is genuinely
  five times a 5m layer? That is more honest but makes small lower layers
  unreadably thin. Is a broken or compressed scale better, and if so how do you
  signal it?
- Should there be an **axis with monetary gridlines** (0, 10m, 20m, 30m, 45m) so
  attachment points can be read off directly?
- Would a **"where would a loss of X land"** marker help — a draggable line that
  shows which layers a given loss pierces and how far each is used?
- Should **rate on line be encoded visually** (opacity, width, a small bar)
  rather than only printed as text, so the price gradient up the tower is
  visible at a glance?
- How should an **empty tower** (no layers yet) read?
- How should a tower with **many layers** (8–10) degrade?

---

## 8. Do not change

- The domain functions in `xol.js` — they are pure, tested and used elsewhere.
- The `layers` data shape.
- The layer editor above the tower (the rows of number inputs).
- The reinstatement calculator in the right-hand column.
