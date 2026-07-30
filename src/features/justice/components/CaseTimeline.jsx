import React from 'react';
import { Check, Circle, Clock3 } from 'lucide-react';
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_ORDER,
} from '@/lib/justice/constants';

const CaseTimeline = ({ status }) => {
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

export default CaseTimeline;

