/** Text normalization shared by mapping, dedupe keys and geocoding. */

export function nfc(s: string): string {
  return s.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Lower-case, accent-free, punctuation-free key for header and address matching. */
export function foldKey(s: string): string {
  return stripAccents(s.normalize("NFC"))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function titleCase(s: string): string {
  return nfc(s)
    .toLowerCase()
    .split(" ")
    .map((w) => (["de", "del", "la", "las", "los", "y", "e"].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/^./, (c) => c.toUpperCase());
}

export type ProvinceCode = "CABA" | "Buenos Aires" | string;

/** Collapse the many spellings of the two provinces we see into two values. */
export function normalizeProvince(raw: string | null | undefined): ProvinceCode | null {
  if (!raw) return null;
  const k = foldKey(raw);
  if (/\b(caba|capital federal|capital|ciudad autonoma|ciudad de buenos aires|c a b a)\b/.test(k)) return "CABA";
  if (/\b(buenos aires|bs as|bsas|pba|gba|provincia de buenos aires)\b/.test(k)) return "Buenos Aires";
  return titleCase(raw);
}

/** Argentine CPA like "C1426ABC" or "B1708" carry 4 digits inside. */
export function normalizePostalCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})/);
  return m ? m[1] : null;
}

/** CABA postal codes are 1000-1499; used as a sanity check on geocode results. */
export function provinceFromPostalCode(cp: string | null): ProvinceCode | null {
  if (!cp) return null;
  const n = Number(cp);
  if (!Number.isFinite(n)) return null;
  if (n >= 1000 && n <= 1499) return "CABA";
  if (n >= 1500 && n <= 2999) return "Buenos Aires";
  return null;
}

const STREET_TYPE_PREFIX = /^(calle|av\.?|avda\.?|avenida|bv\.?|bvard\.?|boulevard|boulevar|bulevar|blvd\.?|blv\.?)\s+/i;
const STREET_TYPE_SUFFIX = /\s+(av\.?|avda\.?|avenida|calle)$/i;

/** "Calle Estomba" -> "Estomba", "AV. Triunvirato" -> "Triunvirato". Keeps "Ruta Nacional 9", "Diagonal Norte". */
export function normalizeStreet(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = nfc(raw).replace(/\.{2,}/g, ".");
  s = s.replace(/\s*,\s*$/, "");
  s = s.replace(STREET_TYPE_PREFIX, "").replace(STREET_TYPE_SUFFIX, "");
  if (!s) return null;
  return titleCase(s);
}

export function normalizeStreetNumber(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = nfc(String(raw));
  if (!s) return null;
  if (/^(s\/?n|sin numero|sin número|s\/n°)$/i.test(s)) return "S/N";
  const m = s.match(/\d+/);
  return m ? m[0] : s;
}

/** Stable dedupe key for a physical door. Same key = same location row. */
export function addressKey(street: string | null, number: string | null, postal: string | null, locality: string | null): string | null {
  if (!street) return null;
  const st = foldKey(street).replace(/\s+/g, " ");
  const no = number ? foldKey(number) : "sn";
  // Postal code is the most reliable geography column; fall back to locality.
  const area = postal ?? (locality ? foldKey(locality) : "");
  return `${st}|${no}|${area}`;
}

export function addressDisplay(street: string | null, number: string | null): string {
  if (!street) return "";
  return number && number !== "S/N" ? `${street} ${number}` : `${street} S/N`;
}
