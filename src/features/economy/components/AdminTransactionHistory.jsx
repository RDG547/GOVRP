import PagedResults from '@/components/ui/paged-results';
import {CurrencyInput} from '@/components/ui/currency-input';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, Loader2, RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/lib/supabaseClient';
import UserSelectOption from '@/components/UserSelectOption';

const PAGE_SIZE = 25;

const INITIAL_FILTERS = {
  search: '',
  type: 'all',
  status: 'all',
  currency: 'all',
  dateFrom: '',
  dateTo: '',
  minAmount: '',
  maxAmount: '',
  senderId: 'all',
  recipientId: 'all',
  sort: 'newest',
};

const transactionTypeLabels = {
  transfer: 'Transferência',
  purchase: 'Compra',
  salary: 'Salário',
  tax: 'Imposto',
  fine_payment: 'Multa',
  exchange: 'Câmbio',
};

const formatMoney = (amount, currency = 'BRL') => new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: currency || 'BRL',
}).format(Number(amount || 0));

const formatDateTime = (value) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'America/Sao_Paulo',
}).format(new Date(value));

const parseOptionalAmount = (value) => {
  if (`${value || ''}`.trim() === '') return null;
  const normalized = `${value}`.replace(/\./g, '').replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};

const formatAccount = (number) => number ? `Conta ${number}` : 'Conta do sistema';

const AdminTransactionHistory = () => {
  const [page, setPage] = useState(1);
  const [draftFilters, setDraftFilters] = useState(INITIAL_FILTERS);
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [selectedRow, setSelectedRow] = useState(null);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');

    const { data, error: queryError } = await supabase.rpc('get_admin_transaction_history', {
      p_page: page,
      p_page_size: PAGE_SIZE,
      p_search: filters.search || null,
      p_type: filters.type === 'all' ? null : filters.type,
      p_status: filters.status === 'all' ? null : filters.status,
      p_currency: filters.currency === 'all' ? null : filters.currency,
      p_date_from: filters.dateFrom || null,
      p_date_to: filters.dateTo || null,
      p_min_amount: parseOptionalAmount(filters.minAmount),
      p_max_amount: parseOptionalAmount(filters.maxAmount),
      p_sender_id: filters.senderId === 'all' ? null : filters.senderId,
      p_recipient_id: filters.recipientId === 'all' ? null : filters.recipientId,
      p_sort: filters.sort,
    });

    if (queryError) {
      setRows([]);
      setTotal(0);
      setError(queryError.message);
    } else {
      const nextRows = data || [];
      setRows(nextRows);
      setTotal(Number(nextRows[0]?.total_count || 0));
    }

    setLoading(false);
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const loadUsers = async () => {
      const { data } = await supabase.rpc('admin_get_all_users');
      setUsers((data || []).map((user) => ({
        id: user.id,
        full_name: user.full_name,
        username: user.username,
        avatar_url: user.avatar_url,
      })));
    };
    void loadUsers();
  }, []);

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setFilters({ ...draftFilters, search: draftFilters.search.trim() });
  };

  const clearFilters = () => {
    setDraftFilters(INITIAL_FILTERS);
    setFilters(INITIAL_FILTERS);
    setPage(1);
  };

  const updateDraft = (key, value) => setDraftFilters((current) => ({ ...current, [key]: value }));

  const selectedSender = users.find((user) => user.id === draftFilters.senderId);
  const selectedRecipient = users.find((user) => user.id === draftFilters.recipientId);
  const findUser = (userId) => users.find((item) => item.id === userId);

  return (
    <Card className="border-border/70 bg-card/75">
      <CardHeader className="gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <CardTitle className="text-base">Histórico nacional de transações</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Movimentações registradas pelo sistema, com busca e filtros oficiais.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={applyFilters} className="grid gap-3 rounded-xl border border-border/60 bg-background/20 p-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="admin-transaction-search">Buscar transação</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="admin-transaction-search"
                value={draftFilters.search}
                onChange={(event) => updateDraft('search', event.target.value)}
                placeholder="Nome, @usuário, conta, ID ou descrição"
                className="pl-9"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-transaction-type">Tipo</Label>
            <Select value={draftFilters.type} onValueChange={(value) => updateDraft('type', value)}>
              <SelectTrigger id="admin-transaction-type">
                <SelectValue placeholder="Todos os tipos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {Object.entries(transactionTypeLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-transaction-status">Situação</Label>
            <Select value={draftFilters.status} onValueChange={(value) => updateDraft('status', value)}>
              <SelectTrigger id="admin-transaction-status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="completed">Concluída</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="failed">Falhou</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-transaction-currency">Moeda</Label>
            <Select value={draftFilters.currency} onValueChange={(value) => updateDraft('currency', value)}>
              <SelectTrigger id="admin-transaction-currency"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as moedas</SelectItem>
                {['BRL', 'USD', 'EUR', 'GBP', 'JPY', 'CNY'].map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-transaction-sort">Ordenar</Label>
            <Select value={draftFilters.sort} onValueChange={(value) => updateDraft('sort', value)}>
              <SelectTrigger id="admin-transaction-sort"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Mais recentes</SelectItem>
                <SelectItem value="oldest">Mais antigas</SelectItem>
                <SelectItem value="amount_desc">Maior valor</SelectItem>
                <SelectItem value="amount_asc">Menor valor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-transaction-from">Data inicial</Label>
            <Input id="admin-transaction-from" type="date" value={draftFilters.dateFrom} onChange={(event) => updateDraft('dateFrom', event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-transaction-to">Data final</Label>
            <Input id="admin-transaction-to" type="date" value={draftFilters.dateTo} onChange={(event) => updateDraft('dateTo', event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-transaction-min">Valor mínimo</Label>
            <CurrencyInput id="admin-transaction-min" inputMode="decimal" value={draftFilters.minAmount} onChange={(event) => updateDraft('minAmount', event.target.value)} placeholder="R$ 0,00" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="admin-transaction-max">Valor máximo</Label>
            <CurrencyInput id="admin-transaction-max" inputMode="decimal" value={draftFilters.maxAmount} onChange={(event) => updateDraft('maxAmount', event.target.value)} placeholder="Sem limite" />
          </div>
          <div className="space-y-2 md:col-span-1 xl:col-span-2">
            <Label htmlFor="admin-transaction-sender">Remetente</Label>
            <Select value={draftFilters.senderId} onValueChange={(value) => updateDraft('senderId', value)}>
              <SelectTrigger id="admin-transaction-sender">
                <SelectValue placeholder="Todos os remetentes">
                  {selectedSender ? <UserSelectOption user={selectedSender} detail={selectedSender.username ? `@${selectedSender.username}` : ''} /> : 'Todos os remetentes'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os remetentes</SelectItem>
                <ScrollArea className="h-72">
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      <UserSelectOption user={user} detail={user.username ? `@${user.username}` : ''} />
                    </SelectItem>
                  ))}
                </ScrollArea>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-1 xl:col-span-2">
            <Label htmlFor="admin-transaction-recipient">Destinatário</Label>
            <Select value={draftFilters.recipientId} onValueChange={(value) => updateDraft('recipientId', value)}>
              <SelectTrigger id="admin-transaction-recipient">
                <SelectValue placeholder="Todos os destinatários">
                  {selectedRecipient ? <UserSelectOption user={selectedRecipient} detail={selectedRecipient.username ? `@${selectedRecipient.username}` : ''} /> : 'Todos os destinatários'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os destinatários</SelectItem>
                <ScrollArea className="h-72">
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      <UserSelectOption user={user} detail={user.username ? `@${user.username}` : ''} />
                    </SelectItem>
                  ))}
                </ScrollArea>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-4">
            <Button type="submit" disabled={loading}><Search className="mr-2 h-4 w-4" />Aplicar filtros</Button>
            <Button type="button" variant="outline" onClick={clearFilters} disabled={loading}>Limpar</Button>
          </div>
        </form>

        {error ? (
          <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            Não foi possível carregar as transações: {error}
          </div>
        ) : null}

        <PagedResults page={page} loading={loading}><div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead className="bg-muted/60 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Origem / destino</th>
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3 text-right">Detalhes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((row) => (
                <tr key={row.id} className="bg-background/25">
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="block">{formatDateTime(row.created_at)}</span>
                    <span className="block max-w-36 truncate font-mono text-[10px] text-muted-foreground" title={row.id}>{row.id}</span>
                  </td>
                  <td className="px-4 py-3">{transactionTypeLabels[row.type] || row.type || 'Outros'}</td>
                  <td className="px-4 py-3">
                    <div className="flex min-w-[19rem] items-center gap-2">
                      <UserSelectOption user={findUser(row.sender_user_id)} label={row.sender_name || 'Sistema'} detail={`${row.sender_username ? `@${row.sender_username} · ` : ''}${formatAccount(row.sender_account_number)}`} />
                      <span className="shrink-0 text-muted-foreground">→</span>
                      <UserSelectOption user={findUser(row.recipient_user_id)} label={row.recipient_name || 'Sistema'} detail={`${row.recipient_username ? `@${row.recipient_username} · ` : ''}${formatAccount(row.recipient_account_number)}`} />
                    </div>
                  </td>
                  <td className="max-w-[320px] truncate px-4 py-3" title={row.description || ''}>
                    {row.description || 'Sem descrição'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                    {formatMoney(row.amount, row.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={row.status === 'failed' ? 'destructive' : 'outline'}>
                      {row.status === 'failed' ? 'Falhou' : row.status === 'pending' ? 'Pendente' : 'Concluída'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedRow(row)} aria-label={`Ver detalhes da transação ${row.id}`}>
                      <Eye className="mr-1 h-4 w-4" /> Ver
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading ? (
            <div className="flex min-h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando transações…
            </div>
          ) : null}
          {!loading && !rows.length && !error ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma transação encontrada.</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString('pt-BR')} registro(s) · Página {page} de {totalPages}
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage((current) => current - 1)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Anterior
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={loading || page >= totalPages} onClick={() => setPage((current) => current + 1)}>
              Próxima <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
        </PagedResults>
      </CardContent>

      <Dialog open={Boolean(selectedRow)} onOpenChange={(open) => !open && setSelectedRow(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detalhes da transação</DialogTitle>
            <DialogDescription className="break-all">{selectedRow?.id}</DialogDescription>
          </DialogHeader>
          {selectedRow ? (
            <div className="space-y-5 text-sm">
              <div className="grid gap-3 rounded-xl border border-border/60 bg-background/30 p-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div>
                  <UserSelectOption user={findUser(selectedRow.sender_user_id)} label={selectedRow.sender_name || 'Sistema'} detail={selectedRow.sender_username ? `@${selectedRow.sender_username}` : ''} />
                  <p className="text-xs text-muted-foreground">{formatAccount(selectedRow.sender_account_number)}</p>
                  {selectedRow.sender_user_id ? <p className="mt-1 break-all text-[11px] text-muted-foreground">{selectedRow.sender_user_id}</p> : null}
                </div>
                <div className="rounded-lg bg-primary/10 px-4 py-3 text-center">
                  <p className="text-lg font-bold text-primary">{formatMoney(selectedRow.amount, selectedRow.currency)}</p>
                  <p className="text-xs text-muted-foreground">→</p>
                </div>
                <div className="sm:text-right">
                  <div className="sm:flex sm:justify-end"><UserSelectOption user={findUser(selectedRow.recipient_user_id)} label={selectedRow.recipient_name || 'Sistema'} detail={selectedRow.recipient_username ? `@${selectedRow.recipient_username}` : ''} /></div>
                  <p className="text-xs text-muted-foreground">{formatAccount(selectedRow.recipient_account_number)}</p>
                  {selectedRow.recipient_user_id ? <p className="mt-1 break-all text-[11px] text-muted-foreground">{selectedRow.recipient_user_id}</p> : null}
                </div>
              </div>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div><dt className="text-muted-foreground">Data e hora</dt><dd>{formatDateTime(selectedRow.created_at)}</dd></div>
                <div><dt className="text-muted-foreground">Tipo e situação</dt><dd>{transactionTypeLabels[selectedRow.type] || selectedRow.type || 'Outros'} · {selectedRow.status}</dd></div>
                <div><dt className="text-muted-foreground">Taxa</dt><dd>{formatMoney(selectedRow.fee_amount, selectedRow.currency)}</dd></div>
                <div><dt className="text-muted-foreground">Imposto</dt><dd>{formatMoney(selectedRow.tax_amount, selectedRow.currency)}</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted-foreground">Descrição</dt><dd>{selectedRow.description || 'Sem descrição'}</dd></div>
                <div className="sm:col-span-2"><dt className="text-muted-foreground">Referência de origem</dt><dd className="break-all">{selectedRow.reference || selectedRow.idempotency_key || 'Não informada'}</dd></div>
              </dl>
              <div>
                <p className="mb-2 text-muted-foreground">Dados complementares</p>
                <pre className="max-h-56 overflow-auto rounded-xl border border-border/60 bg-slate-950/70 p-3 text-xs text-slate-200">{JSON.stringify(selectedRow.metadata || {}, null, 2)}</pre>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default AdminTransactionHistory;
