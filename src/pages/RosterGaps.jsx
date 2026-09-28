import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Link } from 'react-router-dom';
import { rosterGaps } from '@/api/client';
import { cn } from '@/lib/utils';

/**
 * The NCAA roster-gap review queue.
 *
 * L7K's finding, carried onto the screen: a machine observation and a human
 * conclusion are different kinds of claim, and the review form must not let one
 * turn into the other. So MACHINE FINDINGS and OPERATOR REVIEW are separate
 * blocks with their own headings, the machine's section is read-only, and
 * `NO_TRUSTED_HOST` — which is a query result, not a judgement — appears there
 * and never in the disposition list.
 *
 * The vocabulary and the allowed pairings come from the server with the queue,
 * so the form cannot drift from the rules the server enforces. The server is
 * still the authority; this only avoids offering a choice it would refuse.
 */

const FILTERS = ['All', 'Unreviewed', 'Reviewed'];

/** Human wording for an enum, with the exact value kept alongside it. */
const LABELS = {
  SOURCE_NOT_AVAILABLE: 'No source found',
  PROGRAMME_STATUS_QUESTION: 'Programme status in question',
  SITE_TEMPORARILY_UNAVAILABLE: 'Site temporarily unavailable',
  RETRY_ACQUISITION: 'Try acquiring again',
  RETRY_AFTER: 'Try again after a date',
  CONFIRM_PROGRAMME_STATUS: 'Someone must confirm the programme status',
  NONE: 'Nothing to do for now',
  NEW_VERIFIED_HOST_CANDIDATES: 'Trusted host, candidates generated',
  NO_TRUSTED_HOST: 'No trusted athletics host',
  AMBIGUOUS_HOST: 'Several hosts, none distinguished',
  EXISTING_CANDIDATE: 'Already holds a source',
};
const label = (v) => LABELS[v] ?? v ?? '—';

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
      <dt className="w-44 shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export default function RosterGaps() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [filter, setFilter] = useState('All');
  const [open, setOpen] = useState(null);

  async function load() {
    setLoadError(null);
    try { setData(await rosterGaps.queue()); } catch (err) { setLoadError(err.message); }
  }
  useEffect(() => { load(); }, []);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    if (filter === 'Unreviewed') return all.filter((r) => r.operator.reviewStatus === 'UNREVIEWED');
    if (filter === 'Reviewed') return all.filter((r) => r.operator.reviewStatus === 'REVIEWED');
    return all;
  }, [data, filter]);

  const s = data?.summary;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/colleges" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> College DB
        </Link>
        <h1 className="font-heading text-2xl font-bold mt-2">NCAA Roster Gaps</h1>
        <p className="text-sm text-muted-foreground">
          Programmes the registry lists with no roster data. Review records what a person
          concluded; it never starts an acquisition or changes the registry.
        </p>
      </div>

      {s && (
        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <span><strong>{s.legitimateGaps}</strong> <span className="text-muted-foreground">open gaps</span></span>
          <span><strong>{s.reviewed}</strong> <span className="text-muted-foreground">reviewed</span></span>
          <span><strong>{s.unreviewed}</strong> <span className="text-muted-foreground">unreviewed</span></span>
          <span><strong>{s.retryEligible}</strong> <span className="text-muted-foreground">retry eligible</span></span>
          <span className="text-muted-foreground">
            {s.ncaaWithRoster} of {s.ncaaWithRoster + s.legitimateGaps} legitimate programmes hold a roster
            {s.registryDuplicates ? ` (${s.registryDuplicates} duplicate registry rows excluded)` : ''}
          </span>
        </div>
      )}

      <div className="flex gap-1.5">
        {FILTERS.map((f) => (
          <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>{f}</Button>
        ))}
      </div>

      {loadError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <strong>The queue could not be loaded.</strong> {loadError}
          <Button size="sm" variant="outline" className="ml-3" onClick={load}>Try again</Button>
        </div>
      )}
      {!data && !loadError && <p className="text-sm text-muted-foreground">Loading the queue…</p>}

      {data && (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium text-muted-foreground">Programme</th>
                <th className="px-4 py-2 font-medium text-muted-foreground">Division</th>
                <th className="px-4 py-2 font-medium text-muted-foreground">What the machine knows</th>
                <th className="px-4 py-2 font-medium text-muted-foreground">Review</th>
                <th className="px-4 py-2 font-medium text-muted-foreground">Next</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className={cn(i % 2 === 1 && 'bg-muted/20')}>
                  <td className="px-4 py-2">
                    <span className="font-medium">{r.school}</span>
                    <span className="text-muted-foreground"> · {r.gender}</span>
                  </td>
                  <td className="px-4 py-2"><Badge>{r.division}</Badge></td>
                  <td className="px-4 py-2">
                    <span>{label(r.machine.candidateState)}</span>
                    {r.machine.candidates > 0 && (
                      <span className="text-muted-foreground"> · {r.machine.candidates} candidates</span>
                    )}
                    {r.machine.recordedStale && (
                      <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
                        <CircleAlert className="h-3 w-3" /> recorded reason out of date
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {r.operator.reviewStatus === 'REVIEWED'
                      ? <span title={r.operator.disposition}>{label(r.operator.disposition)}</span>
                      : <span className="text-muted-foreground">Unreviewed</span>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.operator.nextAction ? label(r.operator.nextAction) : '—'}
                    {r.operator.retryAfter && <span> · {r.operator.retryAfter.slice(0, 10)}</span>}
                    {!r.retryEligible && <span className="ml-2 text-xs">[held]</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button size="sm" variant="outline" onClick={() => setOpen(r)}>Review</Button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Nothing here.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <ReviewDialog
          row={open}
          vocabulary={data.vocabulary}
          season={data.season}
          onClose={() => setOpen(null)}
          onSaved={async () => { setOpen(null); await load(); }}
        />
      )}
    </div>
  );
}

function ReviewDialog({ row, vocabulary, season, onClose, onSaved }) {
  const existing = row.operator;
  const [disposition, setDisposition] = useState(existing.disposition ?? '');
  const [nextAction, setNextAction] = useState(existing.nextAction ?? '');
  const [retryAfter, setRetryAfter] = useState(existing.retryAfter ? existing.retryAfter.slice(0, 10) : '');
  const [evidence, setEvidence] = useState(existing.evidence ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const allowed = useMemo(
    () => vocabulary.dispositions.find((d) => d.value === disposition)?.allowedActions ?? [],
    [vocabulary, disposition],
  );
  // Changing the condition can invalidate the action, so drop one that no
  // longer applies rather than submitting a pair the server would refuse.
  useEffect(() => {
    if (nextAction && !allowed.includes(nextAction)) setNextAction('');
  }, [allowed, nextAction]);

  const needsDate = nextAction === 'RETRY_AFTER';
  const ready = disposition && nextAction && evidence.trim() && (!needsDate || retryAfter);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await rosterGaps.review({
        season,
        school: row.school,
        sport: row.sport,
        disposition,
        nextAction,
        retryAfter: needsDate ? new Date(`${retryAfter}T00:00:00.000Z`).toISOString() : null,
        evidence: evidence.trim(),
      });
      await onSaved();
    } catch (err) {
      // Never show it as saved when persistence failed.
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{row.school} · {row.sport === 'mens-soccer' ? "Men's" : "Women's"} soccer</DialogTitle>
          <DialogDescription>
            Record what you concluded. Saving does not attempt an acquisition or change the registry.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <Section title="Programme">
            <dl>
              <Field k="School">{row.school}</Field>
              <Field k="Sport">{row.sport}</Field>
              <Field k="Division">{row.division}</Field>
              <Field k="Programme key"><code className="text-xs">{row.key}</code></Field>
              {row.unitid != null && <Field k="Unitid">{row.unitid}</Field>}
            </dl>
          </Section>

          <Section title="Machine findings — read only">
            <dl>
              <Field k="Source planner">
                {label(row.machine.candidateState)}
                <span className="text-muted-foreground"> ({row.machine.candidateState})</span>
              </Field>
              <Field k="Candidates generated">{row.machine.candidates}</Field>
              {row.machine.fetchHosts?.length > 0 && (
                <Field k="Approved fetch hosts">{row.machine.fetchHosts.join(', ')}</Field>
              )}
              <Field k="Last acquisition">{row.machine.lastStatus ?? 'no attempt recorded'}</Field>
              <Field k="Last stage">{row.machine.lastStage ?? '—'}</Field>
              <Field k="Failure class">{row.machine.lastFailureClass ?? '—'}</Field>
              <Field k="Recorded reason">
                <span className="text-muted-foreground">{row.machine.lastError ?? '—'}</span>
              </Field>
              <Field k="Attempts recorded">{row.machine.lastAttempts}</Field>
              <Field k="Retry eligibility">
                {row.retryEligible ? 'Eligible' : 'Held'}
                <span className="text-muted-foreground"> — {row.retryReason}</span>
              </Field>
            </dl>
            {row.machine.recordedStale && (
              <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                The recorded reason says there was nothing to try, and the planner offers
                {' '}{row.machine.candidates} candidates today. Durable failure reasons froze at the first
                attempt and are rediagnosed on the next real one — do not read this as a current diagnosis.
              </p>
            )}
          </Section>

          <Section title="Operator review" className="border-primary/30 bg-primary/[0.02]">
            {existing.previousDisposition && (
              <p className="text-xs text-muted-foreground mb-3">
                Previously reviewed as {label(existing.previousDisposition)}
                {existing.previousReviewedAt ? ` on ${existing.previousReviewedAt.slice(0, 10)}` : ''}.
              </p>
            )}
            <div className="space-y-3">
              <div>
                <Label>What did you find?</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {vocabulary.dispositions.map((d) => (
                    <Button
                      key={d.value}
                      type="button"
                      size="sm"
                      variant={disposition === d.value ? 'default' : 'outline'}
                      onClick={() => setDisposition(d.value)}
                    >
                      {label(d.value)}
                    </Button>
                  ))}
                </div>
              </div>

              {disposition && (
                <div>
                  <Label>What should happen next?</Label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {allowed.map((a) => (
                      <Button
                        key={a}
                        type="button"
                        size="sm"
                        variant={nextAction === a ? 'default' : 'outline'}
                        onClick={() => setNextAction(a)}
                      >
                        {label(a)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {needsDate && (
                <div>
                  <Label htmlFor="retry-after">Try again after</Label>
                  <Input
                    id="retry-after"
                    type="date"
                    className="max-w-xs mt-1.5"
                    value={retryAfter}
                    onChange={(e) => setRetryAfter(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Required. The programme becomes retry-eligible again once this date passes.
                  </p>
                </div>
              )}

              <div>
                <Label htmlFor="evidence">Why? One sentence.</Label>
                <Textarea
                  id="evidence"
                  className="mt-1.5"
                  rows={2}
                  maxLength={vocabulary.evidenceMaxLength}
                  placeholder="What you saw that led to this conclusion."
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {evidence.trim().length}/{vocabulary.evidenceMaxLength}
                </p>
              </div>
            </div>
          </Section>

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <strong>That review was not saved.</strong> {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={!ready || saving}>
            {saving ? 'Saving…' : 'Save review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
