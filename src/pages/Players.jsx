import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Search, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { entities } from '@/api/client';

const STATUS_VARIANT = {
  New: 'blue',
  Analyzed: 'green',
  'In Progress': 'amber',
  Committed: 'purple',
};

function initials(name) {
  return (name || '')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function Players() {
  const [players, setPlayers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const rows = await entities.Player.list('-created_date', 100);
    setPlayers(rows);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return players;
    return players.filter(
      (p) => p.full_name?.toLowerCase().includes(q) || p.position?.toLowerCase().includes(q)
    );
  }, [players, search]);

  async function handleDelete(id) {
    await entities.Player.delete(id);
    setPlayers((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">Players</h1>
          <p className="text-sm text-muted-foreground">All recruited players across every sport.</p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by name or position" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {!loading && filtered.length === 0 && (
        <div className="text-center py-20">
          <Users className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No players yet</p>
        </div>
      )}

      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {filtered.map((p) => (
          <div key={p.id} className="group flex items-center gap-4 px-4 py-3 hover:bg-muted/40">
            <Link to={`/player/${p.id}`} className="flex items-center gap-4 flex-1 min-w-0">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm">
                {initials(p.full_name)}
              </span>
              <div className="min-w-0">
                <p className="font-medium truncate">{p.full_name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {p.position} · {p.state || '—'} · {(p.preferred_divisions || []).join(', ') || 'Any division'}
                </p>
              </div>
            </Link>
            <Badge variant={STATUS_VARIANT[p.status] || 'muted'}>{p.status || 'New'}</Badge>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {p.full_name}?</AlertDialogTitle>
                  <AlertDialogDescription>This permanently removes the player and their match history.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => handleDelete(p.id)}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        ))}
      </div>
    </div>
  );
}
