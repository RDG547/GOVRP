import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { formatDateTimeBR } from '@/lib/dateTime';
import LegalEffectsSummary from './LegalEffectsSummary';
import BillAuthorParty from './BillAuthorParty';
const useCountdown = (endDate) => {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!endDate) {
      setTimeLeft('');
      return undefined;
    }

    const endTime = new Date(endDate).getTime();

    const tick = () => {
      const difference = endTime - Date.now();
      if (difference <= 0) {
        setTimeLeft('Encerrado');
        return;
      }

      const hours = Math.floor(difference / 3600000);
      const minutes = Math.floor((difference % 3600000) / 60000);
      const seconds = Math.floor((difference % 60000) / 1000);
      setTimeLeft(`${hours}h ${String(minutes).padStart(2, '0')}min ${String(seconds).padStart(2, '0')}s`);
    };

    tick();
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
  }, [endDate]);

  return timeLeft;
};

export const CountdownTimer = ({ endDate }) => {
  const timeLeft = useCountdown(endDate);
  if (!timeLeft) {
    return null;
  }

  return <span className="text-xs text-blue-400">⏱ {timeLeft}</span>;
};

export default function BillHistory ({ bills = [] }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const filteredBills =
    statusFilter === 'all'
      ? bills
      : bills.filter(
          (bill) =>
            bill.status === statusFilter ||
            (statusFilter === 'Em votação' && bill.status?.startsWith('Em votação')) ||
            (statusFilter === 'Aguardando ato presidencial' &&
              ['Aguardando sanção presidencial', 'Aguardando promulgação presidencial'].includes(bill.status)) ||
            (statusFilter === 'Convertido em norma' && ['Sancionado', 'Promulgado'].includes(bill.status)) ||
            (statusFilter === 'Vetado' &&
              ['Vetado integralmente', 'Vetado parcialmente'].includes(bill.status))
        );

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Filtrar por status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os Status</SelectItem>
            <SelectItem value="Em tramitação">Em Tramitação</SelectItem>
            <SelectItem value="Em votação">Em Votação</SelectItem>
            <SelectItem value="Aprovado">Aprovados</SelectItem>
            <SelectItem value="Aguardando ato presidencial">Aguardando Ato Presidencial</SelectItem>
            <SelectItem value="Convertido em norma">Convertidos em Norma</SelectItem>
            <SelectItem value="Vetado">Vetados</SelectItem>
            <SelectItem value="Rejeitado">Rejeitados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredBills.length ? (
          filteredBills.map((bill) => {
            const activeVoting = bill.votings?.find((voting) => voting.status === 'active');
            const closedVotings = bill.votings?.filter((voting) => voting.status === 'closed') || [];
            const latestVoting = activeVoting || closedVotings[0];
            const allVotes = latestVoting?.votes || [];
            const votesFor = allVotes.filter((vote) => vote.vote === 'Aprovar').length;
            const votesAgainst = allVotes.filter((vote) => vote.vote === 'Rejeitar').length;
            const votesAbstain = allVotes.filter((vote) => vote.vote === 'Abster').length;
            const totalVotes = votesFor + votesAgainst + votesAbstain;

            const statusMeta = {
              'Em tramitação': { className: 'bg-yellow-500/20 text-yellow-300', label: 'Em Tramitação' },
              'Em votação': { className: 'bg-blue-500/20 text-blue-300', label: 'Em Votação' },
              'Em votação (2ª Casa)': { className: 'bg-indigo-500/20 text-indigo-300', label: 'Em Votação (2ª Casa)' },
              Aprovado: { className: 'bg-green-500/20 text-green-300', label: 'Aprovado' },
              'Aguardando sanção presidencial': { className: 'bg-amber-500/20 text-amber-300', label: 'Aguardando sanção presidencial' },
              'Aguardando promulgação presidencial': { className: 'bg-violet-500/20 text-violet-300', label: 'Aguardando promulgação presidencial' },
              Sancionado: { className: 'bg-emerald-500/20 text-emerald-300', label: 'Sancionado' },
              Promulgado: { className: 'bg-cyan-500/20 text-cyan-300', label: 'Promulgado' },
              'Vetado integralmente': { className: 'bg-rose-500/20 text-rose-300', label: 'Vetado integralmente' },
              'Vetado parcialmente': { className: 'bg-orange-500/20 text-orange-300', label: 'Vetado parcialmente' },
              Rejeitado: { className: 'bg-red-500/20 text-red-300', label: 'Rejeitado' },
            }[bill.status] || { className: 'bg-muted text-muted-foreground', label: bill.status };

            return (
              <motion.div key={bill.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <Card className="glass-effect flex h-full flex-col">
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <Avatar className="h-11 w-11">
                        <AvatarImage src={bill.author_identity_snapshot ? bill.author_identity_snapshot.avatar_url : bill.author?.avatar_url} alt={bill.author_identity_snapshot?.name || bill.author?.full_name} />
                        <AvatarFallback>{(bill.author_identity_snapshot?.name || bill.author?.full_name)?.charAt(0) || 'P'}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <CardTitle className="break-words text-foreground">{bill.title}</CardTitle>
                        <CardDescription>
                          Autor: {bill.author_identity_snapshot?.name || bill.author?.full_name || 'Cidadão indisponível'} | {bill.house?.name}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-grow">
                    <p className="line-clamp-3 text-sm text-muted-foreground">{bill.summary}</p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      <BillAuthorParty bill={bill}/>
                      Proposto em <span className="font-medium text-foreground">{formatDateTimeBR(bill.created_at)}</span>
                    </p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-xs ${statusMeta.className}`}>{statusMeta.label}</span>
                      <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{bill.type}</span>
                      {activeVoting?.end_date ? <CountdownTimer endDate={activeVoting.end_date} /> : null}
                    </div>
                    <LegalEffectsSummary effects={bill.legal_effects} />
                    {bill.full_text && <details className="mt-4 text-sm"><summary className="cursor-pointer rounded py-2 text-primary focus-visible:outline focus-visible:outline-primary">Texto completo do projeto</summary><p className="mt-2 whitespace-pre-wrap break-words">{bill.full_text}</p></details>}
                    {totalVotes ? (
                      <>
                        <div className="mt-4 space-y-2">
                          <div className="flex gap-1">
                            <Progress value={votesFor} max={totalVotes} className="h-2 flex-1" indicatorClassName="bg-green-500" />
                            <Progress
                              value={votesAgainst}
                              max={totalVotes}
                              className="h-2 flex-1"
                              indicatorClassName="bg-red-500"
                            />
                            <Progress
                              value={votesAbstain}
                              max={totalVotes}
                              className="h-2 flex-1"
                              indicatorClassName="bg-gray-500"
                            />
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-green-400">Aprovar: {votesFor}</span>
                            <span className="text-red-400">Rejeitar: {votesAgainst}</span>
                            <span className="text-gray-400">Abster: {votesAbstain}</span>
                          </div>
                        </div>
                      </>
                    ) : bill.status?.startsWith('Em votação') ? (
                      <p className="mt-4 text-center text-xs text-muted-foreground">Nenhum voto registrado ainda.</p>
                    ) : null}
                    {bill.status_history?.length ? (
                      <details className="mt-5 border-t border-white/10 pt-4" open>
                        <summary className="mb-3 cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Histórico de tramitação
                        </summary>
                        <ol className="space-y-0">
                          {bill.status_history.map((event, index) => (
                            <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                              {index < bill.status_history.length - 1 ? (
                                <span aria-hidden="true" className="absolute left-[5px] top-3 h-full w-px bg-white/10" />
                              ) : null}
                              <span aria-hidden="true" className="relative mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-blue-300 bg-slate-950" />
                              <div>
                                <p className="text-sm font-medium text-foreground">{event.event_label}</p>
                                <time dateTime={event.occurred_at} className="text-xs text-muted-foreground">
                                  {formatDateTimeBR(event.occurred_at)}
                                </time>
                              </div>
                            </li>
                          ))}
                        </ol>
                      </details>
                    ) : null}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })
        ) : (
          <p className="col-span-full py-10 text-center text-muted-foreground">
            Nenhum projeto encontrado para o filtro selecionado.
          </p>
        )}
      </div>
    </div>
  );
};
