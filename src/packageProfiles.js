// TEMPORAL / QA — no usar como dimensiones definitivas de producción.
// Perfiles editables por cantidad TOTAL de prendas; no multiplicar medidas.
const MAX_QUOTE_UNITS = 4;
const PACKAGE_PROFILES = {
  1: { weight: 300, height: 5, width: 25, length: 35 },
  2: { weight: 300, height: 5, width: 25, length: 35 },
  3: { weight: 300, height: 5, width: 25, length: 35 },
  4: { weight: 300, height: 5, width: 25, length: 35 },
};

function getPackageProfile(totalUnits) {
  if (!Number.isInteger(totalUnits) || totalUnits < 1 || totalUnits > MAX_QUOTE_UNITS) return null;
  const profile = PACKAGE_PROFILES[totalUnits];
  return profile ? { ...profile } : null;
}

module.exports = { PACKAGE_PROFILES, MAX_QUOTE_UNITS, getPackageProfile };
