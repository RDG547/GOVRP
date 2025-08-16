import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, ShieldCheck, Search, PlusCircle } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';

const ArmedForces = () => {
    const { toast } = useToast();
    const [operations, setOperations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchOperations = useCallback(async () => {
        setLoading(true);
        let query = supabase
            .from('armed_forces_operations')
            .select('*, commander:profiles(full_name)')
            .order('created_at', { ascending: false });

        if (searchTerm) {
            query = query.ilike('name', `%${searchTerm}%`);
        }
        
        const { data, error } = await query;
        if (error) {
            toast({ title: "Erro ao carregar operações", variant: "destructive" });
            console.error("Error fetching operations:", error);
        } else {
            setOperations(data || []);
        }
        
        setLoading(false);
    }, [searchTerm, toast]);

    useEffect(() => {
        fetchOperations();
    }, [fetchOperations]);

    return (
        <>
            <Helmet>
                <title>Forças Armadas - GOV.RP</title>
                <meta name="description" content="Painel de controle das Forças Armadas." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={ShieldCheck}
                    title="Forças Armadas"
                    gradientText="Cidadão"
                    description="Defendendo a soberania e a segurança da nação."
                    iconColor="text-emerald-500"
                />
                
                <div className="flex justify-between items-center mb-8">
                     <div className="relative w-full md:w-1/2">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                        type="text"
                        placeholder="Pesquisar por operação..."
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
                                    <TableHead>Operação</TableHead>
                                    <TableHead>Comandante</TableHead>
                                    <TableHead>Data de Início</TableHead>
                                    <TableHead className="text-right">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {operations.map(op => (
                                    <TableRow key={op.id} className="border-b-border">
                                        <TableCell className="font-medium">{op.name}</TableCell>
                                        <TableCell>{op.commander?.full_name || 'N/A'}</TableCell>
                                        <TableCell>{op.start_date ? format(new Date(op.start_date), 'dd/MM/yyyy HH:mm') : 'Não definida'}</TableCell>
                                        <TableCell className="text-right">
                                            <span className={`px-2 py-1 text-xs rounded-full ${
                                                op.status === 'Em andamento' ? 'bg-yellow-500/20 text-yellow-300' :
                                                op.status === 'Concluída' ? 'bg-green-500/20 text-green-300' :
                                                op.status === 'Cancelada' ? 'bg-red-500/20 text-red-300' :
                                                'bg-gray-500/20 text-gray-300'
                                            }`}>{op.status}</span>
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

export default ArmedForces;