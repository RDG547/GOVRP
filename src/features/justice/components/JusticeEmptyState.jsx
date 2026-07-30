import React from 'react';
import { Inbox } from 'lucide-react';

const JusticeEmptyState = ({ title, description }) => (
  <div className="rounded-xl border border-dashed border-border/80 px-6 py-12 text-center">
    <Inbox className="mx-auto h-10 w-10 text-muted-foreground" />
    <h3 className="mt-4 font-semibold text-foreground">{title}</h3>
    <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{description}</p>
  </div>
);

export default JusticeEmptyState;

