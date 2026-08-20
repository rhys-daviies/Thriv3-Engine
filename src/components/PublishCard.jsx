import React, { useCallback, useEffect, useState } from 'react';
import { Globe, Eye, RefreshCw, Copy, Check, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { publishing } from '@/api/client';

/**
 * Publishing controls for one athlete's coach-facing page.
 *
 * Preview and Go live are deliberately separate. Preview rebuilds the page on
 * this machine so the exact thing a coach would open can be read first;
 * Go live is the step that puts it on the internet.
 */
export default function PublishCard({ playerId, playerName }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [blockedPreview, setBlockedPreview] = useState(null);

  const load = useCallback(async () => {
    const result = await publishing.status(playerId);
    setStatus(result);
    return result;
  }, [playerId]);

  useEffect(() => {
    let cancelled = false;
    publishing.status(playerId).then((result) => {
      if (!cancelled) setStatus(result);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [playerId]);

  async function act(kind, fn) {
    setBusy(kind);
    setError(null);
    setBlockedPreview(null);
    try {
      const next = await fn(playerId);
      setStatus(next);
      if (kind === 'preview') {
        // The open happens after an await, so it is outside the click gesture
        // and a browser may block it. Offer the link rather than doing nothing.
        const opened = window.open(next.previewUrl, '_blank', 'noopener');
        if (!opened) setBlockedPreview(next.previewUrl);
      }
    } catch (err) {
      setError(err.message);
    }
    setBusy(null);
  }

  function copy() {
    navigator.clipboard.writeText(status.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!status) return null;

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="font-heading text-sm font-semibold">Public profile page</h3>
        <p className="text-xs text-muted-foreground mt-1">
          The page coaches open. Each coach gets this link with their own tracking token
          appended, so you can tell who watched what.
        </p>
      </div>

      {status.missing.length > 0 && (
        <p className="flex items-start gap-1.5 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-primary" />
          <span>
            {playerName} needs {status.missing.join(', ')} before a page can be generated.
          </span>
        </p>
      )}

      {status.archived && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
          This athlete is archived. Their links are revoked and the page will not serve.
        </p>
      )}

      {status.canPublish && (
        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Coach-facing link</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate rounded border border-border bg-muted/30 px-2.5 py-1.5 text-xs">
              {status.url}
            </code>
            <Button size="sm" variant="outline" onClick={copy} aria-label="Copy link">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {status.publishedAt
              ? `Live since ${new Date(status.publishedAt).toLocaleString()}`
              : 'Not published yet — this link will 404 until you go live.'}
          </p>
        </div>
      )}

      {!status.reachable && status.canPublish && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
          Links point at {status.baseUrl}, which no coach can open. Set THRIV3_PUBLIC_BASE_URL
          before sending.
        </p>
      )}

      {blockedPreview && (
        <p className="rounded-md border border-border bg-muted/30 p-2.5 text-xs">
          Your browser blocked the preview window.{' '}
          <a className="text-primary hover:underline" href={blockedPreview} target="_blank" rel="noreferrer">
            Open it here
          </a>.
        </p>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={!status.canPublish || busy !== null}
          onClick={() => act('preview', publishing.regenerate)}
        >
          <Eye className="h-4 w-4 mr-1.5" />
          {busy === 'preview' ? 'Building…' : 'Preview'}
        </Button>
        <Button
          disabled={!status.canPublish || busy !== null}
          onClick={() => act('publish', publishing.goLive)}
        >
          {busy === 'publish'
            ? <RefreshCw className="h-4 w-4 mr-1.5 animate-spin" />
            : <Globe className="h-4 w-4 mr-1.5" />}
          {busy === 'publish'
            ? 'Publishing…'
            : status.publishedAt ? 'Update live page' : 'Go live'}
        </Button>
        {busy === 'publish' && (
          <span className="text-xs text-muted-foreground">Deploying to Cloudflare, this takes a moment.</span>
        )}
      </div>
    </Card>
  );
}
