export const JUSTICE_AUTHORITY_ROLES = [
  'Admin',
  'Policial',
  'Police',
  'Delegado',
  'Promotor',
  'Advogado',
  'Defensor Público',
  'Juiz',
  'Agente Penitenciário',
  'Diretor Penitenciário',
];

export const CASE_STATUS_LABELS = {
  draft: 'Rascunho',
  investigation: 'Em investigação',
  delegate_review: 'Análise do delegado',
  sent_to_prosecutor: 'Enviado ao Ministério Público',
  awaiting_charge: 'Aguardando denúncia',
  charge_filed: 'Denúncia apresentada',
  judicial_review: 'Análise judicial',
  initial_defense: 'Defesa inicial',
  instruction: 'Instrução',
  hearing_scheduled: 'Audiência marcada',
  awaiting_sentence: 'Aguardando sentença',
  convicted: 'Condenado — cabe recurso',
  acquitted: 'Absolvido — cabe recurso',
  archived: 'Arquivado',
  appeal: 'Em recurso',
  final: 'Trânsito em julgado',
  execution: 'Em execução penal',
  served: 'Pena cumprida',
};

export const CASE_STATUS_ORDER = Object.keys(CASE_STATUS_LABELS);

export const OCCURRENCE_TYPES = [
  'Crime contra a pessoa',
  'Crime contra o patrimônio',
  'Crime contra a administração pública',
  'Crime eleitoral',
  'Crime econômico',
  'Crime contra a segurança nacional',
  'Crime relacionado a organização',
  'Infração de trânsito ou administrativa',
  'Outro',
];

export const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' },
];

export const PRIORITY_LABELS = PRIORITY_OPTIONS.reduce((labels, option) => {
  labels[option.value] = option.label;
  return labels;
}, {});

export const PRIORITY_STYLES = {
  low: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
  normal: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
  high: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  urgent: 'border-red-500/30 bg-red-500/10 text-red-300',
};

export const REQUEST_TYPE_LABELS = {
  arrest_warrant: 'Mandado de prisão',
  search_warrant: 'Mandado de busca',
  rp_confidentiality_break: 'Quebra de sigilo do RP',
  preventive_detention: 'Prisão preventiva',
  temporary_detention: 'Prisão temporária',
  provisional_release: 'Liberdade provisória',
  bail: 'Fiança',
  evidence_production: 'Produção de prova',
  prison_transfer: 'Transferência de preso',
};

export const CUSTODY_STATUS_LABELS = {
  awaiting_intake: 'Aguardando entrada',
  provisional: 'Custódia provisória',
  serving: 'Cumprindo pena',
  released: 'Libertado',
  transferred: 'Transferido',
};

export const rolePoolFor = (user) => {
  const values = Array.isArray(user?.effective_roles)
    ? user.effective_roles
    : [user?.role, user?.stored_role];

  return [...new Set(values.filter(Boolean))];
};

export const hasAnyJusticeRole = (user, roles = JUSTICE_AUTHORITY_ROLES) => {
  const normalized = new Set(rolePoolFor(user).map((role) => role.toLocaleLowerCase('pt-BR')));
  return roles.some((role) => normalized.has(role.toLocaleLowerCase('pt-BR')));
};

export const primaryJusticeRole = (user) => {
  const roles = rolePoolFor(user);
  return JUSTICE_AUTHORITY_ROLES.find((role) => roles.includes(role)) || 'Cidadão';
};


export const JUSTICE_STATUS_LABELS = {
  ...CASE_STATUS_LABELS, ...CUSTODY_STATUS_LABELS,
  in_progress: 'Em andamento', pending: 'Pendente', open: 'Aberto', closed: 'Encerrado',
  dismissed: 'Arquivado', rejected: 'Rejeitado', approved: 'Aprovado', denied: 'Indeferido', granted: 'Deferido',
  under_review: 'Em análise', filed: 'Protocolado', requested: 'Solicitado', scheduled: 'Agendado',
  completed: 'Concluído', cancelled: 'Cancelado', canceled: 'Cancelado', active: 'Ativo', expired: 'Expirado',
  executed: 'Cumprido', revoked: 'Revogado', issued: 'Emitido', paid: 'Pago', unpaid: 'Não pago',
  overdue: 'Vencido', awaiting_payment: 'Aguardando pagamento', appealed: 'Em recurso',
  annulled: 'Anulado', conviction: 'Condenação', legacy: 'Registro histórico',
  admitted: 'Recebido', accepted: 'Aceito', awaiting_analysis: 'Aguardando análise',
};
export function justiceStatus(value, context = '') {
  if (value === 'dismissed' && context === 'request') return 'Indeferido';
  return JUSTICE_STATUS_LABELS[value] || (/[_]|^[a-z]+$/.test(value || '') ? 'Situação em atualização' : value || 'Não informado');
}
