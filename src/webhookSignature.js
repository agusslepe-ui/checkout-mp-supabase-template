const crypto = require("crypto");
const { mercadoPagoWebhookSecret } = require("./config");

function parseSignatureHeader(signatureHeader) {
  const parts = {};

  if (typeof signatureHeader !== "string") {
    return parts;
  }

  for (const part of signatureHeader.split(",")) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (key === "ts" || key === "v1") {
      parts[key] = value;
    }
  }

  return parts;
}

function getValueLength(value) {
  if (value === undefined || value === null) {
    return 0;
  }

  return String(value).length;
}

function compareSignatureHex(expectedSignature, receivedSignature) {
  const receivedSignatureBuffer = Buffer.from(receivedSignature, "hex");

  return (
    expectedSignature.length === receivedSignatureBuffer.length &&
    crypto.timingSafeEqual(expectedSignature, receivedSignatureBuffer)
  );
}

function calculateSignature(manifest) {
  return crypto
    .createHmac("sha256", mercadoPagoWebhookSecret)
    .update(manifest)
    .digest();
}

function buildManifest({ dataId, requestId, timestamp }) {
  const manifestParts = [];

  if (dataId !== undefined && dataId !== null && String(dataId) !== "") {
    manifestParts.push(`id:${String(dataId)};`);
  }

  if (typeof requestId === "string" && requestId !== "") {
    manifestParts.push(`request-id:${requestId};`);
  }

  manifestParts.push(`ts:${timestamp};`);

  return manifestParts.join("");
}

function matchesCandidate({ dataId, requestId, timestamp, receivedSignature }) {
  if (
    dataId === undefined ||
    dataId === null ||
    String(dataId) === "" ||
    typeof requestId !== "string" ||
    requestId === "" ||
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    !receivedSignature ||
    !/^[a-fA-F0-9]{64}$/.test(receivedSignature)
  ) {
    return false;
  }

  return compareSignatureHex(
    calculateSignature(buildManifest({ dataId, requestId, timestamp })),
    receivedSignature
  );
}

function isValidWebhookSignature({ signatureHeader, requestId, dataId }) {
  const { ts: timestamp, v1: receivedSignature } =
    parseSignatureHeader(signatureHeader);

  if (
    !timestamp ||
    !/^\d+$/.test(timestamp) ||
    !receivedSignature ||
    !/^[a-fA-F0-9]{64}$/.test(receivedSignature)
  ) {
    return false;
  }

  return compareSignatureHex(
    calculateSignature(buildManifest({ dataId, requestId, timestamp })),
    receivedSignature
  );
}

function validateWebhookSignature(req) {
  return isValidWebhookSignature({
    signatureHeader: req.headers["x-signature"],
    requestId: req.headers["x-request-id"],
    dataId: req.query["data.id"],
  });
}

function getWebhookSignatureDiagnostics(req) {
  const signatureHeader = req.headers["x-signature"];
  const { ts, v1 } = parseSignatureHeader(signatureHeader);
  const queryDataId = req.query?.["data.id"];
  const bodyDataId = req.body?.data?.id;
  const requestId = req.headers["x-request-id"];
  const hasQueryDataId =
    queryDataId !== undefined && queryDataId !== null && String(queryDataId) !== "";
  const hasBodyDataId =
    bodyDataId !== undefined && bodyDataId !== null && String(bodyDataId) !== "";
  const hmacCandidateQueryLiteralMatches = matchesCandidate({
    dataId: queryDataId,
    requestId,
    timestamp: ts,
    receivedSignature: v1,
  });
  const hmacCandidateBodyLiteralMatches = matchesCandidate({
    dataId: bodyDataId,
    requestId,
    timestamp: ts,
    receivedSignature: v1,
  });
  const hmacCandidateQueryLowerMatches = matchesCandidate({
    dataId: hasQueryDataId ? String(queryDataId).toLowerCase() : queryDataId,
    requestId,
    timestamp: ts,
    receivedSignature: v1,
  });
  const hmacCandidateBodyLowerMatches = matchesCandidate({
    dataId: hasBodyDataId ? String(bodyDataId).toLowerCase() : bodyDataId,
    requestId,
    timestamp: ts,
    receivedSignature: v1,
  });
  const hmacCandidateMatchName = hmacCandidateQueryLiteralMatches
    ? "query_literal"
    : hmacCandidateBodyLiteralMatches
      ? "body_literal"
      : hmacCandidateQueryLowerMatches
        ? "query_lower"
        : hmacCandidateBodyLowerMatches
          ? "body_lower"
          : "none";

  return {
    has_query_data_id: hasQueryDataId,
    has_body_data_id: hasBodyDataId,
    query_data_id_type: typeof queryDataId,
    body_data_id_type: typeof bodyDataId,
    query_data_id_length: getValueLength(queryDataId),
    body_data_id_length: getValueLength(bodyDataId),
    has_x_request_id:
      typeof req.headers["x-request-id"] === "string" &&
      req.headers["x-request-id"] !== "",
    has_x_signature:
      typeof signatureHeader === "string" && signatureHeader.trim() !== "",
    has_signature_ts: typeof ts === "string" && ts !== "",
    has_signature_v1: typeof v1 === "string" && v1 !== "",
    signature_v1_length: getValueLength(v1),
    signature_data_source: hasQueryDataId ? "query_data_id" : "missing",
    preserves_literal_data_id: hasQueryDataId,
    hmac_candidate_query_literal_matches: hmacCandidateQueryLiteralMatches,
    hmac_candidate_body_literal_matches: hmacCandidateBodyLiteralMatches,
    hmac_candidate_query_lower_matches: hmacCandidateQueryLowerMatches,
    hmac_candidate_body_lower_matches: hmacCandidateBodyLowerMatches,
    hmac_candidate_any_match: hmacCandidateMatchName !== "none",
    hmac_candidate_match_name: hmacCandidateMatchName,
  };
}

module.exports = {
  getWebhookSignatureDiagnostics,
  isValidWebhookSignature,
  validateWebhookSignature,
};
