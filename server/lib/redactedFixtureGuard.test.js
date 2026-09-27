/**
 * The failure this prevents is quiet, which is why it is a hard refusal.
 *
 * Redacting the committed fixtures made the repository safe to publish. Two of
 * those fixtures are inserted verbatim into `coaches.full_name` and
 * `coaches.email`, so re-running an applier against the published copy would
 * have written `coach-<uuid>@redacted.invalid` into the database and reported
 * success. Nothing downstream would have flagged it: it is a well-formed
 * address at a domain that does not exist.
 */
import { describe, it, expect } from 'vitest';
import { assertUnredacted, redactionMarkers } from './redactedFixtureGuard.js';

describe('redacted fixtures cannot reach the database', () => {
  it('refuses a redacted address, and says where the real one is', () => {
    const f = { entries: [{ name: 'A', email: 'coach-abc-123@redacted.invalid' }] };
    expect(() => assertUnredacted(f, 'phase6c3_core_acquisition_fixture.json'))
      .toThrow(/REDACTED published copy[\s\S]*audit-fixtures\/phase6c3_core_acquisition_fixture\.json/);
  });

  it('refuses a withheld name even when the address survived', () => {
    const f = [{ coach_name: '[name withheld — coach abc]', email: 'real@school.edu' }];
    expect(() => assertUnredacted(f)).toThrow(/name withheld/);
  });

  it('refuses the unlinkable fallback token too', () => {
    expect(redactionMarkers({ a: '[withheld]@redacted.invalid' }).length).toBeGreaterThan(0);
  });

  it('passes a genuine fixture through unchanged', () => {
    const f = { entries: [{ name: 'Real Person', email: 'real.person@school.edu' }] };
    expect(assertUnredacted(f, 'x.json')).toBe(f);
  });

  it('checks nested structures, not just the top level', () => {
    const f = { a: { b: [{ c: { d: 'x@redacted.invalid' } }] } };
    expect(() => assertUnredacted(f)).toThrow();
  });
});
