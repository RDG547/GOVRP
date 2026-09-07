const messages = {
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
