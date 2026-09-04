/**
 * Operator-facing presentation for the broader programme context.
 *
 * One kind today, and the section is deliberately not padded to look fuller.
 * COACH_CONTEXT says who is in charge and how much of their time in post we
 * actually watched. That is provenance for everything above it — a recruiting
 * record that predates the current coach reads differently from one that does
 * not — and it is not a reason to write to anybody.
 *
 * `windowBounded` IS THE SAFETY RULE HERE, and it exists because of a real
 * error. When it is true, `since` is the earliest season we looked at, not the
 * year the coach was appointed: Notre Dame's 2022 and 2023 staff pages both
 * came back unreadable, the segment started at 2024, and the evidence read
 * "two seasons into the job" about a man who had held it since 2018. The
 * generator carries the flag so a renderer cannot repeat that, and 1,341 of
 * 2,088 real items are bounded — the majority, not an edge case. A bounded
 * item gets "for at least N seasons" and no year at all.
 *
 * `context` IS NOT RENDERED. It reads ESTABLISHED or NEW, and NEW means "two
 * seasons or fewer AND we know when they started". ESTABLISHED is therefore
 * everything else, including every case where we have no idea how long they
 * have been there. Printing "established" over that residue would assert
 * tenure this system has not measured. The observable facts say more, honestly.
 *
 * NOTHING HERE INFERS INTENT. A long tenure is not stability, a short one is
 * not a rebuild, and neither is a reason to expect a reply.
 */

const n = (v) => (Number.isFinite(v) ? v : null);

const CONTEXT_COPY = Object.freeze({
  COACH_CONTEXT: (f) => {
    if (!f.coach || !n(f.seasonsObserved)) return null;
    const seasons = f.seasonsObserved;
    const plural = seasons === 1 ? 'season' : 'seasons';

    /**
     * The tenure line, and the whole reason this module exists.
     *
     * Unbounded, the appointment year was observed and may be named. Bounded,
     * it may not — the phrasing says how much we watched and stops, because
     * "since 2024" would be a claim about a year nobody looked at.
     */
    const tenure = f.windowBounded
      ? `In post for at least ${seasons} ${plural}`
      : `In post since ${f.since}`;

    return {
      headline: `Head coach: ${f.coach}`,
      tenure,
      detail: [
        f.windowBounded
          ? `${seasons} ${plural} of their time in post fall inside the seasons we hold; `
            + 'they may have been there longer.'
          : `Appointed for the ${f.since} season.`,
        n(f.knownThrough) ? `Named in the staff records through ${f.knownThrough}.` : null,
      ].filter(Boolean).join(' '),
      scope: 'programme',
    };
  },
});

/** Every kind this module can present. Used by its tests, not the UI. */
export const CONTEXT_COPY_KINDS = Object.freeze(Object.keys(CONTEXT_COPY));

/** Presentation content for one context item, or null. */
export function contextCopyFor(item) {
  const build = CONTEXT_COPY[item?.kind];
  if (!build) return null;
  const content = build(item.facts ?? {});
  if (!content?.headline) return null;
  return { tenure: null, detail: null, ...content };
}

/**
 * The measured window and what could not be read in it, or null.
 *
 * The tri-state is the same shape as elsewhere but NOT the same subject, so
 * the wording differs: here an unread season is a staff page that could not be
 * read, and the distinction the source draws is between a page that said
 * nobody was in post — an answer — and a page that could not be fetched. Only
 * the second lands in `seasonsUnread`, which is why naming them matters: they
 * are why the window starts where it does.
 *
 * FRESHNESS IS NOT SHOWN. This kind sources from `coach_seasons`, but the
 * freshness it carries is the ROSTER scrape's, handed to every generator from
 * the shared programme context — the same mismatch found in the academic
 * section. A staleness warning about roster rows, printed under a coaching
 * record, describes the wrong table. Reported as backend debt, not patched
 * here.
 */
export function contextWindow(item) {
  const w = item?.qualification?.window;
  if (!w) return null;
  const seasons = (w.seasons ?? []).map(String);
  if (!seasons.length) return null;

  const years = seasons.map(Number);
  const contiguous = years.length > 1
    && years[years.length - 1] - years[0] + 1 === years.length;
  const measured = seasons.length === 1
    ? seasons[0]
    : (contiguous ? `${seasons[0]}–${seasons[seasons.length - 1]}` : seasons.join(', '));

  const unread = w.seasonsUnread;
  let coverage = null;
  if (unread === null || unread === undefined) {
    coverage = 'Which seasons we could read is unknown.';
  } else if (unread.length === 1) {
    coverage = `The ${unread[0]} staff record could not be read.`;
  } else if (unread.length > 1) {
    coverage = `The ${unread.slice(0, -1).join(', ')} and ${unread[unread.length - 1]} `
      + 'staff records could not be read.';
  }

  return {
    measured: seasons.length === 1 ? `Staff records read for ${measured}` : `Staff records read across ${measured}`,
    coverage,
  };
}
