const CATALOG = {
  "LEM-REM-001-S": {
    sku: "LEM-REM-001-S",
    productCode: "LEM-REM-001",
    name: "Remera LEMONT",
    size: "S",
    checkoutTitle: "Remera LEMONT - Talle S",
    unitPrice: 30000,
    currency: "ARS",
    maxQuantity: 1,
  },
  "LEM-REM-001-M": {
    sku: "LEM-REM-001-M",
    productCode: "LEM-REM-001",
    name: "Remera LEMONT",
    size: "M",
    checkoutTitle: "Remera LEMONT - Talle M",
    unitPrice: 30000,
    currency: "ARS",
    maxQuantity: 1,
  },
  "LEM-REM-001-L": {
    sku: "LEM-REM-001-L",
    productCode: "LEM-REM-001",
    name: "Remera LEMONT",
    size: "L",
    checkoutTitle: "Remera LEMONT - Talle L",
    unitPrice: 30000,
    currency: "ARS",
    maxQuantity: 1,
  },
  "LEM-REM-001-XL": {
    sku: "LEM-REM-001-XL",
    productCode: "LEM-REM-001",
    name: "Remera LEMONT",
    size: "XL",
    checkoutTitle: "Remera LEMONT - Talle XL",
    unitPrice: 30000,
    currency: "ARS",
    maxQuantity: 1,
  },
};

function getProduct(sku) {
  return CATALOG[sku] || null;
}

module.exports = { getProduct };
