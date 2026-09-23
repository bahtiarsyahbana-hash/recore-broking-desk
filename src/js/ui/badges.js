/**
 * Status vocabulary shared by every table and panel.
 *
 * One map from business status to visual tone keeps a "Queried" market and a
 * "Review due" KYC record reading the same way wherever they appear.
 */

const TONE = {
  "Bound": "good", "Confirmed": "good", "Matched": "good", "Agreed": "good",
  "Paid": "good", "Active": "good",
  "Slip Issued": "info", "In Placement": "info", "Sent": "info", "Viewed": "info",
  // Statuses from the five-step model, before preparation and release split.
  "Issue Slip": "info", "Sent for Confirmation": "info",
  // Pre-market: a draft is neutral work in progress; an approval is waiting on
  // someone, so it reads as an action owed rather than a problem.
  "Draft": "neutral", "Pending Approval": "warn",
  "Queried": "warn", "Negotiating": "warn", "Cedant Approval": "warn",
  "Renewal Due": "warn", "Under Review": "warn", "Review due": "warn",
  // Placement lifecycle: market-facing stages read as information, cedant-
  // facing stages as an action owed, capacity secured and bind instructed as good.
  "Placed to Market": "info", "Market Negotiation": "warn", "Backup Secured": "good",
  "Proposal Sent": "info", "Cedant Negotiation": "warn", "Cedant Approved": "good",
  "Bind Instructed": "good",
  // Market responses.
  "Reviewing": "info", "Quoted": "info", "Declined": "bad",
  // Intake queue.
  "Received": "info", "Accepted": "good", "Revision Requested": "warn",
  "Converted to Placement": "good",
  // Document delivery.
  "Issued": "info", "Delivered": "good", "Acknowledged": "good", "Filed": "neutral",
  // A counterparty nobody has onboarded is neither fine nor failing.
  "Not assessed": "neutral",
  "Exception": "bad", "Notified": "bad", "Pending Credit Control": "bad", "Overdue": "bad",
};

/** A pill showing a business status in its house tone. */
export function statusPill(status) {
  return `<span class="pill ${TONE[status] || "neutral"}">${status}</span>`;
}

/** CSS modifier for a placement type badge. */
export function typeClass(type) {
  return type === "Facultative" ? "fac"
       : type === "Quota Share" ? "qs"
       : type === "Surplus"     ? "surplus"
       : "xol";
}

/** Coloured badge naming the placement type. */
export function typeBadge(type) {
  return `<span class="type-badge ${typeClass(type)}">${type}</span>`;
}

/** Badge for a finance document type — class names avoid the space. */
export function financeBadge(type) {
  return `<span class="fin-badge ${type.replace(" ", "-")}">${type}</span>`;
}

/** A compact name + meta row used by the registry pages. */
export function registryRow(name, meta, sideHtml = "", contactHtml = "") {
  return `<div class="reg-row">
    <div class="reg-main">
      <div class="reg-name">${name}</div>
      <div class="reg-meta">${meta}</div>
      ${contactHtml ? `<div class="reg-contact">${contactHtml}</div>` : ""}
    </div>
    ${sideHtml ? `<div class="reg-side">${sideHtml}</div>` : ""}
  </div>`;
}

/**
 * The contact line beneath a registry entry. Shows the person in charge and
 * makes the email actionable, since chasing a slip or a settlement is the whole
 * reason the address is on file. Renders nothing when no contact is recorded.
 */
export function contactLine(entry) {
  const parts = [];
  if (entry.contactName) {
    parts.push(`<span class="pic">${entry.contactName}</span>${
      entry.contactTitle ? ` · ${entry.contactTitle}` : ""}`);
  }
  if (entry.contactEmail) {
    parts.push(`<a href="mailto:${entry.contactEmail}">${entry.contactEmail}</a>`);
  }
  if (entry.contactPhone) parts.push(entry.contactPhone);
  return parts.join(" · ");
}

/** A counterparty's regulatory code, shown only when one is on file. */
export function codeBadge(entry) {
  const code = entry.syndicateNo ? `LSY/${entry.syndicateNo}`
             : entry.lei ? `LEI/${entry.lei}`
             : null;
  return code ? `<span class="reg-code mono" title="Counterparty code used on regulatory returns">${code}</span>` : "";
}

/** Small substatus tag, used on Kanban cards and list rows. */
export function subBadge(label, tone = "neutral") {
  return `<span class="sub-badge ${tone}">${label}</span>`;
}

/** Standard empty state. */
export const emptyState = (message) => `<div class="empty">${message}</div>`;
