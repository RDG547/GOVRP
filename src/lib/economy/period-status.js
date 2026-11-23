const blocked = {
  blocked_legacy_bounds: 'Os limites históricos divergem do calendário canônico. É necessária revisão autorizada.',
  blocked_children: 'Todos os meses ou trimestres integrantes precisam estar completos e fechados.',
  blocked_previous_period: 'Um período anterior ainda precisa ser concluído ou revisado.',
  blocked_legacy_inputs: 'Os períodos integrantes não possuem todas as capturas contábeis auditáveis. Consulte a prévia de revisão.',
  blocked_transition: 'Período anterior ao início do novo modelo. Seu histórico foi preservado para revisão; os ciclos futuros continuam independentemente.',
};
export function closeStatusMessage(status) {
  if (blocked[status]) return { title: 'Fechamento bloqueado', description: blocked[status], blocked: true };
  if (status === 'not_due') return { title: 'Período ainda não venceu', description: 'O calendário oficial foi preservado.' };
  if (status === 'already_closed') return { title: 'Período já fechado', description: 'O histórico publicado foi preservado.' };
  if (!status || status === 'closed') return { title: 'Fechamento concluído', description: 'Indicadores e hashes foram atualizados.' };
  return { title: 'Fechamento não confirmado', description: 'O processamento retornou uma condição inesperada. Consulte os diagnósticos antes de tentar novamente.', blocked: true };
}
