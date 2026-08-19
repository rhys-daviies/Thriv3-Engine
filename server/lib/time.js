/** Every timestamp this subsystem writes is ISO-8601 UTC with an explicit Z. */
export function utcNow() {
  return new Date().toISOString();
}

export function daysAgoIso(days, from = Date.now()) {
  return new Date(from - days * 24 * 60 * 60 * 1000).toISOString();
}
