import React from 'react';
import { Card } from '@/components/ui/card';
import { describeAttributes } from '@shared/sportProfiles';
import { usePlayerWorkspace } from './PlayerWorkspace';

function present(value) {
  return value !== null && value !== undefined && value !== '';
}

/** A definition row. Renders nothing at all when the value is missing — a
 *  blank profile section is honest, an "N/A" is noise. */
function Row({ label, value, href }) {
  if (!present(value)) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-border/60 last:border-0">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-sm font-medium text-right">
        {href ? <a className="hover:underline" href={href}>{value}</a> : value}
      </dd>
    </div>
  );
}

/** Omits itself entirely when every row inside it is empty. */
function Block({ title, children }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  const hasContent = rows.some((row) => React.isValidElement(row) && present(row.props.value));
  if (!hasContent) return null;
  return (
    <Card className="p-5">
      <h3 className="font-heading text-sm font-semibold mb-2">{title}</h3>
      <dl>{children}</dl>
    </Card>
  );
}

function Stat({ label, value, unit, emphasis }) {
  return (
    <div className={`rounded-lg border p-3 text-center ${emphasis ? 'border-primary/30' : 'border-border'}`}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-heading text-lg font-semibold mt-0.5">
        {value}{unit && <span className="text-xs text-muted-foreground ml-0.5">{unit}</span>}
      </p>
    </div>
  );
}

export default function ProfileTab() {
  const { player } = usePlayerWorkspace();
  const attributeGroups = describeAttributes(player.sport, player.sport_attributes);
  const chapters = player.video_chapters || [];

  return (
    <div className="space-y-4">
      {/* GPA lives in the Academics block below; keeping it here too was
          the same number twice on one screen. */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4 text-center">
          <p className="text-xs text-muted-foreground">Divisions</p>
          <p className="font-semibold mt-1">{(player.preferred_divisions || []).join(', ') || 'Any'}</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-xs text-muted-foreground">Budget</p>
          <p className="font-semibold mt-1">{player.budget_range || '—'}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Block title="Identity">
          <Row label="Position" value={player.position} />
          <Row label="Secondary position" value={player.secondary_position !== 'None' ? player.secondary_position : null} />
          <Row label="Class year" value={player.graduation_year} />
          <Row label="Status" value={player.commitment_status} />
          <Row label="Nationality" value={player.nationality} />
          <Row label="Current club" value={player.club_name} />
          <Row label="High school" value={player.high_school} />
          <Row label="Location" value={[player.city, player.state].filter(Boolean).join(', ') || null} />
          <Row label="Height" value={present(player.height_cm) ? `${player.height_cm} cm` : null} />
          <Row label="Weight" value={present(player.weight_kg) ? `${player.weight_kg} kg` : null} />
        </Block>

        <Block title="Academics">
          <Row label="GPA" value={player.gpa} />
          <Row label="SAT" value={player.sat_score} />
          <Row label="ACT" value={player.act_score} />
          <Row label="NCAA Eligibility ID" value={player.ncaa_eligibility_id} />
          <Row label="Intended major" value={player.intended_major} />
        </Block>

        <Block title="Contact">
          <Row label="Athlete" value={player.email} href={player.email ? `mailto:${player.email}` : null} />
          <Row label="Phone" value={player.phone} />
          <Row label="Guardian" value={player.guardian_name} />
          <Row label="Guardian email" value={player.guardian_email} href={player.guardian_email ? `mailto:${player.guardian_email}` : null} />
          <Row label="Club coach" value={player.club_coach_name} />
          <Row label="Club coach email" value={player.club_coach_email} href={player.club_coach_email ? `mailto:${player.club_coach_email}` : null} />
          <Row label="Time zone" value={player.time_zone} />
          <Row label="Best contact window" value={player.best_contact_window} />
        </Block>

        <Block title="Highlight film">
          <Row label="Video ID" value={player.video_id} />
          <Row label="Chapters" value={chapters.length || null} />
          <Row label="Public slug" value={player.public_slug} />
          <Row label="Source URL" value={player.highlights_url} href={player.highlights_url} />
        </Block>
      </div>

      {attributeGroups.map((group) => (
        <Card key={group.key} className="p-5">
          <h3 className="font-heading text-sm font-semibold mb-3">{group.label}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {group.fields.map((field) => (
              <Stat key={field.key} label={field.label} value={field.value} unit={field.unit} emphasis={field.emphasis} />
            ))}
          </div>
        </Card>
      ))}

      {chapters.length > 0 && (
        <Card className="p-5">
          <h3 className="font-heading text-sm font-semibold mb-3">Film chapters</h3>
          <ol className="space-y-1.5">
            {chapters.map((chapter, i) => (
              <li key={i} className="flex items-baseline gap-3 text-sm">
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {Math.floor(chapter.t / 60)}:{String(chapter.t % 60).padStart(2, '0')}
                </span>
                <span>{chapter.label}</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {present(player.evaluation) && (
        <Card className="p-5">
          <h3 className="font-heading text-sm font-semibold mb-2">Evaluation</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{player.evaluation}</p>
        </Card>
      )}

      {present(player.additional_notes) && (
        <Card className="p-5">
          <h3 className="font-heading text-sm font-semibold mb-2">Notes</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{player.additional_notes}</p>
        </Card>
      )}
    </div>
  );
}
