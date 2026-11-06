import React from 'react';
import { formatRealDuration } from '@/lib/justice/time';
import { justiceStatus } from '@/lib/justice/constants';
import { formatCurrency } from '@/lib/utils';
import { formatDateTimeBR } from '@/lib/dateTime';

export default function CriminalCertificateDetails({ records }) {
  if (!records) return <p className="text-xs">Emita um novo atestado na Justiça para consultar o detalhamento dos registros.</p>;
  if (!records.length) return null;
  return <section className="space-y-4" aria-label="Condenações com efeitos vigentes">{records.map(record => <article key={record.id} className="space-y-2 rounded border border-gray-300 p-3 text-xs">
    <h2 className="font-bold">{record.crime}</h2><p>Processo: {record.case_number || 'Registro histórico sem processo vinculado'} · Registro: {formatDateTimeBR(record.recorded_at)}</p>
    <p>Situação: {justiceStatus(record.case_status || record.record_status)}{record.sentence_status && ` · Sentença: ${justiceStatus(record.sentence_status)}`}</p>
    {record.imposed_seconds != null && <><p>Pena de prisão: {record.sentence_units} unidade(s) RP · {formatRealDuration(record.imposed_seconds)} reais</p><p>Tempo efetivamente cumprido: {formatRealDuration(record.served_seconds)} · Crédito/detração: {formatRealDuration(record.credit_seconds || 0)}</p></>}
    {record.custody?.map((term, index) => <p key={`${term.admitted_at}:${index}`}>Custódia: {justiceStatus(term.status)} · Entrada: {formatDateTimeBR(term.admitted_at)}{term.actual_release_at ? ` · Saída: ${formatDateTimeBR(term.actual_release_at)}` : term.expected_release_at ? ` · Término previsto: ${formatDateTimeBR(term.expected_release_at)}` : ''}{term.release_reason ? ` · ${term.release_reason}` : ''}</p>)}
    {record.fines?.map(fine => <p key={fine.id}>Multa: {formatCurrency(fine.amount)} · {justiceStatus(fine.status)}{fine.paid_at ? ` · Paga em ${formatDateTimeBR(fine.paid_at)}` : ''}{fine.refund_transaction_id ? ' · Valor restituído' : ''}</p>)}
  </article>)}</section>;
}
