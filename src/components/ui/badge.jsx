import React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium', {
  variants: {
    variant: {
      default: 'bg-primary/10 text-primary',
      accent: 'bg-accent/10 text-accent',
      muted: 'bg-muted text-muted-foreground',
      green: 'bg-emerald-500/15 text-emerald-400',
      amber: 'bg-amber-500/15 text-amber-400',
      blue: 'bg-blue-500/15 text-blue-400',
      purple: 'bg-purple-500/15 text-purple-400',
      red: 'bg-red-500/15 text-red-400',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Badge({ className, variant, ...props }) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
