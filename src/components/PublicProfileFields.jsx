import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getSportProfile } from '@shared/sportProfiles';

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * Everything that appears on the coach-facing page but is not needed to run
 * the matching. All optional: the generated page omits any row or block with
 * no value rather than printing an empty cell, so a sparse profile reads as
 * deliberate rather than unfinished.
 *
 * The performance metrics are not fields here — they come from the sport's
 * definition in shared/sportProfiles.js, so a new sport is a config entry
 * rather than a change to this form.
 */
export default function PublicProfileFields({ data, set, sport }) {
  const profile = getSportProfile(sport);

  const setAttribute = (key) => (event) => {
    const value = event.target.value;
    set('sport_attributes')({ ...(data.sport_attributes || {}), [key]: value });
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-heading text-sm font-semibold">Identity</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Shown in the header of the coach-facing page.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
          <Field label="Commitment status" hint="e.g. Uncommitted">
            <Input value={data.commitment_status} onChange={(e) => set('commitment_status')(e.target.value)} placeholder="Uncommitted" />
          </Field>
          <Field label="Nationality">
            <Input value={data.nationality} onChange={(e) => set('nationality')(e.target.value)} placeholder="New Zealand" />
          </Field>
          <Field label="Current club">
            <Input value={data.club_name} onChange={(e) => set('club_name')(e.target.value)} placeholder="Auckland City FC Academy" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Height (cm)">
              <Input type="number" value={data.height_cm} onChange={(e) => set('height_cm')(e.target.value)} placeholder="178" />
            </Field>
            <Field label="Weight (kg)">
              <Input type="number" value={data.weight_kg} onChange={(e) => set('weight_kg')(e.target.value)} placeholder="71" />
            </Field>
          </div>
        </div>
      </div>

      <div>
        <h3 className="font-heading text-sm font-semibold">Academics</h3>
        <p className="text-xs text-muted-foreground mt-0.5">GPA and test scores come from the Soccer Profile step.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
          <Field label="NCAA Eligibility ID">
            <Input value={data.ncaa_eligibility_id} onChange={(e) => set('ncaa_eligibility_id')(e.target.value)} placeholder="2110042886" />
          </Field>
          {/* Not only a profile line. This is the input ACADEMIC_FIT evidence
              reads: it is matched against each school's own notable majors, so
              an email can say "you offer a strong Business program" only where
              that is true. Left blank — which both pilot athletes were — the
              angle cannot fire at any programme, which is why the field says
              so rather than sitting silently among the optional ones. */}
          <Field label="Intended major">
            <Input value={data.intended_major} onChange={(e) => set('intended_major')(e.target.value)} placeholder="Sport Science" />
            <p className="mt-1 text-xs text-muted-foreground">
              Used to find programmes that actually offer it — worth filling in even though
              it is optional. Plain English is fine: “business”, “comp sci”, “exercise science”.
            </p>
          </Field>
        </div>
      </div>

      <div>
        <h3 className="font-heading text-sm font-semibold">Contact</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Who a coach should reply to. The athlete's own email and phone come from the first step.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
          <Field label="Guardian name">
            <Input value={data.guardian_name} onChange={(e) => set('guardian_name')(e.target.value)} placeholder="S. Brennan" />
          </Field>
          <Field label="Guardian email">
            <Input type="email" value={data.guardian_email} onChange={(e) => set('guardian_email')(e.target.value)} placeholder="guardian@example.com" />
          </Field>
          <Field label="Club coach name">
            <Input value={data.club_coach_name} onChange={(e) => set('club_coach_name')(e.target.value)} placeholder="R. Tuilagi" />
          </Field>
          <Field label="Club coach email">
            <Input type="email" value={data.club_coach_email} onChange={(e) => set('club_coach_email')(e.target.value)} placeholder="coach@example.org" />
          </Field>
          <Field label="Time zone" hint="Helps a coach work out when to call.">
            <Input value={data.time_zone} onChange={(e) => set('time_zone')(e.target.value)} placeholder="NZST · UTC+12" />
          </Field>
          <Field label="Best contact window">
            <Input value={data.best_contact_window} onChange={(e) => set('best_contact_window')(e.target.value)} placeholder="16:00–20:00 ET" />
          </Field>
        </div>
      </div>

      {profile.groups.map((group) => (
        <div key={group.key}>
          <h3 className="font-heading text-sm font-semibold">{group.label}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {profile.label} metrics. Leave blank to omit from the page.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3">
            {group.fields.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label className="text-xs font-normal text-muted-foreground">
                  {field.label}{field.unit ? ` (${field.unit})` : ''}
                </Label>
                <Input
                  value={(data.sport_attributes || {})[field.key] ?? ''}
                  onChange={setAttribute(field.key)}
                  className="text-sm"
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <div>
        <h3 className="font-heading text-sm font-semibold">Evaluation</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          The analyst's honest read. Blank lines separate paragraphs on the page.
        </p>
        <Textarea
          rows={8}
          className="mt-3 text-sm"
          value={data.evaluation}
          onChange={(e) => set('evaluation')(e.target.value)}
          placeholder="Direct, left-sided attacker most dangerous receiving to feet in the wide channel…"
        />
      </div>
    </div>
  );
}
