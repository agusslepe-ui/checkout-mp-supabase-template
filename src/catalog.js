const CATALOG = {
  "REMERA-LEMONT-001": {
    name: "Remera LEMONT",
    unitPrice: 100,
    currency: "ARS",
    maxQuantity: 10,
  },
};

function getProduct(sku) {
  return CATALOG[sku] || null;
}

module.exports = { getProduct };
