import { describe, expect, it } from "vitest";
import { toMapSeller, type MapRow } from "../../src/lib/mapRows";

const kinds = [
  { kind: "seller", label: "Seller", counts_as_seller: true, color: null },
  {
    kind: "dropoff_agency",
    label: "Centro de envío",
    counts_as_seller: false,
    color: null,
  },
];

const row = (over: Partial<MapRow> = {}): MapRow => ({
  id: "u1",
  external_id: "123",
  kind: "seller",
  name: "Tienda",
  source: "ml_publico",
  unit: null,
  opening_hours: null,
  note_address: null,
  address_display: "Morón",
  locality: "Morón",
  partido: "Morón",
  province: "Buenos Aires",
  postal_code: null,
  lat: -34.65,
  lng: -58.62,
  h3_r8: "88c2e310abfffff",
  h3_r9: "89c2e310aa7ffff",
  precision: "locality",
  address_edited: false,
  shipments_month: 1200,
  flex_candidate: "si",
  reputation: "5_green",
  power_seller: "gold",
  profile_url: "http://perfil.mercadolibre.com.ar/TIENDA",
  ...over,
});

describe("v_map_sellers rows", () => {
  it("keep the MapSeller shape the map and filters read", () => {
    const s = toMapSeller(row(), kinds);
    expect(s.metrics).toEqual({ shipments_month: 1200 });
    expect(s.attrs).toEqual({
      flex_candidate: "si",
      reputation: "5_green",
      power_seller: "gold",
      profile_url: "http://perfil.mercadolibre.com.ar/TIENDA",
    });
    expect(s.kind_label).toBe("Seller");
    expect(s.counts_as_seller).toBe(true);
    expect(s.h3_r8).toBe("88c2e310abfffff");
  });

  it("omits what the row does not have", () => {
    const s = toMapSeller(
      row({
        shipments_month: null,
        flex_candidate: null,
        reputation: null,
        power_seller: null,
        profile_url: null,
      }),
      kinds,
    );
    expect(s.metrics).toEqual({});
    expect(s.attrs).toEqual({});
  });

  it("reads numeric volume served as a string", () => {
    expect(
      toMapSeller(row({ shipments_month: "250" as unknown as number }), kinds)
        .metrics,
    ).toEqual({ shipments_month: 250 });
  });

  it("labels kinds from the lookup, falling back to the kind", () => {
    expect(
      toMapSeller(row({ kind: "dropoff_agency" }), kinds).counts_as_seller,
    ).toBe(false);
    expect(toMapSeller(row({ kind: "nuevo" }), kinds).kind_label).toBe("nuevo");
  });
});
