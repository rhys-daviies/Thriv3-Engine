import React from 'react';
import { Radar } from 'lucide-react';

/**
 * Phase 0 placeholder. Phase 4 replaces this with the outreach funnel, coach
 * table, film retention curve and chapter engagement blocks.
 */
export default function EngagementTab() {
  return (
    <div className="text-center py-20 max-w-md mx-auto">
      <Radar className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
      <p className="font-heading text-lg font-semibold">No outreach sent yet</p>
      <p className="text-sm text-muted-foreground mt-2">
        Once this athlete's profile has been sent to coaches, you will see which coaches
        opened it, how much film they watched, and who came back for a second look.
      </p>
    </div>
  );
}
