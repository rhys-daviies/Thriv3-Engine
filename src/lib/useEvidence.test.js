// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useEvidence, evidenceForCollege } from './useEvidence';
import { PROGRAMME_NAMES } from './__fixtures__/programmeNames.js';

/**
 * That a programme name reaches the server exactly as it was given.
 *
 * The hook keys its effect on the name list, which means the list is
 * serialised to a string and read back on the other side — and that round trip
 * is the one place a name can be quietly altered. It survived on a NUL
 * separator for a while: correct, because no programme name contains one, but
 * invisible in review and one formatter away from `join('')`, which would
 * concatenate every name into a single string and split it back into letters.
 *
 * So these tests assert the property rather than the mechanism. Whatever the
 * key is made of, 2,401 real programme names have to come out the other end
 * unchanged, and none of them may be split on anything.
 */

let container;
let root;
let bodies;

const Probe = ({ playerId, names, overrides }) => {
  useEvidence(playerId, names, overrides);
  return null;
};

async function request(names, { playerId = 'p1', overrides = null } = {}) {
  await act(async () => {
    root.render(createElement(Probe, { playerId, names, overrides }));
  });
  return bodies;
}

beforeEach(() => {
  bodies = [];
  vi.stubGlobal('fetch', vi.fn(async (path, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push({ path, ...body });
    // Answer keyed by exactly what was asked for, as the real route does.
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => Object.fromEntries(
        (body.collegeNames ?? []).map((n) => [n, { paragraph: `about ${n}` }]),
      ),
    };
  }));
  global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

/** Every programme name asked about, across however many chunks were sent. */
const asked = () => bodies.flatMap((b) => b.collegeNames);

describe('a multi-word name is one programme, not two', () => {
  it('sends "Sacred Heart" as a single name', async () => {
    // The name that started all this, and the shape of the failure it would
    // cause. Split on a space it goes out as "Sacred" and "Heart"; the server
    // answers honestly about two names it has never heard of, the lookup by
    // exact name finds neither, and the panel renders blank with no error
    // anywhere. This hook never did that — its separator was a NUL — but the
    // sibling operator hook did, so the property is worth pinning here too.
    await request(['Sacred Heart']);
    expect(asked()).toEqual(['Sacred Heart']);
    expect(asked()).not.toContain('Sacred');
    expect(asked()).not.toContain('Heart');
  });

  it('never tokenises a name on whitespace', async () => {
    const names = ['Sacred Heart', 'George Mason', 'Purdue Fort Wayne'];
    await request(names);
    expect(asked()).toEqual(names);
    // No fragment of any of them appears as a name of its own.
    for (const fragment of ['Sacred', 'Heart', 'George', 'Mason', 'Purdue', 'Fort', 'Wayne']) {
      expect(asked()).not.toContain(fragment);
    }
  });

  it('still sends a single-word name unchanged', async () => {
    await request(['Jacksonville']);
    expect(asked()).toEqual(['Jacksonville']);
  });
});

describe('punctuation survives the round trip', () => {
  // Every one of these is a real programme name in the database.
  const REAL = [
    ['a period', 'St. Thomas'],
    ['parentheses', 'Ozarks (AR)'],
    ['an ampersand', 'Davis & Elkins'],
    ['an apostrophe', "Mount St. Mary's"],
    ['a hyphen', 'Carson-Newman'],
    ['an en-dash', 'Embry–Riddle Aeronautical'],
    ['several at once', "King's (PA)"],
  ];

  for (const [label, name] of REAL) {
    it(`preserves ${label}: ${name}`, async () => {
      await request([name]);
      expect(asked()).toEqual([name]);
      // Exactly once — not duplicated by a key that round-trips ambiguously.
      expect(asked().filter((n) => n === name)).toHaveLength(1);
    });
  }

  it('does not trim, collapse or otherwise tidy a name', async () => {
    // Nothing in the database looks like this, but the hook must not be the
    // thing that decides. Normalising here would make the browser and the
    // server disagree about which programme was asked about.
    const odd = ['  Padded  Name  ', 'Tab\tSeparated', 'New\nLine'];
    await request(odd);
    expect(asked()).toEqual(odd);
  });
});

describe('a batch keeps its programmes distinct and in order', () => {
  const BATCH = ['Sacred Heart', 'George Mason', 'Jacksonville', 'St. Thomas'];

  it('asks about exactly four programmes', async () => {
    await request(BATCH);
    expect(asked()).toHaveLength(4);
    expect(asked()).toEqual(BATCH);
  });

  it('sends no fragments', async () => {
    await request(BATCH);
    for (const fragment of ['Sacred', 'Heart', 'George', 'Mason', 'St.', 'Thomas']) {
      expect(asked()).not.toContain(fragment);
    }
  });

  it('maps each response back to the programme that asked for it', async () => {
    await request(BATCH);
    // The lookup callers actually use. A name that did not survive the round
    // trip misses here and reads as "this programme has nothing to say".
    for (const name of BATCH) {
      const found = evidenceForCollege(
        Object.fromEntries(BATCH.map((n) => [n, { paragraph: `about ${n}` }])), name,
      );
      expect(found.paragraph).toBe(`about ${name}`);
    }
  });

  it('chunks a list larger than the route\'s cap without losing a name', async () => {
    // 45 names over the 40-per-request cap: two requests, every name once, and
    // no name split across the boundary.
    const many = Array.from({ length: 45 }, (_, i) => `Multi Word Programme ${i}`);
    await request(many);
    expect(bodies).toHaveLength(2);
    expect(bodies[0].collegeNames).toHaveLength(40);
    expect(bodies[1].collegeNames).toHaveLength(5);
    expect(asked()).toEqual(many);
  });
});

describe('the hook contract is unchanged', () => {
  it('posts to the composer route with the same body shape', async () => {
    await request(['Duke'], { overrides: { prefer: { Duke: ['ACADEMIC_FIT'] } } });
    expect(bodies[0].path).toBe('/api/players/p1/evidence');
    // prefer and preferStructure still travel, and still per programme.
    expect(bodies[0].prefer).toEqual({ Duke: ['ACADEMIC_FIT'] });
    expect(bodies[0]).toHaveProperty('preferStructure');
  });

  it('makes no request without an athlete', async () => {
    await request(['Duke'], { playerId: null });
    expect(bodies).toHaveLength(0);
  });

  it('makes no request with no names', async () => {
    await request([]);
    expect(bodies).toHaveLength(0);
  });

  it('makes no request for a list of nothing but blanks', async () => {
    // What the old separator did incidentally, kept deliberately: an empty
    // list is "nothing asked for", not a 400 rendered as a failed lookup.
    await request(['', null, undefined]);
    expect(bodies).toHaveLength(0);
  });

  it('refetches when the programme list changes', async () => {
    await request(['Duke']);
    await request(['Sacred Heart']);
    expect(bodies.map((b) => b.collegeNames)).toEqual([['Duke'], ['Sacred Heart']]);
  });

  it('does not refetch when handed an equal list in a new array', async () => {
    // The whole reason the key exists: a fresh array literal every render must
    // not be a fresh dependency every render.
    await request(['Sacred Heart', 'Duke']);
    await request(['Sacred Heart', 'Duke']);
    expect(bodies).toHaveLength(1);
  });
});

describe('every real programme name, both sports', () => {
  it('has names carrying the characters that make this worth testing', () => {
    // Not a vacuous sweep: the list genuinely contains each class of thing
    // that could go wrong.
    expect(PROGRAMME_NAMES).toHaveLength(2401);
    const count = (re) => PROGRAMME_NAMES.filter((n) => re.test(n)).length;
    expect(count(/ /)).toBe(1698);
    expect(count(/'/)).toBe(33);
    expect(count(/&/)).toBe(40);
    expect(count(/-/)).toBe(121);
    expect(count(/[()]/)).toBe(151);
    expect(count(/\./)).toBe(41);
    // And nothing that a trim or a whitespace collapse could quietly alter.
    expect(count(/\s\s/)).toBe(0);
    expect(count(/^\s|\s$/)).toBe(0);
    expect(count(/[^\x20-\x7E]/)).toBe(1);
  });

  it('asks about all 2,401 of them, each exactly as written', async () => {
    await request(PROGRAMME_NAMES);
    const sent = asked();
    expect(sent).toHaveLength(PROGRAMME_NAMES.length);
    // Position by position rather than as a set: an ordering change would
    // still map correctly today, but the callers page through this list and
    // the chunk boundaries follow it.
    expect(sent).toEqual(PROGRAMME_NAMES);
  });

  it('splits none of them into fragments', async () => {
    await request(PROGRAMME_NAMES);
    const sent = new Set(asked());
    // Every name is present whole. If any separator ever tokenised one, its
    // pieces would appear here and the name itself would not.
    for (const name of PROGRAMME_NAMES) expect(sent.has(name)).toBe(true);
    expect(sent.size).toBe(new Set(PROGRAMME_NAMES).size);
  });

  it('spreads them over the cap without dropping or duplicating one', async () => {
    await request(PROGRAMME_NAMES);
    expect(bodies).toHaveLength(Math.ceil(PROGRAMME_NAMES.length / 40));
    const counts = new Map();
    for (const n of asked()) counts.set(n, (counts.get(n) ?? 0) + 1);
    const expected = new Map();
    for (const n of PROGRAMME_NAMES) expected.set(n, (expected.get(n) ?? 0) + 1);
    expect(counts).toEqual(expected);
  });
});
