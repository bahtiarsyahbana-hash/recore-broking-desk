/**
 * Submission service — risks and renewals the cedant portal sends into the
 * desk's placement queue. They sit as pending until a broker works them up
 * into a slip through the submission wizard.
 */
import { state } from "../core/store.js";
import { emit, TOPICS } from "../core/events.js";

/** Queue a risk or renewal request from the cedant portal. */
export function submitRisk({ cls, type, amount, notes }) {
  const submission = { cls, type, amount, notes, received: new Date() };
  state.pendingSubmissions.unshift(submission);
  emit(TOPICS.SUBMISSIONS, submission);
  return submission;
}

export const pendingSubmissions = () => state.pendingSubmissions;
