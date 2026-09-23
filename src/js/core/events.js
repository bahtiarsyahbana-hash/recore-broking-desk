/**
 * Minimal pub/sub bus.
 *
 * It replaces the prototype's habit of a mutation calling every renderer it can
 * think of. A service publishes what changed; whichever views care subscribe.
 */
const listeners = new Map();

export function on(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
  return () => listeners.get(topic).delete(fn);
}

export function emit(topic, payload) {
  (listeners.get(topic) || []).forEach((fn) => fn(payload));
  (listeners.get("*") || []).forEach((fn) => fn(topic, payload));
}

/** Topics published by the service layer. */
export const TOPICS = {
  PROGRAMS: "programs:changed",
  CLAIMS: "claims:changed",
  BORDEREAUX: "bordereaux:changed",
  FINANCE: "finance:changed",
  SUBMISSIONS: "submissions:changed",
  INTAKES: "intakes:changed",
  REGISTRY: "registry:changed",
  ROLE: "role:changed",
  SEAT: "seat:changed",
  VIEW: "view:changed",
};
