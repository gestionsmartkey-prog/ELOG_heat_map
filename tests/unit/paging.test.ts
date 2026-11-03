import { describe, expect, it } from "vitest";
import { fetchAllPages } from "../../src/lib/paging";

/** A fake PostgREST range query over `n` rows that never returns more than `cap` at once. */
const table = (n: number, cap = 1000) => {
  const rows = Array.from({ length: n }, (_, i) => i);
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    return {
      data: rows.slice(from, Math.min(to + 1, from + cap)),
      error: null,
    };
  };
  return { page, calls };
};

describe("fetchAllPages", () => {
  it("reads past the 1,000-row cap until a short page", async () => {
    const t = table(2500);
    const all = await fetchAllPages(t.page, 1000);
    expect(all).toHaveLength(2500);
    expect(all[2499]).toBe(2499);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });
  it("asks once more after an exactly full last page", async () => {
    const t = table(2000);
    expect(await fetchAllPages(t.page, 1000)).toHaveLength(2000);
    expect(t.calls).toHaveLength(3);
  });
  it("throws the query error", async () => {
    await expect(
      fetchAllPages(async () => ({ data: null, error: { message: "boom" } })),
    ).rejects.toThrow("boom");
  });
});
