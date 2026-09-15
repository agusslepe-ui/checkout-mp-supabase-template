// OBSOLETO / no autoritativo para cotización. Conservado por compatibilidad.
// T-019 usa exclusivamente packageProfiles.js (TEMPORAL / QA).
const REMERA_LEMONT_QA_SHIPPING = {
  weightGrams: 300,
  heightCm: 5,
  widthCm: 25,
  lengthCm: 35,
};

// TEMPORAL / TRANSITORIO (T-016 / DEC-021): techo de compra por SKU.
// No representa stock, disponibilidad ni reserva. Debe reemplazarse por
// validación de inventario real del backend.
const TEMPORARY_MAX_QUANTITY = 4;

const CATALOG = {
  "LEM-REM-001-S": {
    sku: "LEM-REM-001-S",
    productCode: "LEM-REM-001",
    name: "Remera LEMONT",
    size: "S",
    checkoutTitle: "Remera LEMONT - Talle S",
    unitPrice: 1000,
    currency: "ARS",
    maxQuantity: TEMPORARY_MAX_QUANTITY,
    shipping: REMERA_LEMONT_QA_SHIPPING,
  },
  "LEM-REM-001-M": {
    sku: "LEM-REM-001-M",
    productCode: "LEM-REM-001",
    name: "Remera LEMONT",
    size: "M",
    checkoutTitle: "Remera LEMONT - Talle M",
    unitPrice: 1000,
    currency: "ARS",
    maxQuantity: TEMPORARY_MAX_QUANTITY,
    shipping: REMERA_LEMONT_QA_SHIPPING,
  },
  "LEM-REM-001-L": {
    sku: "LEM-REM-001-L",
    productCode: "LEM-REM-001",
    name: "Remera LEMONT",
    size: "L",
    checkoutTitle: "Remera LEMONT - Talle L",
    unitPrice: 1000,
    currency: "ARS",
    maxQuantity: TEMPORARY_MAX_QUANTITY,
    shipping: REMERA_LEMONT_QA_SHIPPING,
  },
  "LEM-REM-001-XL": {
    sku: "LEM-REM-001-XL",
    productCode: "LEM-REM-001",
    name: "Remera LEMONT",
    size: "XL",
    checkoutTitle: "Remera LEMONT - Talle XL",
    unitPrice: 1000,
    currency: "ARS",
    maxQuantity: TEMPORARY_MAX_QUANTITY,
    shipping: REMERA_LEMONT_QA_SHIPPING,
  },
};

function getProduct(sku) {
  return CATALOG[sku] || null;
}

module.exports = { getProduct };
