import { justiceStatus } from '@/lib/justice/constants';
import React from 'react';
import { Check, Circle, Clock3 } from 'lucide-react';
import { formatJusticeDate } from '@/lib/justice/time';
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_ORDER,
} from '@/lib/justice/constants';

const TimelineContent = ({ status, events = [] }) => {
  if (events.length) {
    return (
      <ol className="space-y-3 border-l border-cyan-400/25 pl-5">
        {events.map((event) => (
          <li key={event.id} className="relative rounded-lg border border-border/60 bg-background/35 p-3">
            <span className="absolute -left-[1.55rem] top-4 h-2.5 w-2.5 rounded-full bg-cyan-300 ring-4 ring-background" />
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-medium">{event.title}</p>
              <time className="text-xs text-muted-foreground">{formatJusticeDate(event.created_at)}</time>
            </div>
            {event.description ? <p className="mt-1 text-sm text-muted-foreground">{event.description}</p> : null}
            {event.status_from !== event.status_to && event.status_to ? (
              <p className="mt-2 text-xs text-cyan-200">
                {justiceStatus(event.status_from) || 'Início'} → {justiceStatus(event.status_to)}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    );
  }
  const currentIndex = CASE_STATUS_ORDER.indexOf(status);
  const compactSteps = [
    'investigation',
    'sent_to_prosecutor',
    'charge_filed',
    'initial_defense',
    'hearing_scheduled',
    'awaiting_sentence',
    status === 'acquitted' ? 'acquitted' : 'convicted',
    status === 'appeal' ? 'appeal' : 'final',
    status === 'served' ? 'served' : 'execution',
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {compactSteps.map((step) => {
        const stepIndex = CASE_STATUS_ORDER.indexOf(step);
        const completed = currentIndex > stepIndex;
        const active = status === step;
        const Icon = completed ? Check : active ? Clock3 : Circle;

        return (
          <div
            key={step}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
              active
                ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                : completed
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                  : 'border-border/60 text-muted-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{CASE_STATUS_LABELS[step]}</span>
          </div>
        );
      })}
    </div>
  );
};

const CaseTimeline = ({ status, events = [] }) => <details className="rounded-lg border p-3"><summary className="min-h-10 cursor-pointer py-2 font-medium focus-visible:outline focus-visible:outline-primary">Histórico do caso · {events.length} {events.length === 1 ? 'evento' : 'eventos'}</summary><div className="mt-3"><TimelineContent status={status} events={events}/></div></details>;
export default CaseTimeline;
