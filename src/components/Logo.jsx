import React from 'react';
import { cn } from '@/lib/utils';
import thriv3Mark from '@/assets/thriv3-mark.png';
import thriv3Wordmark from '@/assets/thriv3-wordmark.png';

/**
 * Primary mark — circular T3 emblem, cut directly from the brand guide
 * artwork (Thriv3 Logos.png). Use where space is constrained: favicon,
 * mobile nav, avatars, compact headers.
 */
export function Thriv3Mark({ className }) {
  return <img src={thriv3Mark} alt="Thriv3" className={cn('h-9 w-9 shrink-0', className)} />;
}

/**
 * Secondary mark — Thriv3 wordmark, cut directly from the brand guide
 * artwork. This is the default desktop product logo. The tagline is
 * rendered as live text (not baked into the image) and is off by
 * default — avoid it inside dense application navigation.
 */
export function Thriv3Wordmark({ className, imgClassName, tagline = false }) {
  return (
    <span className={cn('flex flex-col leading-none', className)}>
      <img src={thriv3Wordmark} alt="Thriv3" className={cn('h-5 w-auto', imgClassName)} />
      {tagline && (
        <span className="mt-1.5 text-[9px] font-semibold tracking-[0.2em] text-muted-foreground">
          RECRUIT. MATCH. THRIVE.
        </span>
      )}
    </span>
  );
}
