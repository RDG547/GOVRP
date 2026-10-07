import { userErrorMessage } from './userErrors';
const PURCHASE_ERRORS = {
  INVALID_CART: 'Revise os itens e as quantidades do carrinho (até 100 unidades).',
  SUBSCRIPTION_ALREADY_ACTIVE: 'Você já possui uma assinatura ativa deste produto.',
  SUBSCRIPTION_QUANTITY_INVALID: 'Adicione apenas uma unidade de cada assinatura.',
  CART_PRICE_CHANGED: 'O preço ou a tributação mudou. Confira o novo total e confirme novamente. Nenhum item foi cobrado.',
  LISTING_RENEWAL_REQUIRED: 'Este anúncio aguarda renovação pelo vendedor. Nenhum valor foi cobrado.',
  PRODUCT_NOT_AVAILABLE: 'Este anúncio está suspenso, removido ou aguardando aprovação.',
  MARKETPLACE_UNAVAILABLE: 'O marketplace está temporariamente indisponível.',
  MARKETPLACE_RECEIVING_ACCOUNT_REQUIRED: 'A gestão do marketplace precisa regularizar sua conta de recebimento.',
  COMMISSION_EXCEEDS_PROCEEDS: 'A comissão e os tributos excedem o valor da venda. A operação não foi cobrada.',
  INSUFFICIENT_BALANCE: 'Seu saldo não é suficiente para esta compra.',
  INSUFFICIENT_CARD_LIMIT: 'O cartão não tem limite disponível para esta compra.',
  ACTIVITY_RESTRICTED_BY_LAW: 'Esta atividade está suspensa pela norma vigente.',
  TAX_EXCEEDS_OPERATION: 'Os tributos vigentes excedem o valor da operação. A compra não foi cobrada.',
  PRODUCT_OUT_OF_STOCK: 'Este produto está sem estoque.',
  PRODUCT_NOT_FOUND: 'Este produto não está mais disponível.',
  OWN_PRODUCT_PURCHASE_DENIED: 'Você não pode comprar seu próprio produto.',
  INVALID_CARD: 'Selecione um cartão ativo que pertença a você.',
  BUSINESS_NOT_ACTIVE: 'Esta empresa não está disponível para vendas.',
  SELLER_OWNERSHIP_CHANGED: 'O responsável por este produto mudou. Atualize o anúncio.',
  SELLER_BANK_ACCOUNT_REQUIRED: 'O vendedor precisa de uma conta para receber esta compra.',
  BUYER_BANK_ACCOUNT_REQUIRED: 'Abra sua conta no Banco Nacional antes de comprar.',
  IDEMPOTENCY_KEY_FORBIDDEN: 'Esta confirmação pertence a outra conta. Abra uma nova compra.',
  IDEMPOTENCY_PAYLOAD_MISMATCH: 'Os dados desta confirmação mudaram. Abra uma nova compra.',
};
const DEFAULT_PURCHASE_ERROR_MESSAGE = 'Ocorreu um erro inesperado durante a compra.';
const DEFAULT_PURCHASE_SUCCESS_MESSAGE = 'Compra realizada com sucesso!';

const hasBooleanStatus = (value) =>
  value &&
  typeof value === 'object' &&
  ('success' in value || 'ok' in value);

const getResultMessage = (value, fallbackMessage) => {
  if (!value) {
    return fallbackMessage;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object') {
    return value.message || value.error || value.detail || fallbackMessage;
  }

  return fallbackMessage;
};

export const executeProductPurchase = async ({
  supabase,
  productId,
  paymentMethod,
  cardId,
  idempotencyKey = crypto.randomUUID(),
}) => {
  let response;
  try {
    response = await supabase.rpc('buy_product', {
      p_product_id: productId,
      p_payment_method: paymentMethod,
      p_card_id: paymentMethod === 'card' ? cardId || null : null,
      p_idempotency_key: idempotencyKey,
    });
  } catch (error) {
    return { success: false, data: null, error, message: 'A conexão falhou. Tente novamente com esta mesma confirmação de compra.' };
  }
  const { data, error } = response;

  if (error) {
    return {
      success: false,
      data,
      error,
      message: PURCHASE_ERRORS[error.message] || DEFAULT_PURCHASE_ERROR_MESSAGE,
    };
  }

  if (hasBooleanStatus(data)) {
    const success = Boolean(data.success ?? data.ok);

    return {
      success,
      data,
      error: null,
      message: getResultMessage(
        data,
        success ? DEFAULT_PURCHASE_SUCCESS_MESSAGE : DEFAULT_PURCHASE_ERROR_MESSAGE
      ),
    };
  }

  return {
    success: Boolean(data),
    data,
    error: null,
    message: getResultMessage(
      data,
      data ? DEFAULT_PURCHASE_SUCCESS_MESSAGE : DEFAULT_PURCHASE_ERROR_MESSAGE
    ),
  };
};

export const purchaseErrorMessage = error => PURCHASE_ERRORS[error?.message] || userErrorMessage(error, DEFAULT_PURCHASE_ERROR_MESSAGE);
