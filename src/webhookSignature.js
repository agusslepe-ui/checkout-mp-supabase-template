const crypto = require("crypto");
const { mercadoPagoWebhookSecret } = require("./config");

function isValidWebhookSignature({ signatureHeader, requestId, dataId }) {
  let timestamp;
  let receivedSignature;

  for (const part of signatureHeader.split(",")) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (key === "ts") {
      timestamp = value;
    } else if (key === "v1") {
      receivedSignature = value;
    }
  }

  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    !receivedSignature ||
    !/^[a-fA-F0-9]{64}$/.test(receivedSignature)
  ) {
    return false;
  }

  const manifestParts = [];

  if (dataId !== undefined && dataId !== null && String(dataId) !== "") {
    manifestParts.push(`id:${String(dataId).toLowerCase()};`);
  }

  if (typeof requestId === "string" && requestId !== "") {
    manifestParts.push(`request-id:${requestId};`);
  }

  manifestParts.push(`ts:${timestamp};`);

  const expectedSignature = crypto
    .createHmac("sha256", mercadoPagoWebhookSecret)
    .update(manifestParts.join(""))
    .digest();
  const receivedSignatureBuffer = Buffer.from(receivedSignature, "hex");

  return (
    expectedSignature.length === receivedSignatureBuffer.length &&
    crypto.timingSafeEqual(expectedSignature, receivedSignatureBuffer)
  );
}

function validateWebhookSignature(req) {
  return isValidWebhookSignature({
    signatureHeader: req.headers["x-signature"],
    requestId: req.headers["x-request-id"],
    dataId: req.query["data.id"],
  });
}

module.exports = {
  isValidWebhookSignature,
  validateWebhookSignature,
};
