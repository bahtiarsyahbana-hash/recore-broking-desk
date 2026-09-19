/**
 * Claims — every notification tested against its program's layers, with the
 * credit-control hold that stops a claim proceeding on unpaid premium.
 */
import { mount, onAction } from "../../core/dom.js";
import { fmtFull } from "../../core/format.js";
import { state } from "../../core/store.js";
import { on, TOPICS } from "../../core/events.js";
import { statusPill } from "../../ui/badges.js";
import { icons } from "../../ui/icons.js";
import { paginate, paginationControls, createPager } from "../../ui/pagination.js";
import { advanceClaim, registerClaim, premiumSettled, isHeldByCreditControl }
  from "../../services/claims.service.js";

const pager = createPager(() => claimsView.refresh());

/**
 * `i` is the claim's index in the full list, not on the page: the Process
 * button dispatches on it, so paginating must not renumber it.
 */
function claimRow(claim, i) {
  const paid = premiumSettled(claim);
  const held = isHeldByCreditControl(claim);
  const action = held
    ? `<button class="btn ghost" style="padding:5px 10px;" disabled title="Premium outstanding — cleared by credit control before this claim can proceed">Held</button>`
    : `<button class="btn ghost" style="padding:5px 10px;" data-action="advance" data-i="${i}">Process</button>`;

  return `<tr>
    <td>${claim.dol}</td>
    <td>${claim.program}</td>
    <td>${claim.cause}</td>
    <td>${claim.layer}</td>
    <td class="num">${fmtFull(claim.reserve)}</td>
    <td>${statusPill(paid ? "Paid" : "Overdue")}</td>
    <td>${statusPill(held ? "Pending Credit Control" : claim.status)}</td>
    <td>${action}</td>
  </tr>`;
}

export const claimsView = {
  id: "claims",

  render: () => `<section class="view">
    <div class="view-head">
      <div>
        <h1>Claims</h1>
        <p>Every claim tested against its program's layers automatically, with reserve movement tracked to the technical account.</p>
      </div>
      <button class="btn primary" data-action="register">${icons.plus}Register Claim</button>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>Date of loss</th><th>Program</th><th>Cause</th><th>Layer allocation</th>
          <th class="num">Reserve</th><th>Premium</th><th>Status</th><th></th>
        </tr></thead>
        <tbody id="claims-body"></tbody>
      </table>
    </div>
    <div id="claims-pager"></div>
  </section>`,

  mount() {
    pager.wire("#view-root");
    onAction("#view-root", {
      "register": () => registerClaim(),
      "advance": ({ i }) => advanceClaim(+i),
    });
  },

  refresh() {
    // Pair each claim with its real index before slicing, so the page shows
    // rows 11-20 while their buttons still address claims 11-20.
    const indexed = state.claims.map((claim, index) => ({ claim, index }));
    const page = paginate(indexed, pager.page);
    mount("#claims-body", page.items.map(({ claim, index }) => claimRow(claim, index)).join(""));
    mount("#claims-pager", paginationControls(page, { unit: "claims" }));
  },
};

// Claims are gated on premium settlement, so a placement change can free a hold.
[TOPICS.CLAIMS, TOPICS.PROGRAMS].forEach((topic) =>
  on(topic, () => { if (document.getElementById("claims-body")) claimsView.refresh(); })
);
