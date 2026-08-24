import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Plus, Send, CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { functions } from '@/api/client';

function ToolCallCard({ call }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-muted/30 text-xs">
      <button className="w-full flex items-center gap-2 px-3 py-2" onClick={() => setExpanded((e) => !e)}>
        {call.status === 'success' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
        <span className="font-mono">{call.name}</span>
        {expanded ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
      </button>
      {expanded && (
        <pre className="px-3 pb-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify({ input: call.input, result: call.result }, null, 2)}</pre>
      )}
    </div>
  );
}

function newSession() {
  return { id: crypto.randomUUID(), title: 'New Session', messages: [] };
}

export default function CSVAgent() {
  const [sessions, setSessions] = useState([newSession()]);
  const [activeId, setActiveId] = useState(sessions[0].id);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const active = sessions.find((s) => s.id === activeId);

  function updateActive(updater) {
    setSessions((prev) => prev.map((s) => (s.id === activeId ? updater(s) : s)));
  }

  async function handleSend() {
    if (!input.trim() || loading) return;
    const userMessage = { role: 'user', content: input.trim() };
    const title = active.messages.length === 0 ? input.trim().slice(0, 40) : active.title;
    updateActive((s) => ({ ...s, title, messages: [...s.messages, userMessage] }));
    setInput('');
    setLoading(true);
    try {
      const res = await functions.csvAgentChat({ messages: [...active.messages, userMessage].map(({ role, content }) => ({ role, content })) });
      updateActive((s) => ({
        ...s,
        messages: [...s.messages, userMessage, { role: 'assistant', content: res.message, toolCalls: res.toolCalls }],
      }));
    } catch (err) {
      updateActive((s) => ({
        ...s,
        messages: [...s.messages, userMessage, { role: 'assistant', content: `Error: ${err.message}` }],
      }));
    } finally {
      setLoading(false);
    }
  }

  function handleNewSession() {
    const s = newSession();
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      <div className="w-56 shrink-0 space-y-2">
        <Button size="sm" className="w-full" onClick={handleNewSession}>
          <Plus className="h-4 w-4 mr-1.5" /> New Session
        </Button>
        <div className="space-y-1">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-md text-xs truncate',
                s.id === activeId ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
              )}
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <Card className="flex-1 overflow-y-auto p-4 space-y-4">
          {active.messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Paste a CSV URL of graduating senior roster data and I'll import it. Example CSV columns: college_name, season,
              confirmed_division, data_confidence, total_graduating_seniors, player_name, player_position, player_minutes_played,
              official_roster_url, notes.
            </p>
          )}
          {active.messages.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[80%] rounded-xl px-4 py-2 text-sm space-y-2', m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                {m.role === 'assistant' ? <ReactMarkdown>{m.content}</ReactMarkdown> : <p>{m.content}</p>}
                {m.toolCalls?.map((call, j) => <ToolCallCard key={j} call={call} />)}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Thinking...
            </div>
          )}
        </Card>
        <div className="flex items-center gap-2 pt-3">
          <Input
            placeholder="Paste a CSV URL..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
          <Button onClick={handleSend} disabled={loading}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
