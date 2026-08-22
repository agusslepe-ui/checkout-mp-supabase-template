class CheckoutInputError extends Error {
  constructor() {
    super("invalid checkout input");
    this.name = "CheckoutInputError";
  }
}

const ARGENTINA_PROVINCES = new Set([
  "AR-A", "AR-B", "AR-C", "AR-D", "AR-E", "AR-F",
  "AR-G", "AR-H", "AR-J", "AR-K", "AR-L", "AR-M",
  "AR-N", "AR-P", "AR-Q", "AR-R", "AR-S", "AR-T",
  "AR-U", "AR-V", "AR-W", "AR-X", "AR-Y", "AR-Z",
]);

function parseCheckoutInput(body) {
  const customer = body?.customer;
  const delivery = body?.delivery;

  if (!isPlainObject(customer) || !isPlainObject(delivery)) {
    throw new CheckoutInputError();
  }

  const firstName = normalizeRequired(customer.firstName, 2, 60);
  const lastName = normalizeRequired(customer.lastName, 2, 60);
  const email = normalizeEmail(customer.email);
  const phone = normalizePhone(customer.phone);
  const province = normalizeRequired(delivery.province, 4, 4).toUpperCase();
  const locality = normalizeRequired(delivery.locality, 2, 80);
  const postalCode = normalizePostalCode(delivery.postalCode);
  const street = normalizeRequired(delivery.street, 2, 100);
  const streetNumber = normalizeRequired(delivery.streetNumber, 1, 12);
  const apartment = normalizeOptional(delivery.apartment, 30);
  const notes = normalizeOptional(delivery.notes, 250);

  if (!isPersonName(firstName) || !isPersonName(lastName)) {
    throw new CheckoutInputError();
  }

  if (!ARGENTINA_PROVINCES.has(province)) {
    throw new CheckoutInputError();
  }

  return {
    customer_first_name: firstName,
    customer_last_name: lastName,
    customer_email: email,
    customer_phone: phone,
    shipping_country_code: "AR",
    shipping_province: province,
    shipping_locality: locality,
    shipping_postal_code: postalCode,
    shipping_street: street,
    shipping_street_number: streetNumber,
    shipping_apartment: apartment,
    shipping_notes: notes,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRequired(value, minLength, maxLength) {
  if (typeof value !== "string") throw new CheckoutInputError();

  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new CheckoutInputError();
  }

  return normalized;
}

function normalizeOptional(value, maxLength) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new CheckoutInputError();

  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new CheckoutInputError();
  return normalized;
}

function isPersonName(value) {
  return /^[\p{L}\p{M}][\p{L}\p{M}' -]*$/u.test(value);
}

function normalizeEmail(value) {
  const email = normalizeRequired(value, 5, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new CheckoutInputError();
  }
  return email;
}

function normalizePhone(value) {
  const phone = normalizeRequired(value, 10, 30);
  if (!/^[+\d\s().-]+$/.test(phone)) throw new CheckoutInputError();

  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new CheckoutInputError();
  }
  return digits;
}

function normalizePostalCode(value) {
  const postalCode = normalizeRequired(value, 4, 8).toUpperCase();
  if (!/^\d{4}$/.test(postalCode) && !/^[A-Z]\d{4}[A-Z]{3}$/.test(postalCode)) {
    throw new CheckoutInputError();
  }
  return postalCode;
}

module.exports = { CheckoutInputError, parseCheckoutInput };
