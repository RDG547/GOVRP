const messages = {
  LEGISLATIVE_APPROVAL_REQUIRED: 'Esta matéria exige aprovação legislativa.',
  PARLIAMENT_HOUSE_MISMATCH: 'Seu cargo não corresponde à Casa legislativa selecionada.',
  PARLIAMENT_AUTHORITY_REQUIRED: 'É necessário um mandato parlamentar vigente para esta ação.',
  DECREE_VALUE_LIMIT: 'O valor excede o limite permitido para decreto. Encaminhe um projeto ao Parlamento.',
  DECREE_DURATION_LIMIT: 'A vigência excede o prazo RP permitido para decreto. Reduza o período ou use a via legislativa.',
  DECREE_DRAFT_REQUIRED: 'Salve o decreto como rascunho antes de publicar.',
  PUBLISHED_NORM_IS_IMMUTABLE: 'Esta norma já foi publicada. Proponha sua alteração ou revogação por um novo ato.',
  ACTIVITY_RESTRICTED_BY_LAW: 'Esta atividade está restrita pela norma vigente. Consulte as regras do país.',
  TAX_EXCEEDS_OPERATION: 'As cobranças ultrapassam o valor da operação. A regra precisa ser revista pela autoridade competente.',
  LEGAL_EFFECT_VOTING_LOCKED: 'A votação já foi aberta. O texto e os efeitos desta proposta não podem mais ser alterados.',
  LEGAL_TEXT_REQUIRED: 'Preencha o título, a ementa e a fundamentação da medida.',
  UNKNOWN_GOVERNMENT_RULE: 'Selecione uma regra existente para alterar ou revogar.',
  RULE_ALREADY_ACTIVE: 'Esta regra já existe. Escolha a opção de alteração.',
  RULE_KIND_MISMATCH: 'O tipo da proposta não corresponde à regra selecionada.',
  INVALID_LEGAL_VALUE: 'Informe valores finitos, não negativos e compatíveis com a medida.',
  INVALID_LEGAL_VALIDITY: 'O fim da vigência precisa ser posterior ao início.',
  INVALID_LEGAL_CATEGORY: 'Informe o nome de uma categoria de produto existente.',
  INVALID_LEGAL_SECTOR: 'Selecione um setor existente.',
  INVALID_LEGAL_THRESHOLD: 'Revise os limites mínimo, máximo e de isenção da operação.',
  INVALID_LEGAL_AUDIENCE: 'Selecione um público válido para a medida.',
  INVALID_TAX_BASIS: 'A base de cálculo e a forma de cobrança são incompatíveis.',
  INVALID_TAX_PAYER: 'Retenção do vendedor só se aplica a vendas.',
  INVALID_PENAL_LIMITS: 'A pena máxima deve ser maior ou igual à mínima e os valores não podem ser negativos.',
  RATE_RULE_OUT_OF_RANGE: 'O percentual deve estar entre 0% e 100%.',
  INVALID_RESTRICTION_HOURS: 'Preencha os dois horários ou deixe ambos vazios.',
  INVALID_RESTRICTION_DAYS: 'Selecione dias da semana válidos.',
  BENEFIT_BUDGET_REQUIRED: 'O benefício precisa de valor positivo, orçamento máximo e data de encerramento.',
  UNSUPPORTED_LEGAL_PARAMETER: 'Esta combinação de parâmetros não é suportada. Revise a medida.',
  LEGAL_SOURCE_ALREADY_IN_FORCE: 'Esta norma já está em vigor. Sua alteração exige uma nova proposta.',
  LEGAL_RULE_NAME_REQUIRED: 'Informe um nome com pelo menos três caracteres.',
  INVALID_DOCUMENT_TYPE: 'Selecione um documento disponível para emissão.',
  BILL_VOTING_NOT_FOUND: 'Abra a votação do projeto antes de concluir sua tramitação.',
  BILL_VOTING_NOT_READY: 'A votação ainda não foi concluída.',
  BILL_RESULT_DOES_NOT_ALLOW_SANCTION: 'O projeto não obteve aprovação para esta etapa.',

  INVALID_PROMOTION: 'O preço promocional deve ser maior que zero e menor que o preço normal.',
  INVALID_PROMOTION_EXPIRY: 'Informe uma data futura válida para o fim da promoção.',
  INVALID_PRICE: 'Informe um preço maior que zero.',
  INVALID_STOCK: 'Informe uma quantidade de estoque válida.',
  OUT_OF_STOCK: 'Este produto está sem estoque.',
  PRODUCT_NOT_FOUND: 'Este produto não está mais disponível.',
  INSUFFICIENT_FUNDS: 'Seu saldo é insuficiente para concluir esta operação.',
  INSUFFICIENT_BALANCE: 'Seu saldo é insuficiente para concluir esta operação.',
  AUTHENTICATION_REQUIRED: 'Entre novamente para continuar.',
  ROLE_NOT_AUTHORIZED: 'Seu cargo não permite esta ação.',
  INVALID_PAGE_CURSOR: 'Não foi possível carregar esta página. Atualize a lista e tente novamente.',
  IDEMPOTENCY_PAYLOAD_MISMATCH: 'Esta confirmação pertence a outra operação. Revise os dados e gere uma nova confirmação.',
  IDEMPOTENCY_KEY_FORBIDDEN: 'Esta confirmação não está disponível para sua conta.',
};

export const DEFAULT_USER_ERROR = 'Não foi possível concluir a ação. Tente novamente.';

// Used at the toast boundary as well as domain calls. Never display database
// diagnostics (which can include table names, SQL and constraint values).
export function userErrorMessage(error, fallback = DEFAULT_USER_ERROR) {
  const message = typeof error === 'string' ? error : error?.message;
  if (typeof message !== 'string' || !message.trim()) return fallback;
  const text = message.trim();
  const code = text.match(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/)?.[0];
  if (messages[text] || messages[code]) return messages[text] || messages[code];
  if (/failed to fetch|network.?error|fetch failed|load failed|connection|timeout|timed out/i.test(text)) {
    return 'Não foi possível conectar ao serviço. Confira sua conexão e tente novamente.';
  }
  if (/permission denied|row.level security|not authorized|unauthorized|forbidden/i.test(text)) {
    return 'Sua conta não tem permissão para realizar esta ação.';
  }
  if (/^(not found|\d{5})$/i.test(text)) return fallback;
  if (code || /^[A-Z][A-Z0-9_]+$/.test(text)
    || /\b(PGRST\d+|SQLSTATE|JWT|PostgREST)\b|requires a WHERE|violates|constraint|duplicate key|invalid input syntax|column .+ does not exist|relation .+ does not exist|schema cache|syntax error|Cannot read|unexpected token|internal server error|is not defined/i.test(text)) return fallback;
  return text;
}

export function sanitizeToast(props) {
  return {
    ...props,
    ...(typeof props.description === 'string' ? { description: userErrorMessage(props.description, DEFAULT_USER_ERROR) } : {}),
  };
}

export function validatePromotion(price, promotionPrice, expiresAt, now = Date.now()) {
  if (!Number.isFinite(promotionPrice) || promotionPrice <= 0 || promotionPrice >= price) return messages.INVALID_PROMOTION;
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now)) return messages.INVALID_PROMOTION_EXPIRY;
  return null;
}
