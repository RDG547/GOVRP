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
  const isAdmin = user?.is_platform_admin || rolePool.includes('Admin') || user?.role === 'Admin';
  const isAdminArea = isAdmin && (location.pathname === '/admin-dashboard' || location.pathname.startsWith('/admin-dashboard/'));
  const isAllowed = allowedWhileIncomplete.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));

  if (session && user && user.onboarding_completed === false && !user.is_admin_preview && !isAdminArea && !isAllowed) {
    return <Navigate to="/registro-cidadania" replace state={{ from: location.pathname }} />;
  }

  return <React.Fragment key={user?.citizen_id || 'visitor'}>{children}</React.Fragment>;
};

export default CitizenOnboardingGate;
