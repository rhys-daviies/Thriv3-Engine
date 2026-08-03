import React, { useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Mail } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function SeniorGroup({ label, names, collegeName }) {
  const list = (names || []).filter(Boolean);
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
        <Badge variant="muted">{list.length}</Badge>
      </div>
      {list.length === 0 ? (
        <p className="text-xs italic text-muted-foreground">Names could not be verified from official sources</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {list.map((name) => (
            <a
              key={name}
              href={`https://www.google.com/search?q=${encodeURIComponent(`${name} ${collegeName} soccer roster`)}`}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-0.5 rounded-full text-xs bg-muted hover:bg-muted/70"
            >
              {name}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function matchScoreVariant(score) {
  if (score >= 80) return 'green';
  if (score >= 60) return 'amber';
  return 'muted';
}

export default function CollegeCard({ college, onEmailCoaches }) {
  const [expanded, setExpanded] = useState(false);
  const coaches = (college.coaching_staff || []).filter((c) => c.email && c.email !== 'N/A');

  return (
    <Card className="p-4 hover:border-primary/30 hover:shadow-sm transition-all">
      <button className="w-full text-left" onClick={() => setExpanded((e) => !e)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-heading font-semibold truncate">{college.name}</p>
            <p className="text-xs text-muted-foreground truncate">{college.location}</p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Badge>{college.division}</Badge>
              {college.position_need && (
                <Badge variant={college.position_need === 'High' ? 'green' : college.position_need === 'Medium' ? 'amber' : 'muted'}>
                  {college.position_need} need
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant={matchScoreVariant(college.match_score || 0)} className="text-sm px-2 py-1">
              {college.match_score ?? '—'}%
            </Badge>
            {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-border space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div>
              <p className="text-xs text-muted-foreground">Program Rating</p>
              <p className="font-semibold">{college.program_quality_rating != null ? `${college.program_quality_rating.toFixed(1)}/10` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Academic Rating</p>
              <p className="font-semibold">{college.academic_rating != null ? `${college.academic_rating}/10` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Conference</p>
              <p className="font-semibold truncate">{college.conference || '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Tuition</p>
              <p className="font-semibold">—</p>
            </div>
          </div>

          <div className="space-y-3">
            <SeniorGroup label="Total Graduating" names={college.all_graduating_senior_names} collegeName={college.name} />
            <SeniorGroup label="At Your Position" names={college.graduating_senior_names_at_position} collegeName={college.name} />
            <SeniorGroup label="Graduating Starters (600+ min)" names={college.graduating_starter_names_at_position} collegeName={college.name} />
          </div>

          {college.reason && (
            <p className="text-xs text-muted-foreground italic">{college.reason}</p>
          )}

          {college.official_roster_url && (
            <a
              href={college.official_roster_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              Official roster <ExternalLink className="h-3 w-3" />
            </a>
          )}

          {coaches.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Coaching Staff</p>
              <div className="space-y-1">
                {coaches.map((c) => (
                  <div key={c.email} className="text-xs flex items-center justify-between">
                    <span>{c.name} <span className="text-muted-foreground">— {c.title}</span></span>
                    <a href={`mailto:${c.email}`} className="text-accent hover:underline">{c.email}</a>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button size="sm" onClick={() => onEmailCoaches(college)} disabled={coaches.length === 0}>
            <Mail className="h-3.5 w-3.5 mr-1.5" /> Email Coaches
          </Button>
        </div>
      )}
    </Card>
  );
}
