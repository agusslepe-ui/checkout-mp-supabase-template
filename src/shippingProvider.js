/**
 * Contrato interno ShippingProvider (estructural, sin jerarquia de clases).
 * authenticate resuelve el token exclusivamente para consumo del backend.
 * quoteRates recibe un payload autoritativo del ShippingService.
 * listAgencies recibe customerId y provinceCode autoritativos del ShippingService.
 * @typedef {Object} ShippingProvider
 * @property {function(): Promise<string>} authenticate
 * @property {function(Object): Promise<Object>} quoteRates
 * @property {function(Object): Promise<Array>} listAgencies
 */

class ShippingProviderError extends Error {
  constructor(type, status = null) {
    super(type);
    this.name = "ShippingProviderError";
    this.type = type;
    this.status = status;
  }
}

module.exports = { ShippingProviderError };
