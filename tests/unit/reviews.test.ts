import { describe, expect, it } from "vitest";
import { normalizeAddressInput } from "../../src/lib/reviews";
import { addressKey, normalizeStreet, normalizeStreetNumber } from "../../src/ingest/normalize";

describe("normalizeAddressInput", () => {
  it("gives a corrected address the key a file with that spelling would get", () => {
    const a = normalizeAddressInput({ street: "Av. Cabildo", number: "1234", locality: "belgrano", postal_code: "C1426ABC" });
    expect(a).toMatchObject({ street: "Cabildo", number: "1234", display: "Cabildo 1234", locality: "Belgrano", province: "CABA", postal_code: "1426" });
    expect(a?.key).toBe(addressKey(normalizeStreet("CABILDO"), normalizeStreetNumber(1234), "1426", "Belgrano"));
  });

  it("takes the province from the postal code over the typed one, and needs a street", () => {
    expect(normalizeAddressInput({ street: "Rivadavia", number: 17849, province: "CABA", postal_code: 1708 })?.province).toBe("Buenos Aires");
    expect(normalizeAddressInput({ street: "  ", number: "5" })).toBeNull();
    expect(normalizeAddressInput({ street: "Zapata", number: "s/n" })?.display).toBe("Zapata S/N");
  });
});
