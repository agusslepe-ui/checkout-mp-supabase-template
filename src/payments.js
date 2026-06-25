const { MercadoPagoConfig, Payment, Preference } = require("mercadopago");
const { mercadoPagoAccessToken } = require("./config");

const client = new MercadoPagoConfig({ accessToken: mercadoPagoAccessToken });
const preference = new Preference(client);
const payment = new Payment(client);

function createPreference(body) {
  return preference.create({ body });
}

function getPayment(id) {
  return payment.get({ id });
}

module.exports = {
  createPreference,
  getPayment,
};
