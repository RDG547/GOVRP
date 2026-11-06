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
  embedded = false,
}) => {
  const Chart = type === 'bar' ? BarChart : type === 'area' ? AreaChart : LineChart;
  const Primitive = type === 'bar' ? Bar : type === 'area' ? Area : Line;
  const Container = embedded ? 'section' : Card;
  const Header = embedded ? 'div' : CardHeader;
  const Content = embedded ? 'div' : CardContent;

  return (
    <Container className={embedded ? 'min-w-0 space-y-2' : 'border-border/70 bg-card/75'}>
      <Header>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </Header>
      <Content>
        {data?.length ? (
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <Chart data={data} margin={{ top: 5, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.45} />
                <XAxis dataKey={xKey} tick={{ fontSize: 11 }} minTickGap={18} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip position={{ x: 0, y: 0 }} wrapperStyle={{ maxWidth: '100%' }} contentStyle={{ ...tooltipStyle, maxWidth: '100%', overflowWrap: 'anywhere' }} />
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
                    dot={data.length === 1 ? { r: 3 } : false}
                  />
                ))}
              </Chart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className={`flex items-center justify-center text-sm text-muted-foreground ${embedded ? 'min-h-24' : 'h-56'}`}>
            O histórico aparecerá após os próximos fechamentos oficiais.
          </div>
        )}
      </Content>
    </Container>
  );
};

export default EconomyChart;

