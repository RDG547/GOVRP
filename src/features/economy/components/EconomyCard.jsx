import React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const EconomyCard = ({
  label,
  value,
  detail,
  icon: Icon,
  trend,
  accent = 'text-cyan-300',
}) => {
  const numericTrend = Number(trend);
  const hasTrend = Number.isFinite(numericTrend);
  const TrendIcon = !hasTrend || numericTrend === 0
    ? Minus
    : numericTrend > 0
      ? ArrowUpRight
      : ArrowDownRight;
  const trendColor = !hasTrend || numericTrend === 0
    ? 'text-muted-foreground'
    : numericTrend > 0
      ? 'text-emerald-400'
      : 'text-rose-400';

  return (
    <Card className="border-border/70 bg-card/75 backdrop-blur">
      <CardContent className="p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground">{label}</p>
          {Icon ? (
            <span className="rounded-lg bg-muted/70 p-2">
              <Icon className={`h-4 w-4 ${accent}`} />
            </span>
          ) : null}
        </div>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <div className="mt-2 flex min-h-5 items-center gap-1 text-xs">
          {hasTrend ? (
            <span className={`inline-flex items-center gap-1 ${trendColor}`}>
              <TrendIcon className="h-3.5 w-3.5" />
              {numericTrend > 0 ? '+' : ''}{numericTrend.toLocaleString('pt-BR', {
                maximumFractionDigits: 2,
              })}%
            </span>
          ) : null}
          {detail ? <span className="text-muted-foreground">{detail}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
};

export default EconomyCard;

