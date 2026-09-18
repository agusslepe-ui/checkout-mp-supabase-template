/**
 * Contrato interno ShippingProvider (estructural, sin jerarquia de clases).
 * authenticate resuelve el token exclusivamente para consumo del backend.
 * quoteRates recibe un payload autoritativo del ShippingService.
 * listAgencies recibe customerId y provinceCode autoritativos del ShippingService.
 * @typedef {Object} ShippingProvider
 * @property {function(): Promise<string>} authenticate
 * @property {function(Object): Promise<Object>} quoteRates
 * @property {function(Object): Promise<Array>} listAgencies
 * @property {function(Object): Promise<{createdAt: string}>} importShipment
 */

class ShippingProviderError extends Error {
  constructor(type, status = null, details = {}) {
    super(type);
    this.name = "ShippingProviderError";
    this.type = type;
    this.status = status;
    this.requestAttempted = details.requestAttempted === true;
    this.ambiguous = details.ambiguous === true;
    this.retryable = details.retryable === true;
  }
}

module.exports = { ShippingProviderError };
