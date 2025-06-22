
import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { User, Fingerprint, Calendar, Loader2, FileText, Car, Globe } from 'lucide-react';
import { formatCPF, formatRG } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";

const DIC = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState('');

  const fetchDocuments = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase.from('documents').select('*').eq('user_id', user.id);
    if (error) {
      toast({ title: "Erro", description: "Não foi possível carregar seus documentos.", variant: "destructive" });
    } else {
      setDocuments(data);
    }
    setLoading(false);
  }, [user, toast]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleRequestDocument = async (docType) => {
    setRequesting(docType);
    const { error } = await supabase.from('document_requests').insert({ user_id: user.id, document_type: docType });
    if (error) {
      toast({ title: "Erro", description: "Não foi possível processar sua solicitação.", variant: "destructive" });
    } else {
      toast({ title: "Solicitação Enviada", description: `Sua solicitação para ${docType} foi enviada para análise.` });
    }
    setRequesting('');
  };

  const getDoc = (type) => documents.find(d => d.type === type);
  const docTypes = [
    { type: 'CPF', icon: <Fingerprint className="w-8 h-8 text-purple-400" />, getValue: (doc) => doc ? formatCPF(doc.document_number) : 'N/A', getStatus: (doc) => doc?.is_valid },
    { type: 'RG', icon: <FileText className="w-8 h-8 text-purple-400" />, getValue: (doc) => doc ? formatRG(doc.document_number) : 'N/A', getStatus: (doc) => doc?.is_valid },
    { type: 'CNH', icon: <Car className="w-8 h-8 text-purple-400" />, getValue: (doc) => doc ? doc.document_number : 'Não emitida', getStatus: (doc) => doc?.is_valid },
    { type: 'Passport', label: 'Passaporte', icon: <Globe className="w-8 h-8 text-purple-400" />, getValue: (doc) => doc ? doc.document_number : 'Não emitido', getStatus: (doc) => doc?.is_valid },
  ];

  const DocumentCard = ({ icon, title, value, status }) => (
    <div className="flex items-center gap-4 p-4 bg-white/5 rounded-lg">
      {icon}
      <div>
        <p className="text-sm text-gray-400">{title}</p>
        <p className="text-lg font-mono text-white">{value}</p>
      </div>
      {status !== undefined && <span className={`ml-auto text-xs px-2 py-1 rounded-full ${status ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>{status ? 'Válido' : 'Inválido'}</span>}
    </div>
  );

  return (
    <>
      <Helmet><title>DIC - GOV.RP</title><meta name="description" content="Departamento de Identificação Civil do GOV.RP." /></Helmet>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {loading ? <div className="flex justify-center items-center min-h-[60vh]"><Loader2 className="w-12 h-12 animate-spin text-blue-400" /></div> :
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold text-white">Departamento de Identificação <span className="gradient-text">Civil</span></h1>
            <p className="mt-2 text-lg text-gray-300">Sua carteira de documentos digitais.</p>
          </div>
          <div className="glass-effect rounded-2xl p-8 shadow-2xl">
            <div className="flex flex-col sm:flex-row items-center gap-8">
              <div className="flex-shrink-0"><img src={user?.avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${user?.username}`} alt="Avatar" className="w-32 h-32 rounded-full object-cover border-2 border-blue-400" /></div>
              <div className="flex-grow text-center sm:text-left"><h2 className="text-3xl font-bold text-white">{user?.full_name}</h2><p className="text-blue-300">@{user?.username}</p></div>
            </div>
            <div className="border-t border-white/10 my-8"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <DocumentCard icon={<User className="w-8 h-8 text-purple-400" />} title="Nome Civil" value={user?.full_name} />
              <DocumentCard icon={<Calendar className="w-8 h-8 text-purple-400" />} title="Data de Nascimento" value={user?.date_of_birth ? new Date(user.date_of_birth).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'N/A'} />
              {docTypes.map(({type, label, icon, getValue, getStatus}) => {
                const doc = getDoc(type);
                return <DocumentCard key={type} icon={icon} title={label || type} value={getValue(doc)} status={getStatus(doc)} />
              })}
            </div>
            <div className="text-center mt-12">
              <Dialog>
                <DialogTrigger asChild><Button size="lg">Solicitar Documentos</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Solicitar Novo Documento</DialogTitle><DialogDescription>Selecione o documento que deseja solicitar. A solicitação passará por uma análise.</DialogDescription></DialogHeader>
                  <div className="grid gap-4 py-4">
                    <Button variant="outline" onClick={() => handleRequestDocument('CNH')} disabled={!!requesting || !!getDoc('CNH')}>
                      <Car className="mr-2 h-4 w-4" /> Solicitar CNH {requesting === 'CNH' && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                    </Button>
                    <Button variant="outline" onClick={() => handleRequestDocument('Passport')} disabled={!!requesting || !!getDoc('Passport')}>
                      <Globe className="mr-2 h-4 w-4" /> Solicitar Passaporte {requesting === 'Passport' && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </motion.div>}
      </div>
    </>
  );
};

export default DIC;
