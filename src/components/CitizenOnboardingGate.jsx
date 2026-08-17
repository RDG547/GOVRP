import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const allowedWhileIncomplete = [
  '/registro-cidadania', '/settings', '/support', '/terms', '/privacy',
  '/account-deletion', '/auth/callback', '/update-password',
];

const CitizenOnboardingGate = ({ children }) => {
  const { user, session } = useAuth();
  const location = useLocation();
  const rolePool = Array.isArray(user?.effective_roles) ? user.effective_roles : [user?.role];
  const isAdmin = rolePool.includes('Admin') || user?.role === 'Admin';
  const isAllowed = allowedWhileIncomplete.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));

  if (session && user && user.onboarding_completed === false && !isAdmin && !isAllowed) {
    return <Navigate to="/registro-cidadania" replace state={{ from: location.pathname }} />;
  }

  if (session && user?.onboarding_completed === true && location.pathname === '/registro-cidadania') {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default CitizenOnboardingGate;

