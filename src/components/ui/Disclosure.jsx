import React, { useId, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A header that opens a body.
 *
 * Extracted rather than hand-rolled a third time: the two copies already in
 * the codebase both omit `aria-expanded` and `aria-controls`, and a list of
 * twenty identical chevrons with no announced state is the case where that
 * actually stops someone using the page. `type="button"` for the same class of
 * reason — a bare button inside a form submits it.
 */
export function Disclosure({
  header, children, open, onOpenChange, className, bodyClassName, chevronClassName,
}) {
  const [uncontrolled, setUncontrolled] = useState(false);
  const isOpen = open ?? uncontrolled;
  const bodyId = useId();

  const toggle = () => {
    if (onOpenChange) onOpenChange(!isOpen);
    else setUncontrolled((v) => !v);
  };

  const Chevron = isOpen ? ChevronUp : ChevronDown;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls={bodyId}
        className="w-full text-left"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">{header}</div>
          <Chevron className={cn('h-4 w-4 shrink-0 text-muted-foreground mt-1', chevronClassName)} />
        </div>
      </button>
      {/* Body is unmounted when closed, so nothing inside it holds state that
          has to survive collapsing — that state belongs to the caller. */}
      {isOpen && (
        <div id={bodyId} className={cn('mt-4 pt-4 border-t border-border space-y-4', bodyClassName)}>
          {children}
        </div>
      )}
    </div>
  );
}
