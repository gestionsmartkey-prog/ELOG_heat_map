import type { MappedRow, RawRow } from "./types";
import { foldKey } from "./normalize";

/**
 * Header aliases. A file with different column names needs a line here, not code.
 * Matching is case-, accent- and punctuation-insensitive.
 */
export const HEADER_ALIASES: Record<keyof Omit<MappedRow, "extra">, string[]> = {
  external_id: ["seller id", "seller_id", "sellerid", "id", "id vendedor", "user id", "user_id", "cust_id", "customer id"],
  name: ["nombre", "seller", "nickname", "name", "vendedor", "razon social", "nombre vendedor", "seller name"],
  company: ["empresa", "company", "compania", "razon social empresa"],
  street: ["direccion", "calle", "street", "address", "domicilio"],
  street_number: ["numero", "altura", "nro", "n", "number", "street number"],
  locality: ["barrio", "localidad", "neighborhood", "neighbourhood"],
  city: ["ciudad", "city", "partido", "municipio"],
  province: ["provincia", "province", "estado", "state"],
  postal_code: ["codigo postal", "cp", "cpa", "zip", "zip code", "postal", "postal code"],
  // Not "departamento": in some exports that column is the district, not the flat.
  unit: ["piso", "depto", "dpto", "piso depto", "piso y depto", "piso dpto", "unidad", "oficina", "apartment", "floor", "unit"],
  note: ["informacion adicional", "info adicional", "observaciones", "notas", "nota", "note", "notes", "comentarios", "referencia"],
  lat: ["lat", "latitud", "latitude"],
  lng: ["lng", "lon", "long", "longitud", "longitude"],
};

const aliasIndex: Map<string, keyof Omit<MappedRow, "extra">> = new Map();
for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
  for (const a of aliases) aliasIndex.set(foldKey(a), field as keyof Omit<MappedRow, "extra">);
}

export function resolveHeader(header: string): keyof Omit<MappedRow, "extra"> | null {
  return aliasIndex.get(foldKey(header)) ?? null;
}

function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  const s = String(v).trim();
  return s.length ? s : null;
}

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Map one raw row onto canonical fields. Returns which headers were unmapped. */
export function mapRow(raw: RawRow): { row: MappedRow; unmapped: string[] } {
  const row: MappedRow = {
    external_id: null, name: null, company: null, street: null, street_number: null,
    locality: null, city: null, province: null, postal_code: null, unit: null, note: null,
    lat: null, lng: null, extra: {},
  };
  const unmapped: string[] = [];
  for (const [header, value] of Object.entries(raw)) {
    if (header.startsWith("__")) continue; // sheetjs internals
    const field = resolveHeader(header);
    if (!field) {
      if (value !== null && value !== undefined && String(value).trim() !== "") {
        row.extra[header] = value;
        unmapped.push(header);
      }
      continue;
    }
    if (field === "lat" || field === "lng") row[field] = asNumber(value);
    else if (field === "unit") {
      // "Piso" and "Depto" often come as two columns: keep both, labelled when the value is bare ("3" -> "Piso 3").
      const t = asText(value);
      if (t) {
        const part = /^[a-z0-9]{1,4}$/i.test(t) ? `${header.trim()} ${t}` : t;
        row.unit = row.unit ? `${row.unit} ${part}` : part;
      }
    }
    else if (row[field] === null) row[field] = asText(value);
  }
  return { row, unmapped };
}
