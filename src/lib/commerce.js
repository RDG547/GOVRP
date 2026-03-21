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
}) => {
  const { data, error } = await supabase.rpc('buy_product', {
    p_product_id: productId,
    p_payment_method: paymentMethod,
    p_card_id: cardId || null,
  });

  if (error) {
    return {
      success: false,
      data,
      error,
      message: error.message || DEFAULT_PURCHASE_ERROR_MESSAGE,
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
