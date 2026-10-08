import React from 'react';
import { X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { US_STATES } from '@/lib/locations';
import {
  REGIONS, REGION_KEYS, STATE_CODES, INSTITUTION_TYPES, INSTITUTION_TYPE_KEYS, recruitmentPreferencesOf,
} from '@shared/recruitmentPreferences.js';
import { locationText } from '@/lib/recruitmentPreferenceView';

/**
 * WHERE THE ATHLETE WANTS TO BE, AND WHAT KIND OF SCHOOL.
 *
 * Nothing is pre-selected. An empty answer is "no preference" and the matcher
 * treats it that way; a box ticked by default would be an answer nobody gave.
 *
 * Each block says what Thriv3 does with it, because the two differ: location
 * is scored by Matcher V2, school type is only checked on each match.
 */
const STATE_NAME = new Map(US_STATES.map(([code, name]) => [code, name]));
/** Offered by name, the way a family says it - not by postal code, which puts Alaska before Alabama. */
const STATES_BY_NAME = [...STATE_CODES].sort((a, b) => (STATE_NAME.get(a) ?? a).localeCompare(STATE_NAME.get(b) ?? b));

export default function RecruitmentPreferenceFields({ value, onChange }) {
  const states = value.preferred_states ?? [];
  const regions = value.preferred_regions ?? [];
  const types = value.preferred_institution_types ?? [];
  const toggle = (field, current, key) => onChange(field, current.includes(key) ? current.filter((v) => v !== key) : [...current, key]);
  const prefs = recruitmentPreferencesOf(value);
  const covered = new Set(regions.flatMap((r) => REGIONS[r]?.states ?? []));

  return (
    <div className="space-y-5" data-testid="recruitment-preferences">
      <div className="space-y-1">
        <p className="text-sm font-medium leading-none">Where, and what kind of school</p>
        <p className="text-xs text-muted-foreground">
          Leave anything blank that the athlete has not said. Blank means no preference, not a middle answer.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium leading-none">Where would they like to study?</legend>
        <p className="text-xs text-muted-foreground">
          Matcher V2 counts this in the ranking: schools inside the area rank a little higher, all else equal.
          Pick whole regions, individual states, or both.
        </p>
        <div className="flex flex-wrap gap-4" role="group" aria-label="Regions">
          {REGION_KEYS.map((r) => (
            <label key={r} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={regions.includes(r)}
                onCheckedChange={() => toggle('preferred_regions', regions, r)}
                data-testid={`region-${r}`}
              />
              {REGIONS[r].label}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="w-56">
            <Select
              value=""
              onValueChange={(code) => { if (code && !states.includes(code)) onChange('preferred_states', [...states, code]); }}
            >
              <SelectTrigger data-testid="add-state"><SelectValue placeholder="Add a state" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {STATES_BY_NAME.filter((c) => !states.includes(c)).map((c) => (
                  <SelectItem key={c} value={c}>{STATE_NAME.get(c) ?? c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {states.map((code) => (
            <span key={code} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs" data-testid={`state-${code}`}>
              {STATE_NAME.get(code) ?? code}
              {covered.has(code) && <span className="text-muted-foreground">(already in a region)</span>}
              <button
                type="button"
                aria-label={`Remove ${STATE_NAME.get(code) ?? code}`}
                className="hover:text-foreground text-muted-foreground"
                onClick={() => onChange('preferred_states', states.filter((s) => s !== code))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground italic" data-testid="location-summary">
          {prefs.locationStates
            ? `Preferred: ${locationText(prefs)} (${prefs.locationStates.length} states).`
            : 'No location preference. Location will not affect the ranking.'}
        </p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium leading-none">Public or private?</legend>
        <p className="text-xs text-muted-foreground">
          Checked on each match, not ranked. Some schools have no public/private record, and those show as not on file.
        </p>
        <div className="flex flex-wrap gap-4">
          {INSTITUTION_TYPE_KEYS.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={types.includes(t)}
                onCheckedChange={() => toggle('preferred_institution_types', types, t)}
                data-testid={`type-${t}`}
              />
              {INSTITUTION_TYPES[t].label}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
