import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Home, Trophy, Users, Database, LogOut, Contact } from 'lucide-react';
import { Thriv3Mark, Thriv3Wordmark } from '@/components/Logo';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/sports', label: 'Sports', icon: Trophy },
  { to: '/players', label: 'Players', icon: Users },
  { to: '/representatives', label: 'Representatives', icon: Contact },
  // The review queues still live under /colleges/*; they belong to this entry.
  { to: '/programmes', label: 'Programme DB', icon: Database, also: ['/colleges/'] },
];

export default function Layout() {
  const location = useLocation();
  const { operator, signOut } = useSession();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <Thriv3Mark />
            <Thriv3Wordmark />
          </Link>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map(({ to, label, icon: Icon, also = [] }) => {
              const active = to === '/' ? location.pathname === '/' : [to, ...also].some((p) => location.pathname.startsWith(p));
              return (
                <Link
                  key={to}
                  to={to}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-muted',
                    active && 'bg-primary/10 text-primary'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline whitespace-nowrap">{label}</span>
                </Link>
              );
            })}
            {/* Who is signed in, and the way out. Small and last: it is
                orientation for one operator, not a feature. */}
            {operator && (
              <div className="flex items-center gap-1 ml-2 pl-3 border-l border-border">
                {/* xl, not lg: with seven sections the address squeezed the labels onto two lines at 1024px. */}
                <span className="hidden xl:inline text-xs text-muted-foreground max-w-[14rem] truncate"
                  title={operator.email}>
                  {operator.email}
                </span>
                <button
                  type="button"
                  onClick={signOut}
                  className="flex items-center gap-1.5 px-2 py-2 rounded-md text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="sr-only">Sign out</span>
                </button>
              </div>
            )}
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}
