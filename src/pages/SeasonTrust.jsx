import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CircleAlert, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Link } from 'react-router-dom';
import { seasonTrust } from '@/api/client';
import { cn } from '@/lib/utils';

/**
 * Historical season trust — the operator review queue.
 *
 * WHAT THIS SCREEN IS FOR. Thirteen programme-seasons carry a machine finding
 * that nothing establishes WHICH season their rows represent. That is a
 * statement about missing provenance, not a finding that the rows are wrong,
 * and only a person can decide whether Thriv3 should keep using them.
 *
 * SO THE SCREEN MUST NOT DECIDE. The machine's finding and the human's
 * conclusion are different kinds of claim and are rendered as separate,
 * differently-styled blocks — the same rule L7K put on the roster-gap screen.
 * Neither disposition is pre-selected, no default is offered, and nothing here
 * ranks the cases or suggests which way any of them should go. A reason must
 * be typed before the control will submit.
 *
 * ABSENCE IS RENDERED AS ABSENCE. `pageSeason`, `fetchedAt` and `parser` are
 * null for every record diagnosed before L7Z began recording them. They read
 * UNKNOWN — never "none", never blank, and never quietly omitted, because a
 * missing fact is the substance of this diagnosis rather than a gap in the
 * display.
 */

const FILTERS = ['Unresolved', 'All', 'Reviewed'];

const SPORT = { 'mens-soccer': "Men's", 'womens-soccer': "Women's" };
const sportLabel = (s) => SPORT[s] ?? s;

const DIAGNOSIS_LABEL = {
  SEASON_IDENTITY_UNPROVEN: 'Season identity unproven',
  PROBABLE_DUPLICATE_CAPTURE: 'Probably the same squad captured twice',
  DEFINITE_MISMATCH: 'Definite mismatch',
};

const ATTRIBUTION_LABEL = {
  NOT_REVIEWED: 'Not reviewed',
  ATTRIBUTED: 'Reviewed',
  LEGACY_UNATTRIBUTED: 'Reviewed before reviewers were recorded',
};

/** The two governed choices, in the operator's words. Nothing is added here. */
const CHOICES = [
  {
    value: 'RETAIN',
    title: 'Keep this programme-season available to Evidence',
    detail: 'The rows stay in use. Nothing is rebuilt and no other programme is affected.',
  },
  {
    value: 'EXCLUDE_FROM_EVIDENCE',
    title: 'Stop Evidence from using this programme-season',
    detail: 'The rows are removed from every Evidence read. This also changes the input the '
      + 'recruiting patterns were derived from, so that sport’s derived data becomes STALE '
      + 'and will refuse to serve until it is rebuilt. The rebuild is a separate, explicit action '
      + 'on this screen.',
  },
];

/** Missing means missing. It never renders as a value. */
function Unknown() {
  return <span className="text-muted-foreground italic">UNKNOWN</span>;
}

function Section({ title, children, className }) {
  return (
    <section className={cn('rounded-lg border border-border p-4', className)}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Field({ k, children }) {
  return (
    <div className="flex gap-3 text-sm py-0.5">
      <dt className="w-52 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function StateBadge({ record }) {
  const a = record.operator.attribution;
  if (a === 'NOT_REVIEWED') return <Badge variant="outline">Unresolved</Badge>;
  if (record.effect.excluded_from_evidence) return <Badge variant="destructive">Excluded</Badge>;
  if (a === 'LEGACY_UNATTRIBUTED') {
    return <Badge variant="secondary">Retained · no reviewer recorded</Badge>;
  }
  return <Badge variant="secondary">Retained</Badge>;
}

export default function SeasonTrust() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [filter, setFilter] = useState('Unresolved');
  const [open, setOpen] = useState(null);
  const [rebuilding, setRebuilding] = useState(null);
  const [rebuildError, setRebuildError] = useState(null);

  async function load() {
    setLoadError(null);
    try { setData(await seasonTrust.queue()); } catch (err) { setLoadError(err.message); }
  }
  useEffect(() => { load(); }, []);

  const records = useMemo(() => {
    const all = data?.records ?? [];
    if (filter === 'Unresolved') return all.filter((r) => r.operator.attribution === 'NOT_REVIEWED');
    if (filter === 'Reviewed') return all.filter((r) => r.operator.attribution !== 'NOT_REVIEWED');
    return all;
  }, [data, filter]);

  const s = data?.summary;
  /*
   * THREE STATES, NOT TWO. The first version of this screen asked only whether
   * the state was FRESH and called everything else "stale", which put the word
   * STALE and a Rebuild button in front of a LEGACY_UNVERIFIED materialisation
   * on the deployed environment. They are different facts with different
   * remedies:
   *
   *   STALE              a build exists and the input has moved since. A
   *                      rebuild is exactly the right action, and the digest
   *                      it stamps is verifiable against the roster it read.
   *
   *   LEGACY_UNVERIFIED  NO build record exists at all, so nothing can say
   *                      what the arrivals were derived from -- or whether
   *                      there are any. `exclusionBlockedReason` already
   *                      treats this as a BLOCKER rather than a chore, and a
   *                      rebuild here would stamp a fresh-looking generation
   *                      over source data nobody has established. That is
   *                      certifying an unknown, which is worse than leaving it
   *                      visibly unknown.
   */
  const materialisation = Object.entries(data?.materialisation ?? {});
  const stale = materialisation.filter(([, m]) => m.state === 'STALE');
  const unverified = materialisation.filter(([, m]) => m.state === 'LEGACY_UNVERIFIED');

  async function rebuild(sport) {
    setRebuilding(sport);
    setRebuildError(null);
    try {
      await seasonTrust.rebuild(sport);
      await load();
    } catch (err) {
      setRebuildError(err.message);
    } finally {
      setRebuilding(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/colleges" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> College DB
        </Link>
        <h1 className="font-heading text-2xl font-bold mt-2">Historical Season Trust</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Programme-seasons where an audit could not establish which season the rows represent.
          That is a statement about missing provenance, not a finding that the rows are wrong.
          Deciding whether Thriv3 should keep using them is a human judgement, and it is recorded
          against you.
        </p>
      </div>

      {s && (
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <span><strong>{s.pending_review}</strong> <span className="text-muted-foreground">unresolved</span></span>
          <span><strong>{s.dispositioned}</strong> <span className="text-muted-foreground">decided</span></span>
          <span><strong>{s.excluded_from_evidence}</strong> <span className="text-muted-foreground">excluded from Evidence</span></span>
          <span><strong>{s.total}</strong> <span className="text-muted-foreground">records</span></span>
        </div>
      )}

      {stale.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
          <p className="flex items-start gap-2 text-sm">
            <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
            <span>
              Derived recruiting data is <strong>stale</strong> for {stale.map(([sp]) => sportLabel(sp)).join(' and ')} soccer.
              An exclusion changed the roster those patterns were built from, so Evidence that
              depends on them will refuse to serve until it is rebuilt. Nothing was rebuilt
              automatically.
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {stale.map(([sp, m]) => (
              <Button
                key={sp} size="sm" variant="outline" disabled={rebuilding === sp}
                onClick={() => rebuild(sp)}
              >
                {rebuilding === sp ? 'Rebuilding…' : `Rebuild ${sportLabel(sp)} soccer (generation ${m.generation ?? '—'})`}
              </Button>
            ))}
          </div>
          {rebuildError && <p className="text-sm text-destructive">Rebuild failed: {rebuildError}</p>}
        </div>
      )}

      {unverified.length > 0 && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="flex items-start gap-2 text-sm">
            <CircleAlert className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
            <span>
              Derived recruiting data is <strong>unverified</strong> for
              {' '}{unverified.map(([sp]) => sportLabel(sp)).join(' and ')} soccer — no build
              record exists, so nothing establishes what the recruiting patterns were derived
              from, or whether this database holds any. This is not staleness and a rebuild is
              deliberately not offered: it would stamp a fresh generation over source data
              nobody has established. Exclusions are blocked in this state for the same reason.
            </span>
          </p>
        </div>
      )}

      <div className="flex gap-1.5">
        {FILTERS.map((f) => (
          <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>{f}</Button>
        ))}
      </div>

      {loadError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <CircleAlert className="inline h-4 w-4 mr-1" /> {loadError}
        </div>
      )}

      <div className="space-y-2">
        {records.map((r) => (
          <button
            key={`${r.identity.college_name}|${r.identity.sport}|${r.identity.season}`}
            type="button"
            onClick={() => setOpen(r)}
            className="w-full text-left rounded-lg border border-border p-3 hover:border-primary/50 transition-colors"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium truncate">
                  {r.identity.college_name}
                  <span className="text-muted-foreground font-normal">
                    {' · '}{sportLabel(r.identity.sport)} soccer · {r.identity.season}
                  </span>
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  {DIAGNOSIS_LABEL[r.machine.diagnosis] ?? r.machine.diagnosis}
                  {' · '}{r.review_evidence?.rows ?? 0} roster rows
                  {r.programme.division ? ` · ${r.programme.division}` : ''}
                </div>
              </div>
              <StateBadge record={r} />
            </div>
          </button>
        ))}
        {records.length === 0 && !loadError && (
          <p className="text-sm text-muted-foreground">Nothing in this view.</p>
        )}
      </div>

      {open && (
        <CaseDialog
          record={open}
          writable={data?.write?.enabled}
          writeReason={data?.write?.reason}
          excludeBlocked={data?.write?.exclude_blocked_by_sport?.[open.identity.sport] ?? null}
          onClose={() => setOpen(null)}
          onSaved={async () => { setOpen(null); await load(); }}
        />
      )}
    </div>
  );
}

function CaseDialog({ record, writable, writeReason, excludeBlocked, onClose, onSaved }) {
  const ev = record.review_evidence;
  const op = record.operator;
  const [disposition, setDisposition] = useState('');   // never pre-selected
  const [reason, setReason] = useState('');             // never pre-filled
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const chosen = CHOICES.find((c) => c.value === disposition);
  const blocked = disposition === 'EXCLUDE_FROM_EVIDENCE' && excludeBlocked;
  const ready = disposition && reason.trim() && !blocked && writable;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await seasonTrust.disposition({
        season: record.identity.season,
        college_name: record.identity.college_name,
        sport: record.identity.sport,
        disposition,
        disposition_evidence: reason.trim(),
        // What we believed when this screen was drawn. The server answers 409
        // if it has moved since, which is the case this field exists for.
        expected_disposition: op.disposition ?? null,
      });
      await onSaved();
    } catch (err) {
      // Never render a failed write as a saved decision.
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {record.identity.college_name} · {sportLabel(record.identity.sport)} soccer · {record.identity.season}
          </DialogTitle>
          <DialogDescription>
            Decide whether Thriv3 should keep using this programme-season. Your decision is
            recorded against your account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <Section title="Programme">
            <dl>
              <Field k="Programme">{record.programme.college_name}</Field>
              <Field k="Sport">{sportLabel(record.identity.sport)} soccer</Field>
              <Field k="Season">{record.identity.season}</Field>
              <Field k="Division">{record.programme.division ?? <Unknown />}</Field>
              <Field k="Roster rows held">{ev?.rows ?? <Unknown />}</Field>
              <Field k="Read by Evidence today">
                {record.effect.evidence_exposed ? 'Yes' : 'No'}
                {record.effect.excluded_from_evidence ? ' — currently excluded' : ''}
              </Field>
            </dl>
          </Section>

          <Section title="Machine finding — read only">
            <dl>
              <Field k="Diagnosis">
                {DIAGNOSIS_LABEL[record.machine.diagnosis] ?? record.machine.diagnosis}
                <span className="text-muted-foreground"> ({record.machine.diagnosis})</span>
              </Field>
              <Field k="Diagnosed">{record.machine.diagnosed_at?.slice(0, 10) ?? <Unknown />}</Field>
            </dl>
            <p className="mt-3 text-sm">{record.machine.diagnosis_evidence ?? <Unknown />}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              This is evidence for your review. It is not a recommendation, and it does not say
              the rows are wrong.
            </p>
          </Section>

          <Section title="Provenance — what was recorded when these rows were accepted">
            <dl>
              <Field k="Source page">
                {ev?.source?.url
                  ? <a className="underline break-all" href={ev.source.url} target="_blank" rel="noreferrer">{ev.source.url}</a>
                  : <Unknown />}
              </Field>
              <Field k="Distinct source pages">{ev?.source?.distinctUrls ?? <Unknown />}</Field>
              <Field k="Season the page declared">
                {ev?.source?.pageSeason
                  ? (ev.source.pageSeason[0] === ev.source.pageSeason[1]
                    ? ev.source.pageSeason[0]
                    : `${ev.source.pageSeason[0]}–${ev.source.pageSeason[1]}`)
                  : <Unknown />}
              </Field>
              <Field k="When it was fetched">{ev?.source?.fetchedAt ?? <Unknown />}</Field>
              <Field k="Parser">{ev?.source?.parser ?? <Unknown />}</Field>
            </dl>
            {!ev?.source?.pageSeason && (
              <p className="mt-3 text-xs text-muted-foreground">
                Page-season, fetch time and parser began being recorded after these rows were
                accepted, so nothing was stored for them. UNKNOWN here means not recorded — it
                does not mean the page declared nothing.
              </p>
            )}
          </Section>

          <Section title="Adjacent seasons — context, not a verdict">
            {ev?.seasonsHeld?.length
              ? (
                <dl>
                  <Field k="Seasons this programme holds">
                    {ev.seasonsHeld.map((x) => `${x.season} (${x.rows})`).join(', ')}
                  </Field>
                  {ev.neighbours.length === 0 && (
                    <Field k="Neighbouring seasons">
                      <span className="text-muted-foreground">
                        none — there is no adjacent season to compare against
                      </span>
                    </Field>
                  )}
                  {ev.neighbours.map((n) => (
                    <Field key={n.season} k={`Shared names with ${n.season}`}>
                      {n.sharedNames} of {ev.rows}
                      <span className="text-muted-foreground"> ({n.rows} rows in {n.season})</span>
                    </Field>
                  ))}
                </dl>
              )
              : <Unknown />}
            <p className="mt-3 text-xs text-muted-foreground">
              A page repeating last year&rsquo;s squad and a genuinely stable squad look the same
              in a row count and different here. Neither reading is applied for you.
            </p>
          </Section>

          <Section title="Review history">
            <dl>
              <Field k="Status">{ATTRIBUTION_LABEL[op.attribution] ?? op.attribution}</Field>
              <Field k="Decision">{op.disposition ?? <Unknown />}</Field>
              <Field k="Reviewer">
                {op.reviewed_by_operator_id
                  ?? (op.attribution === 'LEGACY_UNATTRIBUTED'
                    ? <span className="text-muted-foreground">not recorded — decided before reviewers were stored</span>
                    : <Unknown />)}
              </Field>
              <Field k="Reviewed">{op.reviewed_at?.slice(0, 19).replace('T', ' ') ?? <Unknown />}</Field>
              <Field k="Reason given">{op.disposition_evidence ?? <Unknown />}</Field>
              <Field k="Next action">{op.next_action ?? <Unknown />}</Field>
              {op.previous_disposition && (
                <Field k="Previously">
                  {op.previous_disposition}
                  {op.previous_reviewed_at ? ` on ${op.previous_reviewed_at.slice(0, 10)}` : ''}
                </Field>
              )}
            </dl>
          </Section>

          <Section title="Your decision" className="border-primary/30 bg-primary/[0.02]">
            {!writable && (
              <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
                {writeReason ?? 'Writing is unavailable.'}
              </p>
            )}
            <div className="space-y-2">
              {CHOICES.map((c) => (
                <label
                  key={c.value}
                  className={cn(
                    'flex gap-3 rounded-md border p-3 cursor-pointer',
                    disposition === c.value ? 'border-primary bg-primary/5' : 'border-border',
                  )}
                >
                  <input
                    type="radio"
                    name="disposition"
                    className="mt-1"
                    value={c.value}
                    checked={disposition === c.value}
                    onChange={() => setDisposition(c.value)}
                  />
                  <span>
                    <span className="block text-sm font-medium">{c.title}</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">{c.detail}</span>
                    <code className="block text-[11px] text-muted-foreground mt-1">{c.value}</code>
                  </span>
                </label>
              ))}
            </div>

            {blocked && (
              <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                {excludeBlocked}
              </p>
            )}

            <div className="mt-4">
              <Label htmlFor="trust-reason">Why? (required, in your own words)</Label>
              <Textarea
                id="trust-reason"
                className="mt-1.5"
                rows={3}
                placeholder="What you checked, and what it showed."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Stored with your decision. Nothing is written here for you.
              </p>
            </div>

            {error && (
              <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
                Not saved: {error}
              </p>
            )}
          </Section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={!ready || saving}>
            {saving ? 'Saving…' : 'Record decision'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
