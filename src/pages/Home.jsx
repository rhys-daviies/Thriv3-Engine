import React from 'react';
import { Link } from 'react-router-dom';
import { Target, Brain, School, TrendingUp, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

const FEATURES = [
  { icon: Target, title: 'Position Matching', desc: 'Finds programs that need your exact position — starters graduating, roster gaps to fill.' },
  { icon: Brain, title: 'AI-Powered Analysis', desc: 'Cross-references roster data and program quality to rank every candidate school.' },
  { icon: School, title: 'Division Fit', desc: 'Matches your competitive level to the right division and program tier — not too high, not too low.' },
  { icon: TrendingUp, title: 'Academic Alignment', desc: 'Filters for schools that meet your academic bar, so every match is one you would actually consider.' },
];

export default function Home() {
  return (
    <div className="space-y-20">
      <section className="text-center max-w-3xl mx-auto pt-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold tracking-wide" style={{ animation: 'pulse-badge 2.5s ease-in-out infinite' }}>
          <Sparkles className="h-3.5 w-3.5" />
          COLLEGE SOCCER RECRUITMENT
        </div>
        <h1 className="font-heading text-4xl sm:text-5xl font-bold mt-6 leading-tight">
          Find Your Perfect <span className="text-primary">College Fit</span>
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          RecruitMatch uses AI to analyze your player profile and match you with the US college soccer programs where you actually have a shot — based on roster needs, program quality, and academics.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/sports">Get Started</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/players">View Players</Link>
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {FEATURES.map(({ icon: Icon, title, desc }) => (
          <Card key={title} className="p-6 hover:border-primary/30 hover:shadow-sm transition-all">
            <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center mb-4">
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="font-heading font-semibold mb-1">{title}</h3>
            <p className="text-sm text-muted-foreground">{desc}</p>
          </Card>
        ))}
      </section>
    </div>
  );
}
