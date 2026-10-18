import React, { createContext, useContext } from 'react';

export const PhoneAppContext = createContext(null);
export const PhonePortalContext = createContext(undefined);
export const usePhoneApp = () => useContext(PhoneAppContext);

// Radix overlays belong to the same viewport as their trigger.
export function phonePortal(Portal) {
  return function AppPortal({ container, ...props }) {
    const host = useContext(PhonePortalContext);
    return <Portal {...props} container={container || host}/>;
  };
}

export const PhoneBackContext = createContext(null);
