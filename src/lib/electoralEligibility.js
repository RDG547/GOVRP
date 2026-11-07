// Human-readable status only. Authorization remains enforced in PostgreSQL.
const REASONS = {
  session_required: {
    message: 'Entre na sua conta para verificar sua habilitação eleitoral.',
    action: { label: 'Entrar na conta', to: '/login' },
  },
  account_inactive: {
    message: 'Sua conta não está ativa. Entre em contato com o suporte para verificar a situação.',
    action: { label: 'Abrir suporte', to: '/support' },
  },
  email_unconfirmed: {
    message: 'Confirme seu e-mail para habilitar a emissão do Título de Eleitor. Confira sua caixa de entrada e spam.',
  },
  account_wait_24h: {
    message: 'Sua conta precisa completar 24 horas de cadastro para solicitar o Título de Eleitor e votar.',
  },
  citizen_not_found: {
    message: 'Seu cadastro de cidadão não foi encontrado. Entre em contato com o suporte.',
    action: { label: 'Abrir suporte', to: '/support' },
  },
  citizenship_incomplete: {
    message: 'Você precisa concluir o cadastro de cidadania antes de participar da votação.',
    action: { label: 'Concluir cidadania', to: '/registro-cidadania' },
  },
  title_missing: {
    message: 'Você precisa emitir seu Título de Eleitor no DIC antes de votar.',
    action: { label: 'Solicitar Título no DIC', to: '/services/dic' },
  },
  title_invalid: {
    message: 'Seu Título de Eleitor está inválido ou vencido. Consulte o DIC para regularizar.',
    action: { label: 'Verificar no DIC', to: '/services/dic' },
  },
  title_before_email: {
    message: 'Seu Título de Eleitor foi emitido antes da confirmação do e-mail e precisa de análise da administração.',
    action: { label: 'Solicitar análise', to: '/support' },
  },
  indirect_electorate: {
    message: 'Esta eleição indireta é exclusiva dos parlamentares elegíveis do Congresso. Você pode acompanhar as candidaturas e os resultados.',
  },
  election_not_found: {
    message: 'Esta eleição não foi encontrada. Volte ao Portal Eleitoral e selecione novamente a eleição.',
  },
  electorate_unavailable: {
    message: 'Não foi possível confirmar sua participação no eleitorado desta eleição. Consulte a administração.',
    action: { label: 'Abrir suporte', to: '/support' },
  },
};

export const getVotingEligibilityNotice = (reason, eligibleAt) => {
  const result = REASONS[reason] || REASONS.electorate_unavailable;
  if (reason !== 'account_wait_24h' || !eligibleAt) return result;
  const date = new Date(eligibleAt);
  if (Number.isNaN(date.getTime())) return result;
  return { ...result, message: `${result.message} Prazo: ${date.toLocaleString('pt-BR')}.` };
};
