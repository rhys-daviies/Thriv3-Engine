import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import EvidencePanel from './EvidencePanel.jsx';

/**
 * The panel an operator reads before pressing send.
 *
 * It had no tests of its own. `CardEvidence` — a second, card-shaped panel
 * removed in H2 — carried them, and it had had no production caller since F4,
 * so the component three composers actually render was covered only through a
 * sibling that nothing rendered. These are the properties that suite defended,
 * moved onto the panel that ships, plus the ones H1 added.
 *
 * What the panel owes the operator is a truthful account of a decision it did
 * not make. Four things follow:
 *
 *   NOTHING IS DESCRIBED IN THE REGISTRY'S WORDS. A kind key on screen makes
 *   an operator decode a constant to learn what was said.
 *   THE SENTENCE IS THE SERVER'S, VERBATIM. The panel has no renderer, so what
 *   it shows is what would be sent — that is the whole reason the wire carries
 *   prose.
 *   SELECTED IS NOT SENT. The licence permits three body claims and the email
 *   carries at most two; a panel that implied otherwise would credit a coach
 *   with reading something they did not.
 *   LOADING, FAILURE AND SILENCE ARE THREE DIFFERENT THINGS, and a server
 *   problem must never read as a fact about the school.
 */

const render = (props) => renderToStaticMarkup(createElement(EvidencePanel, props));
const text = (html) => html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&#8212;/g, '—').replace(/&#8230;/g, '…')
  .replace(/\s+/g, ' ').trim();

/** A wire object in the shape `toWire` produces. */
const wire = (over = {}) => ({
  paragraph: 'I saw you brought Hayden Aish in from New Zealand in 2025.',
  structure: 'RELATIONSHIP_FIRST',
  structureLabel: 'Relationship first',
  structureSource: 'ENGINE',
  structureRefused: null,
  structureOptions: [{ key: 'RELATIONSHIP_FIRST', label: 'Relationship first' }],
  maxEvidence: 4,
  programme: { name: 'Jacksonville', hasSquad: true, hasHistory: true, freshness: null },
  selected: [
    {
      kind: 'COACH_ARRIVAL_SAME_COUNTRY',
      tier: 'FACT',
      category: 'international',
      confidence: 'HIGH',
      text: 'you brought Hayden Aish in from New Zealand in 2025',
      order: 0,
      slot: 'HOOK',
      displayed: true,
    },
  ],
  available: [],
  internal: [],
  otherKnown: [],
  suppressed: [],
  belowThreshold: [],
  rejected: [],
  dispositions: [],
  ...over,
});

const alt = (over = {}) => ({
  kind: 'HISTORICAL_SAME_COUNTRY',
  tier: 'FACT',
  category: 'international',
  confidence: 'HIGH',
  role: 'HOOK',
  text: 'two players from New Zealand have come through the programme since 2022',
  selected: false,
  disposition: 'DEDUPED',
  reason: 'the same connection as COACH_ARRIVAL_SAME_COUNTRY, said another way',
  supersedes: 'COACH_ARRIVAL_SAME_COUNTRY',
  ...over,
});

// ---------------------------------------------------------------------------

describe('loading, failure and silence are three different things', () => {
  it('says it is still looking rather than showing an empty panel', () => {
    expect(text(render({ loading: true }))).toContain('Checking what we can say about this programme');
  });

  it('says a lookup failed, and that the email is still correct', () => {
    const out = text(render({ failed: true }));
    expect(out).toContain('Could not load programme evidence');
    // The distinction that matters: a server problem is not a fact about the
    // school, and the draft it produced is still a valid email.
    expect(out).toContain('The email is still correct');
    expect(out).not.toMatch(/no evidence|nothing to say/i);
  });

  it('renders nothing at all when there is no wire object', () => {
    expect(render({ evidence: null })).toBe('');
  });

  it('distinguishes "we looked and found nothing" from a failure', () => {
    /**
     * The 45% case. It says we HAVE the roster and found nothing specific —
     * not that the lookup failed, and not that the programme is poor. Those
     * are three different messages and only one of them is true here.
     */
    const out = text(render({ evidence: wire({ selected: [], paragraph: '' }) }));
    expect(out).toContain('roster but nothing specific enough to say about it');
    expect(out).not.toMatch(/could not|failed/i);
  });

  it('says the email leads with the athlete when a claim exists but none is chosen', () => {
    const out = text(render({ evidence: wire({ selected: [], paragraph: '', available: [alt()] }) }));
    expect(out).toContain('Nothing selected — the email leads with the athlete');
  });
});

describe('the operator reads prose, never the registry', () => {
  it('names a claim in words rather than by its kind', () => {
    const out = text(render({ evidence: wire() }));
    expect(out).not.toContain('COACH_ARRIVAL_SAME_COUNTRY');
    expect(out).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
  });

  it('prints the server-rendered sentence verbatim', () => {
    // The panel holds no renderer. What it shows is what would be sent, which
    // is the whole reason the wire carries prose and not evidence objects.
    const out = text(render({ evidence: wire() }));
    expect(out).toContain('you brought Hayden Aish in from New Zealand in 2025');
  });

  it('says where in the email a claim will sit, in words', () => {
    const out = text(render({ evidence: wire() }));
    expect(out).toContain('opens the email');
    expect(out).not.toContain('HOOK');
  });

  it('uses the relevance and recognition wording for those slots', () => {
    const relevance = text(render({
      evidence: wire({
        selected: [{ ...wire().selected[0], kind: 'POSITION_GRADUATION', slot: 'RELEVANCE', text: 'three defenders are listed to graduate in 2027 — A, B and C' }],
      }),
    }));
    expect(relevance).toContain('after the introduction');
    const recognition = text(render({
      evidence: wire({
        selected: [{ ...wire().selected[0], kind: 'CONFERENCE_TITLE', slot: 'RECOGNITION', text: 'Congrats on winning the ACC last year.' }],
      }),
    }));
    expect(recognition).toContain('programme recognition, near the end');
  });
});

describe('selected is not sent, and the panel says so', () => {
  it('marks a claim that was chosen and is not carried', () => {
    /**
     * The licence permits three body claims; composition renders at most two.
     * A panel that showed all three as sent would credit a coach with reading
     * something they did not, which is the one thing the log must never do.
     */
    const out = text(render({
      evidence: wire({
        selected: [
          wire().selected[0],
          {
            kind: 'ACADEMIC_FIT', tier: 'FACT', category: 'academic', confidence: 'HIGH',
            text: 'Rhys is looking to study Exercise Science, and Kinesiology is among the programmes you list',
            order: 1, slot: null, displayed: false,
          },
        ],
      }),
    }));
    expect(out).toContain('kept for the record — not in this email');
  });

  it('does not say it about a claim the email carries', () => {
    expect(text(render({ evidence: wire() })))
      .not.toContain('kept for the record');
  });

  it('leaves it out of the summary of what the email says', () => {
    /**
     * H5. "In the email:" listed every SELECTED claim, so on 232 of 3,498 live
     * pairings it printed a sentence eight lines below the same sentence
     * marked "kept for the record — not in this email". The list was right and
     * the summary contradicted it; a panel that disagrees with itself is worse
     * than one that says less.
     */
    const held = {
      kind: 'ACADEMIC_FIT', tier: 'FACT', category: 'academic', confidence: 'HIGH',
      text: 'Kinesiology is among the programmes you list', order: 1, slot: null, displayed: false,
    };
    const out = text(render({ evidence: wire({ selected: [wire().selected[0], held] }) }));
    // Named once — in the list, as held. Not again under "In the email".
    expect(out.split('Kinesiology is among the programmes you list')).toHaveLength(2);
    expect(out).toContain('kept for the record — not in this email');
    // The claim that IS carried appears twice: once in the list, once in the summary.
    expect(out.split('you brought Hayden Aish in from New Zealand in 2025')).toHaveLength(3);
  });

  it('omits the summary entirely when nothing is carried', () => {
    const held = { ...wire().selected[0], displayed: false };
    expect(text(render({ evidence: wire({ selected: [held] }) }))).not.toContain('In the email:');
  });
});

describe('what may be swapped in', () => {
  it('offers a same-connection alternative with the sentence it would send', () => {
    const out = text(render({ evidence: wire({ available: [alt()] }) }));
    expect(out).toContain('Other strong options');
    expect(out).toContain('two players from New Zealand have come through the programme');
  });

  it('offers only alternatives the send path can honour', () => {
    /**
     * H1 narrowed this list to survivors plus same-connection alternatives,
     * and gave the losers a DEDUPED disposition. Before that the panel listed
     * the legacy engine's whole ranking and `applyPrefer` refused fifteen real
     * swaps it had offered.
     */
    const out = text(render({ evidence: wire({ available: [alt()] }) }));
    expect(out).toContain('two players from New Zealand have come through the programme');
    expect(out).not.toContain('HISTORICAL_SAME_COUNTRY');
  });

  it('says why an alternative was not the default', () => {
    /**
     * H5. The reason was on the wire from H1 and printed only for suppressed
     * items, so an operator reading "Other strong options" saw a list of good
     * sentences with nothing to distinguish them from the one that won.
     *
     * The words are the server's. 865 of 880 live alternatives carry a reason
     * and it reads as why-not-this-one — "says the same thing as same-country
     * arrival under this coach" — which is the question an operator is asking
     * at that point in the list.
     */
    const out = text(render({ evidence: wire({ available: [alt()] }) }));
    expect(out).toContain('the same connection as COACH_ARRIVAL_SAME_COUNTRY, said another way');
  });

  it('says nothing at all when the server gave no reason', () => {
    // The other fifteen. The reason is read from the disposition log, which
    // records those kinds as SELECTED and therefore writes no reason for them.
    // A sentence invented here would be the panel's opinion of a decision it
    // did not make.
    const out = text(render({ evidence: wire({ available: [alt({ reason: null })] }) }));
    expect(out).toContain('two players from New Zealand have come through the programme');
    expect(out).not.toMatch(/said another way|not chosen|because/i);
  });

  it('does not promise an alternative a place in the email', () => {
    /**
     * The role is on the wire and deliberately not printed here: "opens the
     * email" is true of the hook that won and a promise about one that has not
     * been chosen. Counted rather than searched — the fixture's SELECTED hook
     * says it once, legitimately, and the assertion is that offering an
     * alternative hook does not make it say it twice.
     */
    const once = text(render({ evidence: wire() }));
    const withAlt = text(render({ evidence: wire({ available: [alt({ role: 'HOOK' })] }) }));
    const count = (s) => s.split('opens the email').length - 1;
    expect(count(once)).toBe(1);
    expect(count(withAlt)).toBe(1);
    expect(withAlt).not.toContain('HOOK');
  });

  it('keeps a suppressed finding collapsed, reason and all', () => {
    // Unchanged by H5, and the difference from an alternative: a suppressed
    // item is behind a count the operator has to open, an alternative is in
    // the list. Both now carry their reason once visible.
    const out = text(render({
      evidence: wire({
        otherKnown: [{
          kind: 'POSTSEASON_RESULT', label: 'Postseason run', family: 'Programme record',
          disposition: 'SUPPRESSED_REDUNDANT', reason: 'says the same thing as conference title',
          text: 'Congrats on the semi-final run last season.', tier: 'FACT', confidence: 'HIGH',
        }],
      }),
    }));
    expect(out).toMatch(/Show 1 suppressed or below-threshold finding/);
    expect(out).not.toContain('says the same thing as conference title');
  });

  it('renders no swap controls when the panel is read-only', () => {
    // The Evidence tab shows the same picture without letting anyone change
    // it: selection belongs to the composer.
    const html = render({ evidence: wire({ available: [alt()] }) });
    expect(html).not.toContain('Move up');
    expect(html).not.toContain('Remove from email');
  });

  it('renders them when a change handler is supplied', () => {
    const html = render({
      evidence: wire({ available: [alt()] }), onSelectionChange: () => {},
    });
    expect(html).toContain('Move up');
    expect(html).toContain('Remove from email');
  });
});

describe('intelligence that may not be emailed', () => {
  const internal = [{ kind: 'POSITION_GROUP_SCARCITY', tier: 'SIGNAL', confidence: 'MEDIUM' }];

  it('is collapsed, counted, and labelled as not permitted', () => {
    const out = text(render({ evidence: wire({ internal }) }));
    expect(out).toMatch(/Show 1 internal-only finding/);
  });

  it('renders no sentence for it, because the wire carries none', () => {
    const html = render({ evidence: wire({ internal }) });
    // The server never rendered these, so there is nothing here to leak. A
    // panel that could write one would be a second copy registry.
    expect(html).not.toContain('light from the outside');
  });
});

describe('the boundary the panel must not cross', () => {
  it('exposes no provenance, because the wire carries none', () => {
    const html = render({
      evidence: wire({ available: [alt()], internal: [{ kind: 'TRANSFER_BEHAVIOUR', tier: 'FACT', confidence: 'HIGH' }] }),
    });
    for (const leak of ['provenance', 'identityMethod', 'coachAttribution', 'roster_players',
      'dedupeGroup', 'baseStrength', 'OCEANIA', 'DEFENSE']) {
      expect(html, leak).not.toContain(leak);
    }
  });

  it('shows the structure it was told, and never picks one', () => {
    const out = text(render({ evidence: wire() }));
    expect(out).toContain('Relationship first');
  });

  it('says out loud when a requested structure was refused', () => {
    const out = text(render({
      evidence: wire({
        structureRefused: { key: 'RELATIONSHIP_FIRST', reason: 'the evidence selected for this programme does not support it' },
      }),
    }));
    expect(out).toContain('was not used');
    expect(out).toContain('does not support it');
  });
});
