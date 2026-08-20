import React, { useRef, useState } from 'react';
import { Plus, X, ArrowUpDown, AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { parseTimecode, formatTimecode } from '@shared/timecode';

export const MINIMUM_CHAPTERS = 3;

let nextRowId = 0;
const makeRow = (time = '', label = '') => ({ id: ++nextRowId, time, label });

/**
 * Edits the labelled clips on an athlete's highlight reel.
 *
 * These are not decoration. Each one is a button on the public page, and a
 * coach jumping to a clip is the clearest signal in the product of what they
 * are evaluating for — it is what Tab 3's chapter ranking is built from. The
 * export refuses below three, because a reel a coach cannot navigate is a reel
 * they scrub through and abandon.
 */
export default function ChapterEditor({ value, onChange, videoId, highlightsUrl }) {
  const [rows, setRows] = useState(() => {
    const initial = (value || []).map((c) => makeRow(formatTimecode(c.t), c.label || ''));
    return initial.length ? initial : [makeRow()];
  });

  // Every mutation reads from the ref rather than the render closure, so two
  // edits in the same tick both land — React batches the state update, and
  // reading `rows` directly would silently drop the first of them.
  const latest = useRef(rows);

  function commit(next) {
    latest.current = next;
    setRows(next);
    onChange(
      next
        .map((row) => ({ t: parseTimecode(row.time), label: row.label.trim() }))
        .filter((chapter) => chapter.t !== null && chapter.label)
        .sort((a, b) => a.t - b.t)
    );
  }

  const update = (id, field, fieldValue) =>
    commit(latest.current.map((row) => (row.id === id ? { ...row, [field]: fieldValue } : row)));

  const add = () => commit([...latest.current, makeRow()]);
  const remove = (id) => commit(
    latest.current.length === 1 ? [makeRow()] : latest.current.filter((row) => row.id !== id)
  );
  const sort = () => commit(
    [...latest.current].sort((a, b) => (parseTimecode(a.time) ?? Infinity) - (parseTimecode(b.time) ?? Infinity))
  );

  const valid = rows.filter((row) => parseTimecode(row.time) !== null && row.label.trim()).length;
  const outOfOrder = rows
    .map((row) => parseTimecode(row.time))
    .filter((t) => t !== null)
    .some((t, i, list) => i > 0 && t < list[i - 1]);

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <Label>Film chapters</Label>
        <span className={`text-xs ${valid >= MINIMUM_CHAPTERS ? 'text-muted-foreground' : 'text-primary'}`}>
          {valid} of {MINIMUM_CHAPTERS} minimum
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Labelled clips a coach can jump straight to. Times as <code>1:06</code> or seconds.
      </p>

      <div className="space-y-1.5">
        {rows.map((row) => {
          const seconds = parseTimecode(row.time);
          const badTime = row.time.trim() !== '' && seconds === null;
          return (
            <div key={row.id} className="flex items-start gap-2">
              <Input
                value={row.time}
                onChange={(e) => update(row.id, 'time', e.target.value)}
                placeholder="1:06"
                aria-label="Chapter time"
                className={`w-24 shrink-0 font-mono text-sm ${badTime ? 'border-destructive' : ''}`}
              />
              <Input
                value={row.label}
                onChange={(e) => update(row.id, 'label', e.target.value)}
                placeholder="Receiving on the half-turn under pressure"
                aria-label="Chapter label"
                className="flex-1 min-w-0 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => remove(row.id)}
                aria-label="Remove chapter"
                className="shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Add chapter
        </Button>
        {outOfOrder && (
          <Button type="button" variant="ghost" size="sm" onClick={sort}>
            <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" /> Sort by time
          </Button>
        )}
      </div>

      {highlightsUrl && !videoId && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          No YouTube video ID could be read from that highlights URL, so no page can be
          generated. Paste the full watch, youtu.be or embed link.
        </p>
      )}
      {videoId && valid < MINIMUM_CHAPTERS && (
        <p className="text-xs text-muted-foreground">
          Video <code>{videoId}</code> detected. {MINIMUM_CHAPTERS - valid} more chapter
          {MINIMUM_CHAPTERS - valid === 1 ? '' : 's'} needed before a profile page can be sent.
        </p>
      )}
      {videoId && valid >= MINIMUM_CHAPTERS && (
        <p className="text-xs text-muted-foreground">
          Video <code>{videoId}</code> detected. Ready to publish.
        </p>
      )}
    </div>
  );
}
