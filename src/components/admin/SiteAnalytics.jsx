import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp, Users, MessageSquare, DollarSign, CreditCard, Loader2 } from 'lucide-react';
import StatCard from './StatCard';

// O componente agora recebe 'growthStats'
const SiteAnalytics = ({ stats, growthStats, loading }) => {

  if (loading) {
    return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Total de Usuários" value={stats.total_users ?? 0} icon={Users} color="text-blue-400" />
        <StatCard title="Posts Publicados" value={stats.total_posts ?? 0} icon={MessageSquare} color="text-green-400" />
        <StatCard title="Transações" value={stats.total_transactions ?? 0} icon={DollarSign} color="text-yellow-400" />
        <StatCard title="Contas Bancárias" value={stats.total_accounts ?? 0} icon={CreditCard} color="text-purple-400" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Estatísticas Detalhadas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Comentários Totais</span>
              <span className="font-bold">{stats.total_comments ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cartões Emitidos</span>
              <span className="font-bold">{stats.total_cards ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Taxa de Engajamento</span>
              <span className="text-green-400 font-bold">
                {(stats.total_posts > 0 ? ((stats.total_comments / stats.total_posts) * 100).toFixed(1) : 0)}%
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Crescimento (Últimas 24h)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Removemos Math.random() e usamos os dados reais de growthStats */}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Novos Usuários</span>
              <span className="text-green-400 font-bold">+{growthStats.new_users_last_24h ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Novos Posts</span>
              <span className="text-blue-400 font-bold">+{growthStats.new_posts_last_24h ?? 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Novas Transações</span>
              <span className="text-yellow-400 font-bold">+{growthStats.new_transactions_last_24h ?? 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default SiteAnalytics;