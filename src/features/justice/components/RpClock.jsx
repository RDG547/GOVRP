import React, { useEffect, useState } from 'react';
import { Clock3, PauseCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatRpDate } from '@/lib/justice/time';

const RpClock = ({ settings }) => {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-background/55 px-4 py-3 backdrop-blur">
      {settings?.is_paused ? (
        <PauseCircle className="h-5 w-5 text-amber-300" />
      ) : (
        <Clock3 className="h-5 w-5 text-cyan-300" />
      )}
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Calendário oficial
        </p>
        <p className="font-semibold text-foreground">{formatRpDate(settings, now)}</p>
      </div>
      <Badge variant="outline" className="ml-auto">
        {settings?.is_paused ? 'Pausado' : '1 ano RP = 1 semana real'}
      </Badge>
    </div>
  );
};

export default RpClock;

