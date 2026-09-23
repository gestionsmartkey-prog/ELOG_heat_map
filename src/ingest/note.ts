import { nfc, normalizePostalCode, normalizeProvince, normalizeStreet, normalizeStreetNumber, normalizeUnit, foldKey, titleCase } from "./normalize";

export type ParsedNote = {
  phone: string | null;
  opening_hours: string | null;
  address: {
    street: string; number: string | null; postal_code: string | null; display: string;
    /** "Villa Maipú" from "Estrada 1921 (1650) Villa Maipú Buenos Aires …"; null when only the province follows. */
    locality: string | null;
    province: string | null;
  } | null;
  /** "Piso 3 Dto 4", "Departamento 6", "PB", "Oficina 2", "Local 5". */
  unit: string | null;
  remainder: string;
};

const PHONE_RE = /(?:\+?54\s?)?(?:9\s?)?(?:\(?0?11\)?[\s-]?)?\d{4}[\s-]?\d{4}\b|\b\d{10,11}\b/;
const DAY = "(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)";
const HOURS_RE = new RegExp(
  `${DAY}(?:\\s+a\\s+${DAY})?(?:\\s+de)?\\s+\\d{1,2}(?::\\d{2})?(?:\\s*hs?\\.?)?\\s*(?:a|-|hasta)\\s*\\d{1,2}(?::\\d{2})?\\s*hs?\\.?`,
  "gi",
);
// "Soldado De La Independencia 966 (1426) Belgrano ..." or "Av. Warnes 1255 (1414) Villa Crespo CABA"
// A unit needs a number or a single letter after the keyword, so "Departamento de ventas" or "Local de motos" do not count.
const FLAT = "(?:dto|dpto|depto|departamento)\\.?\\s*(?:\\d{1,4}[a-z]?\\b|[a-z]\\b)";
const UNIT_RE = new RegExp(
  `\\b(?:piso\\s*\\d{1,2}(?:\\s*[°º])?(?:\\s*${FLAT})?|${FLAT}|planta baja|pb\\b|oficina\\s*\\d{1,4}\\b|of\\.\\s*\\d{1,4}\\b|uf\\s*\\d{1,4}\\b|local\\s*\\d{1,4}\\b)`,
  "i",
);
// What follows the postal code: "Villa Maipú Buenos Aires …", "Belgrano Belgrano CABA …", "CABA CABA".
const AFTER_CP_RE = /^\s*(.*?)\s*\b(caba|capital federal|buenos aires)\b/i;
const ADDRESS_RE = /^\s*([A-Za-zÁ-ÿ'.\-\s]{3,}?)\s+(\d{1,5}|s\/n)\s*\((\d{4})\)/i;

/**
 * The free-text column mixes phone numbers, opening hours, a second address and
 * delivery notes. We pull out what we can and keep the rest verbatim.
 */
export function parseNote(raw: string | null | undefined): ParsedNote {
  if (!raw) return { phone: null, opening_hours: null, address: null, unit: null, remainder: "" };
  let text = nfc(raw);

  let phone: string | null = null;
  const phoneMatch = text.match(PHONE_RE);
  if (phoneMatch) {
    const digits = phoneMatch[0].replace(/\D/g, "");
    if (digits.length >= 10) {
      phone = digits;
      text = text.replace(phoneMatch[0], " ").replace(/^\s*-\s*/, "");
    }
  }

  const hours = text.match(HOURS_RE);
  let opening_hours: string | null = null;
  if (hours && hours.length) {
    opening_hours = hours.map((h) => nfc(h)).join(" · ");
    for (const h of hours) text = text.replace(h, " ");
  }

  let address: ParsedNote["address"] = null;
  const addr = text.match(ADDRESS_RE);
  if (addr) {
    const street = normalizeStreet(addr[1]);
    if (street) {
      const number = normalizeStreetNumber(addr[2]);
      const after = text.slice((addr.index ?? 0) + addr[0].length).match(AFTER_CP_RE);
      address = {
        street,
        number,
        postal_code: normalizePostalCode(addr[3]),
        display: number && number !== "S/N" ? `${street} ${number}` : `${street} S/N`,
        locality: after ? noteLocality(after[1]) : null,
        province: after ? normalizeProvince(after[2]) : null,
      };
    }
  }

  const unitMatch = text.match(UNIT_RE);
  const unit = unitMatch ? normalizeUnit(unitMatch[0]) : null;

  return { phone, opening_hours, address, unit, remainder: nfc(text.replace(/\s+-\s+/g, " ")) };
}

function lastToken(s: string): string {
  const toks = foldKey(s).split(" ").filter((t) => t.length > 2 && !["gral", "general", "av", "avenida", "calle", "dr", "doctor", "cjal", "consejal", "concejal", "pte", "presidente"].includes(t));
  return toks[toks.length - 1] ?? foldKey(s);
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/**
 * True when the note names a genuinely different door than the structured columns.
 * Spelling variants ("H. Yrigoyen" vs "Hipolito Yrigoyen", one-letter typos) and
 * neighbouring postal codes are not conflicts; a different street or number is.
 */
export function noteConflictsWithAddress(
  note: ParsedNote["address"],
  street: string | null,
  number: string | null,
  postal: string | null,
): boolean {
  void postal;
  if (!note || !street) return false;
  const sameNumber = !note.number || !number || foldKey(note.number) === foldKey(number);
  if (!sameNumber) return true;
  if (foldKey(note.street) === foldKey(street)) return false;
  const a = lastToken(note.street);
  const b = lastToken(street);
  if (a === b) return false;
  if (editDistance(a, b) <= 2 && Math.min(a.length, b.length) >= 5) return false;
  return true;
}

/** "Belgrano Belgrano" -> "Belgrano" (exports repeat barrio and localidad); "" -> null. */
function noteLocality(raw: string): string | null {
  const words = nfc(raw).split(" ").filter(Boolean);
  if (!words.length || words.length > 5) return null;
  const half = words.length / 2;
  const deduped = Number.isInteger(half) && foldKey(words.slice(0, half).join(" ")) === foldKey(words.slice(half).join(" ")) ? words.slice(0, half) : words;
  return titleCase(deduped.join(" "));
}
