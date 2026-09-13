const { getProduct } = require("./catalog");

const MAX_CART_ITEMS = 50;

class CartError extends Error {
  constructor() {
    super("invalid cart");
    this.name = "CartError";
  }
}

function resolveCart(input) {
  if (!isPlainObject(input)) {
    throw new CartError();
  }

  const items = input.items;
  validateCartItemsSize(items);

  const groupedQuantities = new Map();

  for (const item of items) {
    if (!isPlainObject(item)) {
      throw new CartError();
    }

    const sku = item.sku;
    const quantity = item.quantity;

    if (typeof sku !== "string" || sku === "") {
      throw new CartError();
    }

    if (!isPositiveSafeInteger(quantity)) {
      throw new CartError();
    }

    const previousQuantity = groupedQuantities.get(sku) || 0;
    const groupedQuantity = previousQuantity + quantity;
    if (!Number.isSafeInteger(groupedQuantity)) {
      throw new CartError();
    }

    groupedQuantities.set(sku, groupedQuantity);
  }

  const lines = [];
  let subtotalCents = 0;
  let currency = null;

  for (const [sku, quantity] of groupedQuantities) {
    const product = getProduct(sku);
    if (!product) {
      throw new CartError();
    }

    if (quantity > product.maxQuantity) {
      throw new CartError();
    }

    if (currency && product.currency !== currency) {
      throw new CartError();
    }
    currency = product.currency;

    const unitPriceCents = Math.round(Number(product.unitPrice) * 100);
    if (!isPositiveSafeInteger(unitPriceCents)) {
      throw new CartError();
    }

    const lineSubtotalCents = unitPriceCents * quantity;
    if (!isPositiveSafeInteger(lineSubtotalCents)) {
      throw new CartError();
    }

    subtotalCents += lineSubtotalCents;
    if (!isPositiveSafeInteger(subtotalCents)) {
      throw new CartError();
    }

    lines.push({ product, quantity, unitPriceCents, lineSubtotalCents });
  }

  return { currency, subtotalCents, lines };
}

function summarizeCart(input) {
  const { currency, subtotalCents, lines } = resolveCart(input);
  return {
    currency,
    subtotal: subtotalCents / 100,
    items: lines.map(({ product, quantity, unitPriceCents, lineSubtotalCents }) => ({
      sku: product.sku,
      productName: product.name,
      variant: product.size,
      quantity,
      unitPrice: unitPriceCents / 100,
      lineSubtotal: lineSubtotalCents / 100,
    })),
  };
}

function resolveCheckoutCart(input) {
  const { currency, subtotalCents, lines } = resolveCart(input);
  return {
    currency,
    subtotalCents,
    expectedAmount: subtotalCents / 100,
    orderItems: lines.map(({ product, quantity, unitPriceCents }) => ({
      product_sku: product.sku,
      product_name: product.name,
      product_size: product.size,
      quantity,
      unit_price: unitPriceCents / 100,
    })),
    preferenceItems: lines.map(({ product, quantity, unitPriceCents }) => ({
      title: product.checkoutTitle,
      quantity,
      unit_price: unitPriceCents / 100,
      currency_id: product.currency,
    })),
  };
}

function validateCartItemsSize(items) {
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_CART_ITEMS) {
    throw new CartError();
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPositiveSafeInteger(value) {
  return Number.isInteger(value) && Number.isSafeInteger(value) && value > 0;
}

module.exports = {
  CartError,
  MAX_CART_ITEMS,
  summarizeCart,
  resolveCheckoutCart,
  validateCartItemsSize,
};
