/**
 * Intake service — every write to the broker intake queue goes through here.
 *
 * An intake is a request for cover from any channel: a broker typing up a
 * phone call, the cedant portal, an email integration later. The service
 * applies the rules in domain/intake.js, keeps the history, and — on
 * acceptance — hands the structured data to the placement service so the
 * placement starts as a draft slip with the intake as its provenance.
 */
import { state, intakeById, nextIntakeId, currentUser, currentCedant } from "../core/store.js";
import { todayISO } from "../core/config.js";
import { emit, TOPICS } from "../core/events.js";
import { stamp } from "../domain/authority.js";
import {
  canTransitionIntake, intakeEditable, intakeReadiness, intakeToDraft,
} from "../domain/intake.js";
import { createDraftFromIntake } from "./placement.service.js";

const actor = () => currentUser()?.name || "Desk";

function record(intake, action, notes = "") {
  intake.history = intake.history || [];
  intake.history.push({ at: todayISO(), actor: actor(), action, notes: notes || "" });
}

const clean = (v) => (v === "" || v == null ? null : v);

/** The fields a broker may capture; everything else is derived. */
function pick(fields = {}) {
  return {
    cedant: fields.cedant ?? "",
    insuredName: fields.insuredName ?? "",
    cls: fields.cls ?? "",
    requestedType: fields.requestedType ?? "",
    sumInsured: Number(fields.sumInsured) || 0,
    ccy: fields.ccy || "USD",
    rate: clean(fields.rate) == null ? null : Number(fields.rate),
    paymentWarrantyDays: clean(fields.paymentWarrantyDays) == null ? null : Number(fields.paymentWarrantyDays),
    channel: fields.channel || "other",
    receivedFrom: fields.receivedFrom ?? "",
    receivedDate: fields.receivedDate || todayISO(),
    notes: fields.notes ?? "",
  };
}

/**
 * Manual intake: a broker records a request that arrived by email, phone,
 * WhatsApp or in a meeting. It lands as Received — the broker is the one who
 * received it, so there is no separate hand-off step to wait for.
 */
export function createManualIntake(fields) {
  const id = nextIntakeId();
  const intake = {
    id, status: "Received", source: "manual", ...pick(fields),
    createdBy: stamp(currentUser()), placementId: null, history: [],
  };
  record(intake, "Intake created", `Recorded manually from ${intake.channel}`);
  record(intake, "Marked received", "");
  state.intakes.unshift(intake);
  emit(TOPICS.INTAKES, { id, action: "created" });
  return intake;
}

/**
 * Portal intake: the cedant's own submission, arriving through the same queue
 * with `source: "portal"`. The cedant is the actor on the record.
 */
export function createPortalIntake(fields) {
  const id = nextIntakeId();
  const cedant = currentCedant();
  const intake = {
    id, status: "Received", source: "portal",
    ...pick({ ...fields, cedant, channel: "other", receivedFrom: "Cedant portal" }),
    createdBy: { id: currentUser()?.id || "portal", name: cedant, title: "Cedant" },
    placementId: null, history: [],
  };
  intake.history.push({ at: todayISO(), actor: cedant, action: "Submitted from portal", notes: "" });
  state.intakes.unshift(intake);
  emit(TOPICS.INTAKES, { id, action: "created" });
  emit(TOPICS.SUBMISSIONS, { id });
  return intake;
}

/** Correct the captured data while the intake is still open for review. */
export function updateIntake(id, fields, notes = "") {
  const intake = intakeById(id);
  if (!intake || !intakeEditable(intake)) return null;
  Object.assign(intake, pick({ ...intake, ...fields }));
  record(intake, "Details updated", notes);
  emit(TOPICS.INTAKES, { id, action: "updated" });
  return intake;
}

function move(id, to, action, notes) {
  const intake = intakeById(id);
  if (!intake || !canTransitionIntake(intake.status, to)) return null;
  intake.status = to;
  record(intake, action, notes);
  emit(TOPICS.INTAKES, { id, action: to });
  return intake;
}

export const startReview = (id) => move(id, "Under Review", "Review started", "");
export const requestRevision = (id, notes) => move(id, "Revision Requested", "Revision requested", notes);
export const resumeReview = (id, notes) => move(id, "Under Review", "Revision received", notes);
export const declineIntake = (id, notes) => move(id, "Declined", "Declined", notes);

/**
 * Accept the intake and open the placement. Accepting is one act: the intake
 * is frozen as accepted, a Draft Slip is created with a copy of its data, and
 * the two are cross-referenced. The intake is then Converted to Placement.
 *
 * @returns {{ intake, programId } | { error: string[] }}
 */
export function acceptIntake(id, notes = "") {
  const intake = intakeById(id);
  if (!intake || !canTransitionIntake(intake.status, "Accepted")) return { error: ["This intake cannot be accepted from its current status."] };
  const findings = intakeReadiness(intake);
  if (findings.length) return { error: findings };

  intake.status = "Accepted";
  record(intake, "Accepted", notes);

  const programId = createDraftFromIntake(intakeToDraft(intake));
  intake.status = "Converted to Placement";
  intake.placementId = programId;
  record(intake, "Converted to placement", programId);

  emit(TOPICS.INTAKES, { id, action: "converted", programId });
  return { intake, programId };
}

/** Open intakes, newest first — the broker's queue. */
export const intakeQueue = () => state.intakes;

/** Intakes visible to a cedant on the portal: their own, any status. */
export const intakesForCedant = (cedant) => state.intakes.filter((i) => i.cedant === cedant);
