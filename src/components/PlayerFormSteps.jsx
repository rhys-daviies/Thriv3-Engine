import React, { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import ChapterEditor from '@/components/ChapterEditor';
import PublicProfileFields from '@/components/PublicProfileFields';
import { extractVideoId } from '@shared/youtube';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { RotateCcw } from 'lucide-react';
import AbilitySlider from '@/components/AbilitySlider';
import PriorityTokens from '@/components/PriorityTokens';
import ConferencePicker from '@/components/ConferencePicker';
import { US_STATES, COUNTRIES, ORIGINS } from '@/lib/locations';
import { DIVISIONS } from '@shared/divisions.js';
// The bands and their ceilings live together, so the picker cannot offer a
// band the model has no ceiling for.
import { BUDGET_BANDS } from '@shared/matching/constants.js';
import { positionLabel } from '@shared/positions.js';
import { TEMPLATE_VARIABLES, DEFAULT_EMAIL_SUBJECT, DEFAULT_EMAIL_TEMPLATE } from '@/lib/emailTemplate';
import { cn } from '@/lib/utils';
import { entities } from '@/api/client';

// The person who plays there, so the word reads the same way in the form, on
// the profile and in the email. Stored as written and canonicalised on read
// (shared/positions.js), so rows saved as 'Defense' keep matching.
const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
// Imported, not restated. This list was a third copy of the division
// vocabulary and would have gone on offering five options after USCAA was
// added, so an athlete could never have said they were open to it.


/**
 * Snaps a stored position onto the option the picker actually offers.
 *
 * The options are person-nouns now, so a row saved as 'Defense' or 'Midfield'
 * matches no SelectItem and the trigger renders blank — not even the
 * placeholder. The value is still in form state, so saving preserves it, but
 * it reads as an unset required field and invites the operator to "fix" a
 * profile that was never broken. 'None' is the secondary-position sentinel
 * and is left alone.
 */
function positionOption(stored) {
  if (!stored || stored === 'None') return stored || '';
  return positionLabel(stored);
}

function defaultsFrom(initialData) {
  return {
    full_name: initialData?.full_name || '',
    email: initialData?.email || '',
    phone: initialData?.phone || '',
    recruiting_class_year: initialData?.recruiting_class_year || '',
    high_school: initialData?.high_school || '',
    city: initialData?.city || '',
    state: initialData?.state || '',
    position: positionOption(initialData?.position || ''),
    secondary_position: positionOption(initialData?.secondary_position || 'None'),
    preferred_divisions: initialData?.preferred_divisions || [],
    football_ability: initialData?.football_ability ?? 5,
    gpa: initialData?.gpa ?? '',
    sat_score: initialData?.sat_score ?? '',
    act_score: initialData?.act_score ?? '',
    highlights_url: initialData?.highlights_url || '',
    video_chapters: initialData?.video_chapters || [],

    // Coach-facing page fields. All optional — the page omits what is blank.
    commitment_status: initialData?.commitment_status || '',
    nationality: initialData?.nationality || '',
    origin: initialData?.origin || (initialData?.nationality && initialData.nationality !== 'USA' ? 'International' : 'USA'),
    club_name: initialData?.club_name || '',
    height_cm: initialData?.height_cm ?? '',
    weight_kg: initialData?.weight_kg ?? '',
    ncaa_eligibility_id: initialData?.ncaa_eligibility_id || '',
    intended_major: initialData?.intended_major || '',
    guardian_name: initialData?.guardian_name || '',
    guardian_email: initialData?.guardian_email || '',
    club_coach_name: initialData?.club_coach_name || '',
    club_coach_email: initialData?.club_coach_email || '',
    time_zone: initialData?.time_zone || '',
    best_contact_window: initialData?.best_contact_window || '',
    evaluation: initialData?.evaluation || '',
    sport_attributes: initialData?.sport_attributes || {},
    preferred_conferences: initialData?.preferred_conferences || [],
    budget_range: initialData?.budget_range || '',
    criterion_ranking: initialData?.criterion_ranking ?? null,
    academic_minimum: initialData?.academic_minimum ?? 'Not Important',
    additional_notes: initialData?.additional_notes || '',
    email_subject: initialData?.email_subject || DEFAULT_EMAIL_SUBJECT,
    email_template: initialData?.email_template || DEFAULT_EMAIL_TEMPLATE,
  };
}

export default function PlayerFormSteps({ initialData, sport = 'mens-soccer', onSubmit, submitLabel = 'Create Player' }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState(() => defaultsFrom(initialData));
  const [colleges, setColleges] = useState([]);
  const [collegesLoading, setCollegesLoading] = useState(true);

  // Conference options are dynamic, sourced from the College collection —
  // fetched once per sport (same bulk-fetch-then-filter-client-side pattern
  // Colleges.jsx / GraduatingDatabase.jsx / the matching algorithm all use).
  useEffect(() => {
    let cancelled = false;
    setCollegesLoading(true);
    entities.College.filter({ sport }).then((rows) => {
      if (!cancelled) {
        // Exclude inactive colleges so a preference never offers a
        // conference/division whose only members are non-recruiting-eligible.
        setColleges(rows.filter((c) => c.active !== 0));
        setCollegesLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [sport]);

  const selectedDivisions = data.preferred_divisions;

  // Kept only to prune the selection below; ConferencePicker derives its own
  // groups from `colleges` so it can show which division each one belongs to.
  const availableConferences = useMemo(() => {
    if (selectedDivisions.length === 0) return [];
    const set = new Set();
    for (const c of colleges) {
      if (selectedDivisions.includes(c.division) && c.conference) set.add(c.conference);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [colleges, selectedDivisions]);

  const divisionsWithNoData = useMemo(() => {
    if (collegesLoading) return [];
    return selectedDivisions.filter((div) => !colleges.some((c) => c.division === div));
  }, [colleges, collegesLoading, selectedDivisions]);

  // Re-sync selection whenever the available conference list changes (e.g.
  // the user went back to Step 1 and changed divisions) so a stale
  // conference from a since-deselected division can't linger invisibly.
  useEffect(() => {
    setData((d) => {
      const pruned = d.preferred_conferences.filter((c) => availableConferences.includes(c));
      if (pruned.length === d.preferred_conferences.length) return d;
      return { ...d, preferred_conferences: pruned };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableConferences]);

  const set = (field) => (value) => setData((d) => ({ ...d, [field]: value }));

  // Clear the half that no longer applies. Leaving a stale state on an
  // international athlete would have matching measure their distance from a
  // place they are not from.
  const setOrigin = (origin) => setData((d) => (
    origin === 'International'
      ? { ...d, origin, state: '' }
      : { ...d, origin, nationality: '' }
  ));
  const toggleArrayValue = (field, value) => {
    setData((d) => {
      const arr = d[field] || [];
      const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
      return { ...d, [field]: next };
    });
  };

  const step1Valid = data.full_name.trim().length > 0 && !!data.position && data.preferred_divisions.length > 0
    && !!data.recruiting_class_year;

  const steps = [
    { label: 'Soccer Profile' },
    { label: 'Placement Prefs' },
    { label: 'Public Profile' },
  ];

  function goToStep(idx) {
    if (idx > 0 && !step1Valid) return;
    setStep(idx);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!step1Valid) {
      setStep(0);
      return;
    }
    onSubmit(data);
  }

  function insertVariable(variable) {
    const text = variable.snippet || `{{${variable.token}}}`;
    setData((d) => ({ ...d, email_template: `${d.email_template}${text}` }));
  }

  function resetTemplate() {
    setData((d) => ({ ...d, email_subject: DEFAULT_EMAIL_SUBJECT, email_template: DEFAULT_EMAIL_TEMPLATE }));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center gap-2">
        {steps.map((s, idx) => (
          <button
            type="button"
            key={s.label}
            onClick={() => goToStep(idx)}
            className={cn(
              'flex-1 text-left px-4 py-2 rounded-md border text-sm font-medium transition-colors',
              step === idx ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
            )}
          >
            {idx + 1}. {s.label}
          </button>
        ))}
      </div>

      {step === 0 && (
        <Card className="p-6 space-y-5">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Full Name *</Label>
              <Input value={data.full_name} onChange={(e) => set('full_name')(e.target.value)} placeholder="Jordan Smith" required />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={data.email} onChange={(e) => set('email')(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={data.phone} onChange={(e) => set('phone')(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Recruiting Class Year *</Label>
              <Input
                type="number"
                value={data.recruiting_class_year}
                onChange={(e) => set('recruiting_class_year')(e.target.value)}
                placeholder="2027"
                required
              />
              <p className="text-xs text-muted-foreground">The year you'd join a college roster — matched against schools' graduating class of that year.</p>
            </div>
            <div className="space-y-1.5">
              <Label>High School</Label>
              <Input value={data.high_school} onChange={(e) => set('high_school')(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>City</Label>
              <Input value={data.city} onChange={(e) => set('city')(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Recruited From</Label>
              <Select value={data.origin} onValueChange={setOrigin}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ORIGINS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* One slot, two pickers. A home state means nothing for an
                overseas athlete, and a country means nothing for a domestic
                one — matching reads whichever applies. */}
            {data.origin === 'International' ? (
              <div className="space-y-1.5">
                <Label>Country</Label>
                <Select value={data.nationality} onValueChange={set('nationality')}>
                  <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {COUNTRIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>State</Label>
                <Select value={data.state} onValueChange={set('state')}>
                  <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {US_STATES.map(([code, name]) => <SelectItem key={code} value={code}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {data.origin === 'International' && (
            <p className="text-xs text-muted-foreground -mt-2">
              Matching will favour programs that already carry international players, and those with players from{' '}
              {data.nationality || 'their country'} in particular.
            </p>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Primary Position *</Label>
              <Select value={data.position} onValueChange={set('position')}>
                <SelectTrigger><SelectValue placeholder="Select position" /></SelectTrigger>
                <SelectContent>
                  {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Secondary Position</Label>
              <Select value={data.secondary_position} onValueChange={set('secondary_position')}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="None">None</SelectItem>
                  {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Preferred Divisions *</Label>
            <div className="flex flex-wrap gap-4">
              {DIVISIONS.map((div) => (
                <label key={div} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={data.preferred_divisions.includes(div)}
                    onCheckedChange={() => toggleArrayValue('preferred_divisions', div)}
                  />
                  {div}
                </label>
              ))}
            </div>
          </div>

          {/* All three already reach the public profile and the match card —
              only GPA had a way in, so SAT and ACT rendered as empty rows on
              every athlete's page and admissibility fell back to GPA alone. */}
          <div className="grid grid-cols-3 gap-4 max-w-md">
            <div className="space-y-1.5">
              <Label>GPA</Label>
              <Input
                type="number" step="0.01" min="0" max="4" placeholder="3.60"
                value={data.gpa} onChange={(e) => set('gpa')(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>SAT</Label>
              <Input
                type="number" step="10" min="400" max="1600" placeholder="1250"
                value={data.sat_score} onChange={(e) => set('sat_score')(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>ACT</Label>
              <Input
                type="number" step="1" min="1" max="36" placeholder="27"
                value={data.act_score} onChange={(e) => set('act_score')(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-3">
            Either test is enough — an ACT score is converted to its SAT equivalent when
            matching works out which programmes an athlete would be admitted to.
          </p>

          <div className="space-y-2">
            <Label>Footballing Ability</Label>
            <AbilitySlider value={data.football_ability} onChange={set('football_ability')} lowLabel="Developmental" highLabel="Elite" />
          </div>


          <div className="space-y-1.5">
            <Label>Highlights URL</Label>
            <Input value={data.highlights_url} onChange={(e) => set('highlights_url')(e.target.value)} placeholder="https://youtube.com/..." />
          </div>

          <ChapterEditor
            value={data.video_chapters}
            onChange={set('video_chapters')}
            highlightsUrl={data.highlights_url}
            videoId={extractVideoId(data.highlights_url)}
          />

          <div className="flex justify-end">
            <Button type="button" disabled={!step1Valid} onClick={() => goToStep(1)}>Next</Button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card className="p-6 space-y-5">
          <div className="space-y-2">
            <Label>Preferred Conferences</Label>

            {selectedDivisions.length === 0 && (
              <p className="text-xs text-muted-foreground italic">Select a division in Step 1 to see available conferences.</p>
            )}

            {selectedDivisions.length > 0 && (
              <>
                {divisionsWithNoData.map((div) => (
                  <p key={div} className="text-xs text-muted-foreground italic">
                    No conferences available yet for {div} — colleges for this division haven't been added to the database.
                  </p>
                ))}

                <ConferencePicker
                  divisions={selectedDivisions}
                  colleges={colleges}
                  value={data.preferred_conferences}
                  onChange={set('preferred_conferences')}
                  loading={collegesLoading}
                />
              </>
            )}
          </div>

          <div className="space-y-1.5 max-w-sm">
            <Label>Budget Range</Label>
            <Select value={data.budget_range} onValueChange={set('budget_range')}>
              <SelectTrigger><SelectValue placeholder="Select budget" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {BUDGET_BANDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* A constraint, not a preference — how much academics *matter* is the
              priority ranking below. Default is no minimum, and whatever it
              removes is reported rather than silently vanishing, which is
              what the old importance-as-threshold did. */}
          <div className="space-y-2 max-w-md">
            <Label>Minimum Academic Rating</Label>
            <p className="text-xs text-muted-foreground -mt-1">
              Hides programs rated below this. Leave as N/A to consider every program.
            </p>
            <AbilitySlider
              value={data.academic_minimum}
              onChange={set('academic_minimum')}
              lowLabel="Any program"
              highLabel="Elite academics only"
              notImportantOption
              notImportantLabel="No minimum"
            />
          </div>

          {/* Sits under budget deliberately: a tight budget shifts several of
              these weights on its own, and the note under the tokens explains
              which — that only makes sense once the budget is on screen. */}
          <div className="space-y-2">
            <Label>Priority Ranking</Label>
            <p className="text-xs text-muted-foreground -mt-1">
              What matters most, in order. This sets how much each criterion counts when matching.
            </p>
            <PriorityTokens
              value={data.criterion_ranking}
              onChange={set('criterion_ranking')}
              budgetRange={data.budget_range}
              state={data.state}
              origin={data.origin}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Recruiter Notes</Label>
            <Textarea rows={3} value={data.additional_notes} onChange={(e) => set('additional_notes')(e.target.value)} />
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <Label>Email Template</Label>
              <Button type="button" size="sm" variant="ghost" onClick={resetTemplate}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
              </Button>
            </div>
            <Input value={data.email_subject} onChange={(e) => set('email_subject')(e.target.value)} placeholder="Subject" />
            <Textarea rows={10} value={data.email_template} onChange={(e) => set('email_template')(e.target.value)} className="font-mono text-xs" />
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATE_VARIABLES.map((v) => (
                <button
                  type="button"
                  key={v.token}
                  onClick={() => insertVariable(v)}
                  title={v.snippet ? v.label : undefined}
                  className="px-2 py-0.5 rounded-full text-xs bg-muted hover:bg-muted/70"
                >
                  {v.snippet ? v.label : `{{${v.token}}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => goToStep(0)}>Back</Button>
            <Button type="button" onClick={() => goToStep(2)}>Next</Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="p-6 space-y-6">
          <div>
            <h2 className="font-heading text-lg font-semibold">Public profile</h2>
            <p className="text-sm text-muted-foreground mt-1">
              What a college coach sees on the page you send them. Everything here is
              optional — anything left blank is left off the page entirely.
            </p>
          </div>

          <PublicProfileFields data={data} set={set} sport={sport} />

          <div className="flex justify-between border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={() => goToStep(1)}>Back</Button>
            <Button type="submit">{submitLabel}</Button>
          </div>
        </Card>
      )}
    </form>
  );
}
