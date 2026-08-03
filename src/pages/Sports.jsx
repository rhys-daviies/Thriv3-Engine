import React from 'react';
import { Link } from 'react-router-dom';
import { Trophy, Sparkles, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { SPORTS } from '@/lib/sports';

const DESCRIPTIONS = {
  'mens-soccer': "Match with men's college soccer programs based on roster needs and program fit.",
  'womens-soccer': "Match with women's college soccer programs based on roster needs and program fit.",
  'womens-field-hockey': "Match with women's field hockey programs across every division.",
  'mens-ice-hockey': "Match with men's ice hockey programs across every division.",
  'mens-volleyball': "Match with men's volleyball programs across every division.",
  'womens-volleyball': "Match with women's volleyball programs across every division.",
};

export default function Sports() {
  return (
    <div className="space-y-10">
      <div className="text-center max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
          <Sparkles className="h-3.5 w-3.5" />
          SIX SPORTS SUPPORTED
        </div>
        <h1 className="font-heading text-3xl font-bold mt-4">Choose Your Sport</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your sport determines which college database and roster data we match you against.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SPORTS.map((sport) => (
          <Link key={sport.id} to={`/new-player?sport=${sport.id}`}>
            <Card className="p-6 h-full hover:border-primary/30 hover:shadow-sm transition-all flex flex-col">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center mb-4">
                <Trophy className="h-5 w-5" />
              </div>
              <h3 className="font-heading text-lg font-semibold">{sport.label}</h3>
              <p className="text-sm text-muted-foreground mt-1 flex-1">{DESCRIPTIONS[sport.id]}</p>
              <div className="mt-4 flex items-center gap-1 text-sm font-medium text-primary">
                Get Started <ArrowRight className="h-4 w-4" />
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
