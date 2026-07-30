import React from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const tooltipStyle = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '10px',
  color: 'hsl(var(--foreground))',
};

const EconomyChart = ({
  title,
  description,
  data,
  series,
  xKey = 'label',
  type = 'line',
  height = 280,
}) => {
  const Chart = type === 'bar' ? BarChart : type === 'area' ? AreaChart : LineChart;
  const Primitive = type === 'bar' ? Bar : type === 'area' ? Area : Line;

  return (
    <Card className="border-border/70 bg-card/75">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent>
        {data?.length ? (
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              <Chart data={data} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.45} />
                <XAxis dataKey={xKey} tick={{ fontSize: 11 }} minTickGap={18} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} />
                {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
                {series.map((item) => (
                  <Primitive
                    key={item.key}
                    type="monotone"
                    dataKey={item.key}
                    name={item.name}
                    stroke={item.color}
                    fill={item.color}
                    fillOpacity={type === 'area' ? 0.16 : 0.8}
                    strokeWidth={2}
                    radius={type === 'bar' ? [6, 6, 0, 0] : undefined}
                    dot={false}
                  />
                ))}
              </Chart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
            O histórico aparecerá após os próximos fechamentos oficiais.
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default EconomyChart;

