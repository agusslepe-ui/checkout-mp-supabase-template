const { PACKAGE_PROFILES, MAX_QUOTE_UNITS, getPackageProfile } = require("../src/packageProfiles");

test("perfiles QA aprobados 1–4 y copias independientes", () => {
  expect(MAX_QUOTE_UNITS).toBe(4);
  for (let units = 1; units <= 4; units += 1) {
    expect(getPackageProfile(units)).toEqual({ weight: 300, height: 5, width: 25, length: 35 });
    const copy = getPackageProfile(units);
    copy.weight = 999;
    expect(PACKAGE_PROFILES[units].weight).toBe(300);
  }
  for (const units of [0, 5, -1, 1.5, "2", NaN]) expect(getPackageProfile(units)).toBeNull();
});
