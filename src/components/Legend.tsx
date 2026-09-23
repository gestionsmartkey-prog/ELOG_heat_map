import type { Bin } from "@/lib/hexes";

/**
 * Compact legend: one line per colour, the unit inline ("1 seller", "4–9 sellers"),
 * no title, so it takes as little of the map as possible. The H3 resolution stays
 * available as a tooltip and data attribute.
 */
export function Legend({ bins, one, many, res }: { bins: Bin[]; one: string; many: string; res: number }) {
  return (
    <div className="card t-meta pointer-events-auto py-2 pl-2 pr-4 shadow-card" data-testid="legend" data-res={res} title={`Cantidad por hexágono (H3 res ${res})`}>
      {bins.length === 0 ? (
        <p className="text-gris-700">Sin datos en la vista.</p>
      ) : (
        <ul className="space-y-1">
          {bins.map((b) => (
            <li key={b.label} className="flex items-center gap-2">
              <span className="inline-block h-3 w-4 shrink-0 rounded-field border border-carbon/10" style={{ background: b.color }} />
              <span className="tnum whitespace-nowrap text-carbon">{b.label} {b.max === 1 ? one : many}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
