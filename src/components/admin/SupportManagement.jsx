import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Headphones, Loader2, Search } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SupportConversation, { SUPPORT_PRIORITY, SUPPORT_STATUS } from '@/components/support/SupportConversation';

const PAGE_SIZE = 10;

const SupportManagement = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tickets, setTickets] = useState([]);
  const [ticketCount, setTicketCount] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadTickets = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    let query = supabase
      .from('support_tickets')
      .select('*', { count: 'exact' })
      .order('last_message_at', { ascending: false })
      .range(from, to);

    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    if (debouncedSearch) {
      const safeSearch = debouncedSearch.replace(/[%_,()]/g, ' ');
      query = query.or(`public_id.ilike.%${safeSearch}%,subject.ilike.%${safeSearch}%,requester_name.ilike.%${safeSearch}%,requester_email.ilike.%${safeSearch}%`);
    }

    const { data, count, error } = await query;
    if (error) {
      toast({ title: 'Erro ao buscar tickets', description: error.message, variant: 'destructive' });
    } else {
      setTickets(data || []);
      setTicketCount(count || 0);
      setSelectedTicket((current) => {
        if (!current) return data?.[0] || null;
        return (data || []).find((ticket) => ticket.id === current.id) || current;
      });
    }
    if (!quiet) setLoading(false);
  }, [debouncedSearch, page, statusFilter, toast]);

  const loadMessages = useCallback(async (ticketId, { quiet = false } = {}) => {
    if (!ticketId) {
      setMessages([]);
      return;
    }
    if (!quiet) setThreadLoading(true);
    const { data, error } = await supabase
      .from('support_ticket_messages')
      .select('*, sender:profiles!support_ticket_messages_sender_id_fkey(full_name, avatar_url, role)')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });
    if (error) toast({ title: 'Erro ao abrir conversa', description: error.message, variant: 'destructive' });
    else setMessages(data || []);
    if (!quiet) setThreadLoading(false);
  }, [toast]);

  useEffect(() => { void loadTickets(); }, [loadTickets]);
  useEffect(() => { void loadMessages(selectedTicket?.id); }, [loadMessages, selectedTicket?.id]);

  useEffect(() => {
    const refreshTickets = () => void loadTickets({ quiet: true });
    const refreshMessages = (payload) => {
      if (payload.new?.ticket_id === selectedTicket?.id || payload.old?.ticket_id === selectedTicket?.id) {
        void loadMessages(selectedTicket.id, { quiet: true });
      }
    };
    const channel = supabase.channel('admin-support-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, refreshTickets)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_ticket_messages' }, refreshMessages)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadMessages, loadTickets, selectedTicket?.id]);

  const updateTicket = async ({ status, priority, accept = false }) => {
    if (!selectedTicket) return false;
    setSaving(true);
    const { error } = await supabase.rpc('admin_manage_support_ticket', {
      p_ticket_id: selectedTicket.id,
      p_status: status ?? selectedTicket.status,
      p_priority: priority ?? selectedTicket.priority,
      p_assigned_to: accept ? user.id : selectedTicket.assigned_to,
    });
    if (error) {
      toast({ title: 'Não foi possível atualizar', description: error.message, variant: 'destructive' });
      setSaving(false);
      return false;
    }
    const nextTicket = {
      ...selectedTicket,
      status: status ?? selectedTicket.status,
      priority: priority ?? selectedTicket.priority,
      assigned_to: accept ? user.id : selectedTicket.assigned_to,
    };
    setSelectedTicket(nextTicket);
    setTickets((current) => current.map((ticket) => ticket.id === nextTicket.id ? nextTicket : ticket));
    toast({ title: accept ? 'Ticket aceito' : 'Ticket atualizado' });
    setSaving(false);
    return true;
  };

  const reply = async (message) => {
    setSaving(true);
    const { error } = await supabase.rpc('reply_to_support_ticket', {
      p_ticket_id: selectedTicket.id,
      p_message: message,
      p_attachment_path: null,
    });
    setSaving(false);
    if (error) {
      toast({ title: 'Resposta não enviada', description: error.message, variant: 'destructive' });
      return false;
    }
    await Promise.all([loadMessages(selectedTicket.id, { quiet: true }), loadTickets({ quiet: true })]);
    return true;
  };

  const totalPages = Math.max(1, Math.ceil(ticketCount / PAGE_SIZE));
  const queueSummary = useMemo(() => ({
    open: tickets.filter((ticket) => ticket.status === 'open').length,
    urgent: tickets.filter((ticket) => ticket.priority === 'urgent').length,
  }), [tickets]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold"><Headphones className="h-6 w-6 text-cyan-300" />Central de Suporte</h2>
          <p className="mt-1 text-sm text-muted-foreground">{ticketCount} solicitações encontradas · {queueSummary.open} abertas nesta página · {queueSummary.urgent} urgentes</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar número, assunto ou cidadão" className="pl-9" />
          </div>
          <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os estados</SelectItem>
              {Object.entries(SUPPORT_STATUS).map(([value, meta]) => <SelectItem key={value} value={value}>{meta.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <aside className="space-y-3">
          {loading ? <div className="flex min-h-56 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div> : tickets.length ? tickets.map((ticket) => {
            const meta = SUPPORT_STATUS[ticket.status] || SUPPORT_STATUS.open;
            return (
              <button key={ticket.id} type="button" onClick={() => setSelectedTicket(ticket)} className={`w-full rounded-xl border p-4 text-left transition-colors ${selectedTicket?.id === ticket.id ? 'border-cyan-400/40 bg-cyan-500/10' : 'border-white/10 bg-white/[0.025] hover:bg-white/5'}`}>
                <div className="flex items-start justify-between gap-2"><span className="font-mono text-xs font-semibold text-cyan-300">{ticket.public_id}</span><Badge variant="outline" className={meta.className}>{meta.label}</Badge></div>
                <p className="mt-2 line-clamp-2 font-medium text-foreground">{ticket.subject}</p>
                <p className="mt-2 truncate text-xs text-muted-foreground">{ticket.requester_name} · {ticket.requester_email}</p>
                <p className="mt-1 text-xs text-muted-foreground">Prioridade {SUPPORT_PRIORITY[ticket.priority]}</p>
              </button>
            );
          }) : <p className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-muted-foreground">Nenhum ticket encontrado.</p>}
          {ticketCount > PAGE_SIZE ? (
            <div className="flex items-center justify-center gap-3">
              <Button variant="outline" size="icon" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}><ChevronLeft className="h-4 w-4" /></Button>
              <span className="text-xs text-muted-foreground">{page} de {totalPages}</span>
              <Button variant="outline" size="icon" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          ) : null}
        </aside>

        <div className="min-w-0 space-y-3">
          {selectedTicket ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.025] p-3">
              {!selectedTicket.assigned_to ? <Button size="sm" onClick={() => updateTicket({ status: 'in_progress', accept: true })} disabled={saving}><CheckCircle2 className="mr-2 h-4 w-4" />Aceitar atendimento</Button> : null}
              <Select value={selectedTicket.status} onValueChange={(status) => updateTicket({ status })} disabled={saving}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(SUPPORT_STATUS).map(([value, meta]) => <SelectItem key={value} value={value}>{meta.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={selectedTicket.priority} onValueChange={(priority) => updateTicket({ priority })} disabled={saving}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(SUPPORT_PRIORITY).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ) : null}
          <SupportConversation ticket={selectedTicket} messages={messages} loading={threadLoading} saving={saving} isAdmin onReply={reply} />
        </div>
      </div>
    </div>
  );
};

export default SupportManagement;
