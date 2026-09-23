import { describe, it, expect } from "vitest";
import { classifySeller } from "../../src/ingest/classify";
import { parseNote, noteConflictsWithAddress } from "../../src/ingest/note";
import { addressKey, normalizePostalCode, normalizeProvince, normalizeStreet, normalizeStreetNumber, normalizeUnit, provinceFromPostalCode } from "../../src/ingest/normalize";
import { mapRow } from "../../src/ingest/headers";
import { derivedSellerId, runPipeline, sellerFingerprint } from "../../src/ingest/pipeline";
import { toSql } from "../../src/ingest/loaders/sql";

describe("classifySeller", () => {
  it("detects drop-off agencies from the parent_child id shape", () => {
    expect(classifySeller("542124431_10085", "Centro de envío - Wow")).toEqual({ kind: "dropoff_agency", parent: "542124431" });
  });
  it("detects partners from ARP ids", () => {
    expect(classifySeller("ARP10011077251", "SELF SERVICE PARTNER13").kind).toBe("partner");
  });
  it("treats numeric ids as sellers", () => {
    expect(classifySeller("54307454", "MIX MATCH").kind).toBe("seller");
  });
});

describe("normalize", () => {
  it("collapses province spellings", () => {
    expect(normalizeProvince("Capital Federal")).toBe("CABA");
    expect(normalizeProvince("CABA")).toBe("CABA");
    expect(normalizeProvince("Buenos Aires")).toBe("Buenos Aires");
    expect(normalizeProvince("bs as")).toBe("Buenos Aires");
  });
  it("strips street type prefixes and suffixes", () => {
    expect(normalizeStreet("AV. DE LOS CONSTITUYENTES")).toBe("De los Constituyentes");
    expect(normalizeStreet("Calle Estomba")).toBe("Estomba");
    expect(normalizeStreet("Triunvirato Av")).toBe("Triunvirato");
    expect(normalizeStreet("Ruta Nacional 9")).toBe("Ruta Nacional 9");
  });
  it("handles S/N and numeric numbers", () => {
    expect(normalizeStreetNumber("SN")).toBe("S/N");
    expect(normalizeStreetNumber(2595)).toBe("2595");
  });
  it("reads 4 digits out of CPA postal codes and maps ranges to provinces", () => {
    expect(normalizePostalCode("C1426ABC")).toBe("1426");
    expect(provinceFromPostalCode("1426")).toBe("CABA");
    expect(provinceFromPostalCode("1708")).toBe("Buenos Aires");
  });
  it("builds the same key for spelling variants of one door", () => {
    expect(addressKey("Triunvirato", "5815", "1431", "Villa Urquiza")).toBe(addressKey("TRIUNVIRATO", "5815", "1431", "villa urquiza"));
  });
});

describe("parseNote", () => {
  it("extracts phone, hours and an alternate address", () => {
    const n = parseNote("1156413800 - Soldado De La Independencia 966 (1426) Belgrano CABA Local Entre: Maure Y Gorostiaga");
    expect(n.phone).toBe("1156413800");
    expect(n.address?.street).toBe("Soldado de la Independencia");
    expect(n.address?.postal_code).toBe("1426");
  });
  it("extracts opening hours", () => {
    const n = parseNote("Lunes a viernes de 9 a 13hs. - Lunes a viernes de 15 a 19hs. - Sábados de 10 a 13hs.");
    expect(n.opening_hours).toContain("Lunes a viernes de 9 a 13hs.");
    expect(n.opening_hours?.split(" · ")).toHaveLength(3);
  });
  it("flags a genuinely different door but not a spelling variant", () => {
    const diff = parseNote("Estrada 1921 (1650) Villa Maipú Buenos Aires").address;
    expect(noteConflictsWithAddress(diff, "De los Constituyentes", "2985", "1427")).toBe(true);
    const variant = parseNote("Hipolito Yrigoyen 39 (1708) Morón Buenos Aires").address;
    expect(noteConflictsWithAddress(variant, "H. Yrigoyen", "39", "1708")).toBe(false);
    const typo = parseNote("Monsenor Benoit Haefraingue 726 (1708) Morón Buenos Aires").address;
    expect(noteConflictsWithAddress(typo, "Monseñor Benoit Haefreingue", "726", "1708")).toBe(false);
  });
});

describe("header mapping", () => {
  it("maps known headers case/accent-insensitively and keeps unknown ones in extra", () => {
    const { row, unmapped } = mapRow({ "SELLER ID": 1, "Nombre": "X", "Direccion": "Calle A", "Número": 5, "Codigo Postal": 1426, "Provincia": "CABA", "Volumen mensual": 12 });
    expect(row.external_id).toBe("1");
    expect(row.street).toBe("Calle A");
    expect(row.postal_code).toBe("1426");
    expect(row.extra).toEqual({ "Volumen mensual": 12 });
    expect(unmapped).toEqual(["Volumen mensual"]);
  });
});

describe("runPipeline", () => {
  const rows = [
    { "Seller ID": 1, Nombre: "A", Dirección: "Calle X", Número: 10, Barrio: "Belgrano", Ciudad: "CABA", Provincia: "CABA", "Codigo Postal": 1426, "Información Adicional": null },
    { "Seller ID": 2, Nombre: "B", Dirección: "AV. X", Número: 10, Barrio: "Belgrano", Ciudad: "CABA", Provincia: "Capital Federal", "Codigo Postal": 1426, "Información Adicional": "Zapata 5 (1426) Belgrano CABA" },
    { "Seller ID": "9_1", Nombre: "Centro de envío - Z", Dirección: "Z", Número: 1, Barrio: "Morón", Ciudad: "Morón", Provincia: "Buenos Aires", "Codigo Postal": 1708, "Información Adicional": "Lunes a viernes de 9 a 18hs." },
    { "Seller ID": 2, Nombre: "dup", Dirección: "Q", Número: 1, Barrio: "Morón", Ciudad: "Morón", Provincia: "Buenos Aires", "Codigo Postal": 1708, "Información Adicional": null },
    { "Seller ID": 5, Nombre: "with coords", Dirección: "W", Número: 1, Barrio: "Morón", Ciudad: "Morón", Provincia: "Buenos Aires", "Codigo Postal": 1708, lat: -34.65, lng: -58.62 },
  ];
  it("dedupes doors, classifies kinds, flags conflicts and duplicates, computes h3 when coords exist", async () => {
    const r = await runPipeline(rows, { batch: { filename: "t.xlsx", file_hash: "h", source: "meli", uploaded_by: null } });
    expect(r.sellers).toHaveLength(4);
    expect(r.locations).toHaveLength(3); // X 10 shared by A and B
    expect(r.report.by_kind).toEqual({ seller: 3, dropoff_agency: 1 });
    expect(r.reviews.map((x) => x.reason).sort()).toEqual(["address_conflict", "duplicate_id"]);
    const w = r.locations.find((l) => l.street === "W");
    expect(w?.geocode_status).toBe("ok");
    expect(w?.h3_r9).toMatch(/^89/);
    const z = r.sellers.find((s) => s.external_id === "9_1");
    expect(z?.opening_hours).toBe("Lunes a viernes de 9 a 18hs.");
  });
  it("emits SQL that references every table once per group and escapes quotes", async () => {
    const r = await runPipeline([{ "Seller ID": 7, Nombre: "O'Higgins & Co", Dirección: "O'Higgins", Número: 1, Barrio: "Belgrano", Provincia: "CABA", "Codigo Postal": 1426 }], { batch: { filename: "t.xlsx", file_hash: "h2", source: "meli", uploaded_by: null } });
    const sql = toSql(r);
    expect(sql).toContain("insert into public.import_batches");
    expect(sql).toContain("insert into public.raw_rows");
    expect(sql).toContain("insert into public.locations");
    expect(sql).toContain("insert into public.sellers");
    expect(sql).toContain("O''Higgins & Co");
    expect(sql.trim().endsWith("drop function public._ingest_batch();")).toBe(true);
  });
});

describe("auth credentials", () => {
  it("parses named users and checks them without leaking the fallback", async () => {
    const { parseUsers, checkEnvCredentials, parseAdmins } = await import("../../src/lib/auth");
    const users = parseUsers("Alice:pw1, bob:with:colon\n carol : pw3 ");
    expect([...users.entries()]).toEqual([["alice", "pw1"], ["bob", "with:colon"], ["carol", "pw3"]]);
    process.env.APP_USERS = "demo:secret";
    process.env.APP_ADMINS = "boss:bosspw";
    delete process.env.APP_PASSWORD;
    expect(checkEnvCredentials("Demo", "secret")).toEqual({ user: "demo", role: "viewer" });
    expect(checkEnvCredentials("boss", "bosspw")).toEqual({ user: "boss", role: "admin" });
    expect(parseAdmins().get("boss")).toBe("bosspw");
    expect(checkEnvCredentials("demo", "wrong")).toBeNull();
    expect(checkEnvCredentials("ghost", "secret")).toBeNull();
    process.env.APP_PASSWORD = "shared";
    expect(checkEnvCredentials("anyone", "shared")).toEqual({ user: "anyone", role: "viewer" });
    expect(checkEnvCredentials("demo", "shared")).toBeNull(); // named user must use their own password
    delete process.env.APP_ADMINS;
  });
});

describe("seller identity and dedupe", () => {
  const batch = { filename: "t.xlsx", file_hash: "h", source: "meli", uploaded_by: null };
  const door = { Dirección: "Cabildo", Número: 1234, Barrio: "Belgrano", Provincia: "CABA", "Codigo Postal": 1426 };

  it("keeps different sellers at the same door apart: one location, many sellers", async () => {
    const r = await runPipeline([
      { "Seller ID": 10, Nombre: "Piso uno", ...door, Piso: "1" },
      { "Seller ID": 11, Nombre: "Piso tres", ...door, Piso: "3", Depto: "B" },
      { "Seller ID": 12, Nombre: "Sin piso", ...door },
    ], { batch });
    expect(r.sellers.map((s) => [s.external_id, s.unit])).toEqual([["10", "Piso 1"], ["11", "Piso 3 Depto B"], ["12", null]]);
    expect(r.locations).toHaveLength(1);
    expect(r.reviews).toHaveLength(0);
  });

  it("skips a row repeated with the same data, and flags the same id with different data", async () => {
    const r = await runPipeline([
      { "Seller ID": 20, Nombre: "Tienda", ...door },
      { "Seller ID": 20, Nombre: "TIENDA", ...door },          // same seller, only case differs
      { "Seller ID": 20, Nombre: "Otra tienda", ...door, Piso: "2" }, // same id, different seller data
    ], { batch });
    expect(r.sellers).toHaveLength(1);
    expect(r.report.duplicates_skipped).toBe(1);
    expect(r.reviews).toHaveLength(1);
    expect(r.reviews[0]).toMatchObject({ reason: "duplicate_id", payload: { row_number: 3, first_row: 1, first_name: "Tienda", name: "Otra tienda", unit: "Piso 2" } });
  });

  it("identifies rows without an id by name + door + unit, stably across files", async () => {
    const rows = [
      { Nombre: "Kiosco", ...door, Piso: "PB" },
      { Nombre: "Kiosco", ...door, Piso: "pb" },   // same trio: same seller
      { Nombre: "Kiosco", ...door, Piso: "1" },    // another floor: another seller
      { Nombre: "Almacén", ...door, Piso: "PB" },  // another name: another seller
    ];
    const a = await runPipeline(rows, { batch });
    const b = await runPipeline(rows, { batch });
    expect(a.sellers).toHaveLength(3);
    expect(a.report).toMatchObject({ derived_ids: 3, duplicates_skipped: 1 });
    expect(a.sellers.every((s) => s.external_id.startsWith("sin-id-") && s.kind === "unknown")).toBe(true);
    expect(b.sellers.map((s) => s.external_id)).toEqual(a.sellers.map((s) => s.external_id));
    expect(sellerFingerprint("KIOSCO", "cabildo|1234|1426", "pb")).toBe(sellerFingerprint("Kiosco", "cabildo|1234|1426", "PB"));
    expect(derivedSellerId("x")).toMatch(/^sin-id-[0-9a-f]{12}$/);
  });

  it("reads the unit from the note when there is no column for it", async () => {
    const r = await runPipeline([{ "Seller ID": 30, Nombre: "Depto", ...door, "Información Adicional": "Departamento 6" }], { batch });
    expect(r.sellers[0].unit).toBe("Departamento 6");
    expect(parseNote("Santa Rosa 2194 (1714) Ituzaingó Buenos Aires Pb Referencia: frente").unit).toBe("PB");
    expect(parseNote("Piso 3 Dto B, tocar timbre").unit).toBe("Piso 3 Dto B");
    expect(parseNote("Local de motos, departamento de ventas").unit).toBeNull();
    expect(normalizeUnit("planta baja")).toBe("PB");
  });
});

describe("note address locality", () => {
  it("reads the locality and province that follow the postal code", () => {
    expect(parseNote("Estrada 1921 (1650) Villa Maipú Buenos Aires Empresa Shipnow Referencia: x").address).toMatchObject({ display: "Estrada 1921", postal_code: "1650", locality: "Villa Maipú", province: "Buenos Aires" });
    expect(parseNote("Soldado De La Independencia 966 (1426) Belgrano Belgrano CABA Local").address).toMatchObject({ locality: "Belgrano", province: "CABA" });
    expect(parseNote("Scalabrini Ortiz 561 (1414) CABA CABA").address).toMatchObject({ locality: null, province: "CABA" });
  });

  it("keeps the note's locality on the address conflict it raises", async () => {
    const r = await runPipeline([{ "Seller ID": 40, Nombre: "M", Dirección: "De los Constituyentes", Número: 2985, Barrio: "La Paternal", Provincia: "CABA", "Codigo Postal": 1427, "Información Adicional": "Estrada 1921 (1650) Villa Maipú Buenos Aires Referencia: predio" }], { batch: { filename: "t", file_hash: "h", source: "meli", uploaded_by: null } });
    expect(r.reviews[0]).toMatchObject({ reason: "address_conflict", payload: { note_address: "Estrada 1921", note_locality: "Villa Maipú", note_province: "Buenos Aires" } });
  });
});
