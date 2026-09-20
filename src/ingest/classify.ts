import type { SellerKind } from "./types";
import { foldKey } from "./normalize";

/**
 * Kind is inferred from the id shape and the name. Rules here mirror what we
 * saw in the first export:
 *  - 542124431_10085  -> a Mercado Libre drop-off agency under parent 542124431
 *  - ARP10011077251   -> a self-service / logistics partner id
 *  - 54307454         -> a plain seller id
 */
export function classifySeller(externalId: string | null, name: string | null): { kind: SellerKind; parent: string | null } {
  const id = (externalId ?? "").trim();
  const n = foldKey(name ?? "");
  const agencyById = id.match(/^(\d+)_(\d+)$/);
  if (agencyById) return { kind: "dropoff_agency", parent: agencyById[1] };
  if (/^centro de envio\b/.test(n) || /^punto de despacho\b/.test(n)) return { kind: "dropoff_agency", parent: null };
  if (/^ARP\d+$/i.test(id) || /self service partner/.test(n)) return { kind: "partner", parent: null };
  if (/^\d+$/.test(id)) return { kind: "seller", parent: null };
  if (!id) return { kind: "unknown", parent: null };
  return { kind: "seller", parent: null };
}
