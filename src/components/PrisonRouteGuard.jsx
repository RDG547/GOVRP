import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { isPrisonSentenceActive } from '@/lib/prison';

const ALLOWED_PRISON_PATHS = new Set(['/services/prison', '/auth/callback']);

const PrisonRouteGuard = ({ children }) => {
  const location = useLocation();
  const { user } = useAuth();

  if (
    isPrisonSentenceActive(user) &&
    !ALLOWED_PRISON_PATHS.has(location.pathname)
  ) {
    return (
      <Navigate
        replace
        to="/services/prison"
        state={{ prisonRedirectedFrom: location.pathname }}
      />
    );
  }

  return children;
};

export default PrisonRouteGuard;
