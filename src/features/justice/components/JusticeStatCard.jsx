import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

const JusticeStatCard = ({
  icon: Icon,
  label,
  value,
  description,
  tone = 'blue',
}) => {
  const tones = {
    blue: 'border-blue-500/25 bg-blue-500/10 text-blue-300',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    red: 'border-red-500/25 bg-red-500/10 text-red-300',
    green: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
    violet: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
  };

  return (
    <Card className="glass-effect overflow-hidden">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`rounded-xl border p-3 ${tones[tone] || tones.blue}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-bold text-foreground">{value}</p>
          <p className="font-medium text-foreground">{label}</p>
          {description ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
};

export default JusticeStatCard;

