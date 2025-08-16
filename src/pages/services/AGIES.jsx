import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Eye, Search, PlusCircle } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';

const AGIES = () => {
    const { toast } = useToast();
    const [missions, setMissions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchMissions = useCallback(async () => {
        setLoading(true);
        let query = supabase
            .from('agies_missions')
            .select('*, agent:profiles(full_name)')
            .order('created_at', { ascending: false });

        if (searchTerm) {
            query = query.ilike('name', `%${searchTerm}%`);
        }
        
        const { data, error } = await query;
        if (error) {
            toast({ title: "Erro ao carregar missões", variant: "destructive" });
            console.error("Error fetching missions:", error);
        } else {
            setMissions(data || []);
        }
        
        setLoading(false);
    }, [searchTerm, toast]);

    useEffect(() => {
        fetchMissions();
    }, [fetchMissions]);

    return (
        <>
            <Helmet>
                <title>AGIES - GOV.RP</title>
                <meta name="description" content="Painel da Agência de Inteligência e Espionagem Suprema." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Eye}
                    title="AGIES"
                    gradientText="Cidadão"
                    description="Agência de Inteligência e Espionagem Suprema. A vigilância é a nossa virtude."
                    iconColor="text-red-500"
                />
                
                <div className="flex justify-between items-center mb-8">
                     <div className="relative w-full md:w-1/2">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                        type="text"
                        placeholder="Pesquisar por missão..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-6 text-lg"
                        />
                    </div>
                </div>

                <div className="glass-effect rounded-lg overflow-hidden">
                     {loading ? (
                        <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                     ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent border-b-border">
                                    <TableHead>Missão</TableHead>
                                    <TableHead>Agente Responsável</TableHead>
                                    <TableHead>Data de Início</TableHead>
                                    <TableHead className="text-right">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {missions.map(mission => (
                                    <TableRow key={mission.id} className="border-b-border">
                                        <TableCell className="font-medium">{mission.name}</TableCell>
                                        <TableCell>{mission.agent?.full_name || 'N/A'}</TableCell>
                                        <TableCell>{mission.start_date ? format(new Date(mission.start_date), 'dd/MM/yyyy') : 'Não definida'}</TableCell>
                                        <TableCell className="text-right">
                                            <span className={`px-2 py-1 text-xs rounded-full ${
                                                mission.status === 'Em Andamento' ? 'bg-yellow-500/20 text-yellow-300' :
                                                mission.status === 'Concluída' ? 'bg-green-500/20 text-green-300' :
                                                'bg-gray-500/20 text-gray-300'
                                            }`}>{mission.status}</span>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </div>
        </>
    );
};

export default AGIES;