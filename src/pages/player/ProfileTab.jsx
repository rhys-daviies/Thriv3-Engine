import React from 'react';
import { Card } from '@/components/ui/card';
import { describeAttributes } from '@shared/sportProfiles';
import PublishCard from '@/components/PublishCard';
import { usePlayerWorkspace } from './PlayerWorkspace';
import { classYearOf } from '@shared/athlete.js';
import { contributionSummary } from '@/lib/contributionIntake';
import { preferenceSummary, preferencesComplete } from '@/lib/preferenceIntake';
import { positionSummary, recruitmentPreferenceRows } from '@/lib/recruitmentPreferenceView';

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
  const contribution = contributionSummary(player);
  const preferences = preferenceSummary(player);
  const preferencesAnswered = preferencesComplete(player);
  const positions = positionSummary(player);
  const recruitment = recruitmentPreferenceRows(player);

  return (
    <div className="space-y-4">
      {/* GPA lives in the Academics block below; keeping it here too was
          the same number twice on one screen. */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4 text-center">
          <p className="text-xs text-muted-foreground">Divisions</p>
          <p className="font-semibold mt-1">{(player.preferred_divisions || []).join(', ') || 'Any'}</p>
        </Card>
        {/*
          The family's own answer, not the old band. A band never stated a
          maximum, so one is never shown as one — "$40k+/yr" in particular
          reads as "Needs confirmation" with the band underneath as context.
        */}
        <Card className="p-4 text-center">
          <p className="text-xs text-muted-foreground">{contribution.label}</p>
          <p className={`font-semibold mt-1 ${contribution.needsAttention ? 'text-amber-700' : ''}`}>
            {contribution.value}
            {contribution.needsAttention && <span className="sr-only"> — action needed</span>}
          </p>
          {contribution.note && <p className="text-[11px] text-muted-foreground mt-1">{contribution.note}</p>}
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Block title="Identity">
          <Row
            label="Position"
            value={positions.primary && positions.rankedAs && positions.primary !== positions.rankedAs
              ? `${positions.primary} (ranked as ${positions.rankedAs.toLowerCase()})`
              : positions.primary}
          />
          <Row label="Secondary position" value={positions.secondary} />
          <Row label="Class year" value={classYearOf(player)} />
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

        {/*
          A Block, not a Row set inside another: these three are the only
          things on this screen the ATHLETE stated, and they are rendered
          unconditionally - including when all three are unanswered, which is
          the state that needs to be visible. `Block` hides itself when every
          value is empty, and "Not answered" is exactly what must not be
          hidden, so this one is written out.
        */}
        <Card className="p-5">
          <h3 className="font-heading text-sm font-semibold mb-2">What the athlete wants</h3>
          <dl>
            {preferences.map((p) => (
              <div key={p.field} className="flex items-baseline justify-between gap-4 py-2 border-b border-border/60 last:border-0">
                <dt className="text-xs text-muted-foreground shrink-0">{p.label}</dt>
                <dd className={`text-sm text-right ${p.answered ? 'font-medium' : 'italic text-muted-foreground'}`}>
                  {p.text}
                </dd>
              </div>
            ))}
          </dl>
          {!preferencesAnswered && (
            <p className="text-[11px] text-muted-foreground mt-2">
              An unanswered preference is not scored as a middle answer — matching is built from
              measured evidence until the athlete says what they want. Answer all three in
              Edit Player to have their preferences reflected.
            </p>
          )}
        </Card>

        {/*
          Written out, like the card above: "No preference" is an answer the
          operator needs to see, and `Block` would hide a card of them. Each
          row says whether Matcher V2 ranks on it or only checks it.
        */}
        <Card className="p-5" data-testid="profile-recruitment-preferences">
          <h3 className="font-heading text-sm font-semibold mb-2">Where, and what kind of school</h3>
          <dl>
            {recruitment.map((r) => (
              <div key={r.field} className="flex items-baseline justify-between gap-4 py-2 border-b border-border/60 last:border-0">
                <dt className="text-xs text-muted-foreground shrink-0">{r.label}</dt>
                <dd className={`text-sm text-right ${r.stated ? 'font-medium' : 'italic text-muted-foreground'}`}>
                  {r.text}
                  {r.stated && (
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {r.ranked ? 'Counted in the ranking' : 'Checked on each match'}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        {/*
          THE COACH-FACING CONTACT — Phase 2. Rendered unconditionally, because
          "nobody assigned" is the state that needs to be seen: it blocks the
          public page and leaves outreach on the standard sign-off.
        */}
        <Card className="p-5" data-testid="profile-representative">
          <h3 className="font-heading text-sm font-semibold mb-2">Representative</h3>
          {player.representative ? (
            <dl>
              <Row label="Name" value={[player.representative.full_name, player.representative.active ? null : '(inactive)'].filter(Boolean).join(' ')} />
              <Row label="Title" value={[player.representative.title, player.representative.organisation].filter(Boolean).join(' · ') || null} />
              <Row label="Email" value={player.representative.email} />
              <Row label="Phone" value={player.representative.phone} />
            </dl>
          ) : (
            <p className="text-sm text-amber-600" data-testid="no-representative">
              No representative assigned. The coach-facing page shows no contact (coaches are asked to reply to
              the email they received), and outreach keeps the standard sign-off. Choose one in Edit Profile.
            </p>
          )}
          <p className="text-[11px] text-muted-foreground mt-2">
            Coaches are pointed to this person. Outreach still sends from the athlete&rsquo;s own mailbox, and the
            athlete and guardian contact details below are never shown to coaches.
          </p>
        </Card>

        <Block title="Contact (private — not shown to coaches)">
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

      <PublishCard playerId={player.id} playerName={player.full_name} />
    </div>
  );
}
