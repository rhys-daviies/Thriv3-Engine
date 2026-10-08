import React, { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { entities } from '@/api/client';

/**
 * REPRESENTATIVES — the consultants a college coach is pointed to (Phase 2).
 *
 * Each athlete names one in Edit Player; their name, email and phone become the
 * contact on the coach-facing page and the signature on outreach. Sending is
 * unchanged: emails still leave from the athlete's connected mailbox.
 *
 * Nobody is deleted. A representative who leaves is deactivated: athletes who
 * already have them keep them until reassigned, and history keeps their name.
 */
const BLANK = { full_name: '', email: '', phone: '', title: '', organisation: '' };

function RepresentativeForm({ initial = BLANK, onSave, onCancel, saveLabel }) {
  const [form, setForm] = useState({ ...BLANK, ...initial });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({
        full_name: form.full_name, email: form.email, phone: form.phone, title: form.title, organisation: form.organisation,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-testid="representative-form">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Name *</Label>
          <Input value={form.full_name} onChange={set('full_name')} placeholder="Alex Morgan" required />
        </div>
        <div className="space-y-1.5">
          <Label>Email *</Label>
          <Input type="email" value={form.email} onChange={set('email')} placeholder="alex@striv3.com" required />
        </div>
        <div className="space-y-1.5">
          <Label>Phone / WhatsApp</Label>
          <Input value={form.phone} onChange={set('phone')} placeholder="+64 21 555 0100" />
          <p className="text-[11px] text-muted-foreground">Outreach offers this as &ldquo;reach me on WhatsApp&rdquo;. Leave blank to offer email only.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input value={form.title} onChange={set('title')} placeholder="Recruiting consultant" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Organisation</Label>
          <Input value={form.organisation} onChange={set('organisation')} placeholder="Striv3 Elite Sports Management" />
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2 justify-end">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={saving}>{saveLabel}</Button>
      </div>
    </form>
  );
}

export default function Representatives() {
  const [reps, setReps] = useState(null);
  const [players, setPlayers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const [r, p] = await Promise.all([
        entities.Representative.list('full_name'),
        entities.Player.list(),
      ]);
      setReps(r);
      setPlayers(p.filter((x) => !x.archived_at));
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  const assigned = (id) => players.filter((p) => p.representative_id === id).length;
  const unassigned = players.filter((p) => !p.representative_id).length;

  async function setActive(rep, active) {
    try {
      await entities.Representative.update(rep.id, { active });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">Recruitment Console</p>
        <h1 className="font-heading text-2xl font-bold mt-1">Representatives</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The consultants coaches are pointed to. Each athlete names one in Edit Player: that person is the
          contact on the coach-facing profile and signs the outreach. Emails still send from the athlete&rsquo;s
          own connected mailbox. Assigning one is recommended for every athlete, but never blocks outreach.
        </p>
      </div>

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

      {unassigned > 0 && (
        <p className="text-xs text-amber-500" data-testid="unassigned-athletes">
          {unassigned} active {unassigned === 1 ? 'athlete has' : 'athletes have'} no representative. Their
          outreach keeps the standard sign-off, and their coach-facing page shows no contact beyond asking
          coaches to reply to the email they received.
        </p>
      )}

      {reps === null ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="space-y-3" data-testid="representative-list">
          {reps.length === 0 && !adding && (
            <Card className="p-5 text-sm text-muted-foreground">No representatives yet. Add the first one below.</Card>
          )}
          {reps.map((rep) => (
            <Card key={rep.id} className="p-4" data-testid={`representative-${rep.id}`}>
              {editing === rep.id ? (
                <RepresentativeForm
                  initial={rep}
                  saveLabel="Save"
                  onCancel={() => setEditing(null)}
                  onSave={async (data) => { await entities.Representative.update(rep.id, data); setEditing(null); await load(); }}
                />
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="font-medium">
                      {rep.full_name}
                      {!rep.active && <Badge variant="muted" className="ml-2">Inactive</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {[rep.title, rep.organisation].filter(Boolean).join(' · ') || 'No title'}
                    </p>
                    <p className="text-sm">
                      {/* Plain text: the client builds no mail links at all (outreachBypass.test.js). */}
                      {rep.email}
                      {rep.phone && <span className="text-muted-foreground"> · {rep.phone}</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Representing {assigned(rep.id)} active {assigned(rep.id) === 1 ? 'athlete' : 'athletes'}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => setEditing(rep.id)}>Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => setActive(rep, !rep.active)}>
                      {rep.active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {adding ? (
        <Card className="p-5">
          <h2 className="font-heading text-sm font-semibold mb-3">New representative</h2>
          <RepresentativeForm
            saveLabel="Add representative"
            onCancel={() => setAdding(false)}
            onSave={async (data) => { await entities.Representative.create(data); setAdding(false); await load(); }}
          />
        </Card>
      ) : (
        <Button onClick={() => setAdding(true)} data-testid="add-representative">Add representative</Button>
      )}
    </div>
  );
}
