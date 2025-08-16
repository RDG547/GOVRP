import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Gavel, Search, PlusCircle } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const PenalSystem = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [records, setRecords] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchRecords = useCallback(async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('criminal_records')
                .select('*, profile:profiles!criminal_records_user_id_fkey(full_name), judge:profiles!criminal_records_judge_id_fkey(full_name)')
                .order('created_at', { ascending: false });

            if (searchTerm) {
                query = query.ilike('profile.full_name', `%${searchTerm}%`);
            }
            
            const { data, error } = await query;
            if (error) throw error;
            setRecords(data);
        } catch (error) {
            toast({ title: 'Erro ao buscar registros', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [searchTerm, toast]);

    useEffect(() => {
        fetchRecords();
    }, [fetchRecords]);
    
    return (
        <>
            <Helmet>
                <title>Sistema Penal - GOV.RP</title>
                <meta name="description" content="Consulte registros criminais e o status do sistema prisional." />
            </Helmet>
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <PageHeader
                    icon={Gavel}
                    title="Sistema"
                    gradientText="Penal"
                    description="Registros criminais e status de sentenças da comunidade."
                    iconColor="text-amber-400"
                />
                
                <div className="flex justify-between items-center mb-8">
                     <div className="relative w-full md:w-1/2">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
                        <Input
                        type="text"
                        placeholder="Pesquisar por nome..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-6 bg-white/5 border-white/10 rounded-lg"
                        />
                    </div>
                </div>

                <div className="glass-effect rounded-lg overflow-hidden">
                     {loading ? (
                        <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-blue-400" /></div>
                     ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="hover:bg-transparent border-b-white/10">
                                    <TableHead className="text-white">Condenado</TableHead>
                                    <TableHead className="text-white">Crime</TableHead>
                                    <TableHead className="text-white">Juiz</TableHead>
                                    <TableHead className="text-white">Data da Sentença</TableHead>
                                    <TableHead className="text-white">Fim da Pena</TableHead>
                                    <TableHead className="text-white text-right">Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {records.map(record => (
                                    <TableRow key={record.id} className="border-b-white/10">
                                        <TableCell>{record.profile.full_name}</TableCell>
                                        <TableCell>{record.crime}</TableCell>
                                        <TableCell>{record.judge?.full_name || 'N/A'}</TableCell>
                                        <TableCell>{record.sentence_start_date ? format(new Date(record.sentence_start_date), 'dd/MM/yyyy') : 'N/A'}</TableCell>
                                        <TableCell>{record.sentence_end_date ? format(new Date(record.sentence_end_date), 'dd/MM/yyyy') : 'N/A'}</TableCell>
                                        <TableCell className="text-right">
                                            <span className={`px-2 py-1 text-xs rounded-full ${record.is_active ? 'bg-red-500/20 text-red-300' : 'bg-green-500/20 text-green-300'}`}>
                                                {record.is_active ? 'Ativa' : 'Cumprida'}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {records.length === 0 && (
                                    <TableRow><TableCell colSpan="6" className="text-center text-muted-foreground">Nenhum registro encontrado.</TableCell></TableRow>
                                )}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </div>
        </>
    );
};

export default PenalSystem;