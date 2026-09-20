import { nfc, normalizePostalCode, normalizeStreet, normalizeStreetNumber, foldKey } from "./normalize";

export type ParsedNote = {
  phone: string | null;
  opening_hours: string | null;
  address: { street: string; number: string | null; postal_code: string | null; display: string } | null;
  remainder: string;
};

const PHONE_RE = /(?:\+?54\s?)?(?:9\s?)?(?:\(?0?11\)?[\s-]?)?\d{4}[\s-]?\d{4}\b|\b\d{10,11}\b/;
const DAY = "(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados?|domingos?)";
const HOURS_RE = new RegExp(
  `${DAY}(?:\\s+a\\s+${DAY})?(?:\\s+de)?\\s+\\d{1,2}(?::\\d{2})?(?:\\s*hs?\\.?)?\\s*(?:a|-|hasta)\\s*\\d{1,2}(?::\\d{2})?\\s*hs?\\.?`,
  "gi",
);
// "Soldado De La Independencia 966 (1426) Belgrano ..." or "Av. Warnes 1255 (1414) Villa Crespo CABA"
const ADDRESS_RE = /^\s*([A-Za-zÁ-ÿ'.\-\s]{3,}?)\s+(\d{1,5}|s\/n)\s*\((\d{4})\)/i;

/**
 * The free-text column mixes phone numbers, opening hours, a second address and
 * delivery notes. We pull out what we can and keep the rest verbatim.
 */
export function parseNote(raw: string | null | undefined): ParsedNote {
  if (!raw) return { phone: null, opening_hours: null, address: null, remainder: "" };
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
      address = {
        street,
        number,
        postal_code: normalizePostalCode(addr[3]),
        display: number && number !== "S/N" ? `${street} ${number}` : `${street} S/N`,
      };
    }
  }

  return { phone, opening_hours, address, remainder: nfc(text.replace(/\s+-\s+/g, " ")) };
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
