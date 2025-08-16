import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Users, Landmark, MessageSquare, CreditCard, FileText, BarChart } from 'lucide-react';
import StatCard from './StatCard';
import { useAuth } from '@/contexts/AuthContext';

const SiteAnalytics = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  useEffect(() => {
    const fetchStats = async () => {
      if (user && user.role === 'Admin') {
        setLoading(true);
        const { data, error } = await supabase.rpc('get_admin_dashboard_stats');
        if (error) {
          console.error("Error fetching stats:", error);
        } else {
          setStats(data);
        }
        setLoading(false);
      }
    };
    fetchStats();
  }, [user]);

  const statItems = [
    { icon: Users, label: 'Total de Usuários', value: stats?.total_users, color: 'text-blue-400' },
    { icon: Landmark, label: 'Contas Bancárias', value: stats?.total_accounts, color: 'text-green-400' },
    { icon: MessageSquare, label: 'Posts no X', value: stats?.total_posts, color: 'text-sky-400' },
    { icon: CreditCard, label: 'Cartões Emitidos', value: stats?.total_cards, color: 'text-purple-400' },
    { icon: FileText, label: 'Transações Totais', value: stats?.total_transactions, color: 'text-yellow-400' },
    { icon: BarChart, label: 'Comentários Totais', value: stats?.total_comments, color: 'text-orange-400' },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {statItems.map((item, index) => (
        <StatCard key={index} {...item} loading={loading} />
      ))}
    </div>
  );
};

export default SiteAnalytics;