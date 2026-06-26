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

function getSha256Prefix(value) {
  if (value === undefined || value === null || String(value) === "") {
    return undefined;
  }

  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 8);
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

function canCompareSignature({ timestamp, receivedSignature }) {
  return (
    Boolean(timestamp) &&
    /^\d+$/.test(timestamp) &&
    Boolean(receivedSignature) &&
    /^[a-fA-F0-9]{64}$/.test(receivedSignature)
  );
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

function buildManifestWithoutTrailingSemicolon({ dataId, requestId, timestamp }) {
  return buildManifest({ dataId, requestId, timestamp }).replace(/;$/, "");
}

function buildManifestWithoutRequestId({ dataId, timestamp }) {
  return [`id:${String(dataId)};`, `ts:${timestamp};`].join("");
}

function matchesCandidate({ dataId, requestId, timestamp, receivedSignature }) {
  if (
    dataId === undefined ||
    dataId === null ||
    String(dataId) === "" ||
    typeof requestId !== "string" ||
    requestId === "" ||
    !canCompareSignature({ timestamp, receivedSignature })
  ) {
    return false;
  }

  return compareSignatureHex(
    calculateSignature(buildManifest({ dataId, requestId, timestamp })),
    receivedSignature
  );
}

function matchesFormatCandidate({ manifest, timestamp, receivedSignature }) {
  if (!manifest || !canCompareSignature({ timestamp, receivedSignature })) {
    return false;
  }

  return compareSignatureHex(calculateSignature(manifest), receivedSignature);
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
  const queryOfficialManifest =
    hasQueryDataId && typeof requestId === "string" && requestId !== ""
      ? buildManifest({ dataId: queryDataId, requestId, timestamp: ts })
      : "";
  const queryNoTrailingManifest =
    hasQueryDataId && typeof requestId === "string" && requestId !== ""
      ? buildManifestWithoutTrailingSemicolon({
          dataId: queryDataId,
          requestId,
          timestamp: ts,
        })
      : "";
  const queryWithoutRequestIdManifest = hasQueryDataId
    ? buildManifestWithoutRequestId({ dataId: queryDataId, timestamp: ts })
    : "";
  const bodyOfficialManifest =
    hasBodyDataId && typeof requestId === "string" && requestId !== ""
      ? buildManifest({ dataId: bodyDataId, requestId, timestamp: ts })
      : "";
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
  const hmacFormatOfficialTrailingMatches = matchesFormatCandidate({
    manifest: queryOfficialManifest,
    timestamp: ts,
    receivedSignature: v1,
  });
  const hmacFormatNoTrailingSemicolonMatches = matchesFormatCandidate({
    manifest: queryNoTrailingManifest,
    timestamp: ts,
    receivedSignature: v1,
  });
  const hmacFormatWithoutRequestIdMatches = matchesFormatCandidate({
    manifest: queryWithoutRequestIdManifest,
    timestamp: ts,
    receivedSignature: v1,
  });
  const hmacFormatBodyOfficialMatches = matchesFormatCandidate({
    manifest: bodyOfficialManifest,
    timestamp: ts,
    receivedSignature: v1,
  });
  const hmacFormatMatchName = hmacFormatOfficialTrailingMatches
    ? "official_trailing"
    : hmacFormatNoTrailingSemicolonMatches
      ? "no_trailing_semicolon"
      : hmacFormatWithoutRequestIdMatches
        ? "without_request_id"
        : hmacFormatBodyOfficialMatches
          ? "body_official"
          : "none";
  const queryDataIdSha256Prefix = getSha256Prefix(queryDataId);
  const bodyDataIdSha256Prefix = getSha256Prefix(bodyDataId);
  const xRequestIdSha256Prefix = getSha256Prefix(requestId);
  const signatureTsSha256Prefix = getSha256Prefix(ts);
  const manifestComponentFingerprintsPresent = Boolean(
    queryDataIdSha256Prefix ||
      bodyDataIdSha256Prefix ||
      xRequestIdSha256Prefix ||
      signatureTsSha256Prefix
  );

  return {
    has_query_data_id: hasQueryDataId,
    has_body_data_id: hasBodyDataId,
    query_data_id_type: typeof queryDataId,
    body_data_id_type: typeof bodyDataId,
    query_data_id_length: getValueLength(queryDataId),
    body_data_id_length: getValueLength(bodyDataId),
    query_data_id_sha256_prefix: queryDataIdSha256Prefix,
    body_data_id_sha256_prefix: bodyDataIdSha256Prefix,
    has_x_request_id:
      typeof req.headers["x-request-id"] === "string" &&
      req.headers["x-request-id"] !== "",
    x_request_id_length: getValueLength(requestId),
    x_request_id_sha256_prefix: xRequestIdSha256Prefix,
    has_x_signature:
      typeof signatureHeader === "string" && signatureHeader.trim() !== "",
    has_signature_ts: typeof ts === "string" && ts !== "",
    signature_ts_length: getValueLength(ts),
    signature_ts_sha256_prefix: signatureTsSha256Prefix,
    has_signature_v1: typeof v1 === "string" && v1 !== "",
    signature_v1_length: getValueLength(v1),
    signature_data_source: hasQueryDataId ? "query_data_id" : "missing",
    preserves_literal_data_id: hasQueryDataId,
    manifest_format_name: "mp_official_query_data_id",
    manifest_component_fingerprints_present: manifestComponentFingerprintsPresent,
    hmac_candidate_query_literal_matches: hmacCandidateQueryLiteralMatches,
    hmac_candidate_body_literal_matches: hmacCandidateBodyLiteralMatches,
    hmac_candidate_query_lower_matches: hmacCandidateQueryLowerMatches,
    hmac_candidate_body_lower_matches: hmacCandidateBodyLowerMatches,
    hmac_candidate_any_match: hmacCandidateMatchName !== "none",
    hmac_candidate_match_name: hmacCandidateMatchName,
    hmac_format_official_trailing_matches: hmacFormatOfficialTrailingMatches,
    hmac_format_no_trailing_semicolon_matches: hmacFormatNoTrailingSemicolonMatches,
    hmac_format_without_request_id_matches: hmacFormatWithoutRequestIdMatches,
    hmac_format_body_official_matches: hmacFormatBodyOfficialMatches,
    hmac_format_match_name: hmacFormatMatchName,
  };
}

module.exports = {
  getWebhookSignatureDiagnostics,
  isValidWebhookSignature,
  validateWebhookSignature,
};
