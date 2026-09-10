import React, { createContext, useContext, useState } from 'react';

export const ServiceSuspensionContext = createContext(false);

// Portals live outside the service DOM. Close their focus traps during maintenance
// without discarding the owning component's open state or form draft.
export function withServiceSuspension(Root) {
  return function ServiceOverlay({ open, defaultOpen = false, onOpenChange, ...props }) {
    const suspended = useContext(ServiceSuspensionContext);
    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    return <Root {...props} open={!suspended && (open ?? internalOpen)} onOpenChange={next => {
      if (suspended) return;
      setInternalOpen(next);
      onOpenChange?.(next);
    }} />;
  };
}
