import { describe, expect, it } from "vitest";
import { cellToParent, gridDisk, latLngToCell } from "h3-js";

/**
 * Exactly the arithmetic of public.h3_parent() in
 * supabase/migrations/20261103120300_location_hex_columns.sql: set the resolution
 * nibble (bits 52–55) and fill every digit finer than `res` with 7.
 */
function sqlH3Parent(cell: string, res: number): string {
  // BigInt() calls, not literals: tsconfig targets ES2017.
  const n = BigInt;
  let v = n(`0x${cell}`);
  v =
    (v & ~(n(15) << n(52))) |
    (n(res) << n(52)) |
    ((n(1) << n(45 - 3 * res)) - n(1));
  return v.toString(16);
}

describe("h3_parent (SQL formula)", () => {
  // Cells across CABA and GBA, plus their neighbours.
  const seeds = [
    [-34.6037, -58.3816],
    [-34.65, -58.62],
    [-34.77, -58.4],
    [-34.45, -58.91],
    [-34.92, -57.95],
  ].map(([lat, lng]) => latLngToCell(lat, lng, 9));
  const cells = seeds.flatMap((c) => gridDisk(c, 4));

  it("matches h3-js for res 8 and 7 from res-9 cells", () => {
    for (const c of cells) {
      expect(sqlH3Parent(c, 8)).toBe(cellToParent(c, 8));
      expect(sqlH3Parent(c, 7)).toBe(cellToParent(c, 7));
    }
  });

  it("matches cells read from production", () => {
    expect(sqlH3Parent("89a94106a6fffff", 8)).toBe("88a94106a7fffff");
    expect(sqlH3Parent("89a94106a6fffff", 7)).toBe("87a94106affffff");
  });
});
