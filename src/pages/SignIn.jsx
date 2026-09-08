/**
 * THE SIGN-IN SCREEN — Phase 13K.
 *
 * One form, two fields, one button. No registration, no forgotten-password
 * link, no marketing: an operator account is created on the host by somebody
 * with shell access, so every one of those flows would be a door into a
 * building with three occupants.
 *
 * The screen never says which half was wrong, because the server never tells
 * it — one message covers an unknown address, a wrong password and a
 * deactivated account.
 */
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Thriv3Mark, Thriv3Wordmark } from '@/components/Logo';
import { useSession } from '@/lib/session';

const STATE = { READY: 'ready', SIGNING_IN: 'signing-in', REJECTED: 'rejected', ERROR: 'error' };

export default function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState(STATE.READY);
  const [message, setMessage] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (state === STATE.SIGNING_IN) return;
    setState(STATE.SIGNING_IN);
    setMessage(null);
    try {
      await signIn(email.trim(), password);
      // Nothing to do on success: the session provider swaps this screen for
      // the application.
    } catch (err) {
      // 401 is a refusal and 429 is a ceiling; anything else is the server
      // having a problem, which is not the operator's fault to fix.
      setState(err.status === 401 || err.status === 429 ? STATE.REJECTED : STATE.ERROR);
      setMessage(err.message);
      setPassword('');
    }
  }

  const busy = state === STATE.SIGNING_IN;

  return (
    <div className="min-h-screen bg-background flex items-start justify-center px-4 pt-24">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8">
          <Thriv3Mark />
          <Thriv3Wordmark />
        </div>

        <h1 className="font-heading text-lg font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Thriv3 operator access. Athlete records and generated reports are behind this.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              disabled={busy}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              disabled={busy}
            />
          </div>

          <Button type="submit" className="w-full" disabled={busy || !email || !password}>
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>

          {message && (
            <p className={state === STATE.ERROR
              ? 'text-sm text-muted-foreground'
              : 'text-sm text-destructive'}>
              {message}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
