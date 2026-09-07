const messages = {
  ROLE_NOT_AUTHORIZED: 'Seu cargo não permite esta ação.',
  AUTHENTICATION_REQUIRED: 'Entre novamente para continuar.',
  SUMMARY_TOO_SHORT: 'O resumo da investigação deve ter pelo menos 20 caracteres.',
  TITLE_TOO_SHORT: 'Informe um título com pelo menos 5 caracteres.',
  DESCRIPTION_TOO_SHORT: 'Descreva os fatos com pelo menos 20 caracteres.',
  INVESTIGATION_ALREADY_EXISTS: 'Esta ocorrência já possui uma investigação aberta.',
  INVESTIGATION_NOT_ASSIGNED: 'Esta investigação está atribuída a outra autoridade.',
  ONLY_ASSIGNED_JUDGE_CAN_DECIDE: 'A decisão cabe ao juiz responsável por este processo.',
  ONLY_ASSIGNED_JUDGE_CAN_SCHEDULE: 'O agendamento cabe ao juiz responsável por este processo.',
  ONLY_ASSIGNED_JUDGE_CAN_COMPLETE: 'A conclusão da audiência cabe ao juiz responsável pelo processo.',
  ONLY_ASSIGNED_JUDGE_CAN_SENTENCE: 'A sentença cabe ao juiz responsável pelo processo.',
  JUDGE_CONFLICT_OF_INTEREST: 'Você está envolvido neste pedido. Outra autoridade deverá decidir.',
  NO_ELIGIBLE_JUDGE: 'Nenhum juiz sem impedimento está disponível para receber este processo.',
  REQUEST_ALREADY_DECIDED: 'Este pedido já foi decidido. A lista será atualizada.',
  CASE_NOT_AWAITING_ADMISSION: 'O processo já saiu da etapa de recebimento da denúncia.',
  LEGAL_REASONING_TOO_SHORT: 'Complete a fundamentação com o mínimo de caracteres indicado.',
  DECISION_REASON_TOO_SHORT: 'A fundamentação da decisão deve ter pelo menos 20 caracteres.',
  WARRANT_NOT_ACTIVE: 'Este mandado já foi cumprido, revogado ou expirou.',
};
export function justiceErrorMessage(error) {
  const message = error?.message || 'Não foi possível concluir a ação. Tente novamente.';
  return messages[message] || userErrorMessage(error);
}
import { userErrorMessage } from '../userErrors';
