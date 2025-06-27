import React, { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Users, FileText, MessageSquare, Banknote } from 'lucide-react';
import StatCard from './StatCard';

const SiteAnalytics = () => {
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true);
            const { data, error } = await supabase.rpc('get_admin_stats');
            if (error) {
                toast({ title: "Erro ao buscar estatísticas", description: error.message, variant: "destructive" });
            } else {
                setStats(data);
            }
            setLoading(false);
        };
        fetchStats();
    }, [toast]);
    
    if (loading) return <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>;
    if (!stats) return <div className="text-center py-10 text-white">Não foi possível carregar as estatísticas.</div>;
    
    const chartData = [
        { name: 'Usuários', value: stats.total_users },
        { name: 'Posts', value: stats.total_posts },
        { name: 'Contas', value: stats.total_accounts },
        { name: 'Cartões', value: stats.total_cards },
        { name: 'Comentários', value: stats.total_comments },
    ];

    return (
        <div className="space-y-8">
            <h2 className="text-2xl font-bold text-white">Análise do Site</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard icon={Users} title="Total de Usuários" value={stats.total_users} />
                <StatCard icon={MessageSquare} title="Total de Posts" value={stats.total_posts} />
                <StatCard icon={FileText} title="Total de Transações" value={stats.total_transactions} />
                <StatCard icon={Banknote} title="Total de Contas Bancárias" value={stats.total_accounts} />
            </div>
            
            <div className="w-full h-96 glass-effect p-4 rounded-xl">
                 <h3 className="text-lg font-semibold text-white mb-4">Visão Geral do Ecossistema</h3>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} />
                        <XAxis dataKey="name" stroke="#9ca3af" />
                        <YAxis stroke="#9ca3af" />
                        <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', color: '#e5e7eb', borderRadius: '0.5rem' }} cursor={{fill: 'rgba(100, 116, 139, 0.1)'}} />
                        <Legend wrapperStyle={{color: '#9ca3af'}} />
                        <Bar dataKey="value" name="Total" fill="url(#colorUv)" />
                         <defs>
                            <linearGradient id="colorUv" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8}/>
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.3}/>
                            </linearGradient>
                        </defs>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default SiteAnalytics;