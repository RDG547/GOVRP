import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import IntegratedCitizenDashboard from '@/components/dashboard/IntegratedCitizenDashboard';
import DashboardSelectorDialog from '@/components/dashboard/DashboardSelectorDialog';

const Dashboard = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const effectiveRoles = Array.isArray(user?.effective_roles)
    ? user.effective_roles
    : [user?.role].filter(Boolean);
  const hasPresidentAccess = effectiveRoles.includes('Presidente');
  const isAdmin = effectiveRoles.includes('Admin') || user?.role === 'Admin';

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-16 w-16 animate-spin text-primary" />
      </div>
    );
  }

  if (isAdmin || hasPresidentAccess) {
    return (
      <DashboardSelectorDialog
        open
        hasPresidentAccess={hasPresidentAccess}
        isAdmin={isAdmin}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) navigate(window.history.length > 1 ? -1 : '/', { replace: true });
        }}
      />
    );
  }

  return <IntegratedCitizenDashboard />;
};

export default Dashboard;
