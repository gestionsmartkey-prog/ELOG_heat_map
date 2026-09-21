import type { Bin } from "@/lib/hexes";

export function Legend({ bins, metricShort, res }: { bins: Bin[]; metricShort: string; res: number }) {
  return (
    <div className="card pointer-events-auto p-4 text-[13px] shadow-[0_2px_8px_rgba(42,39,38,0.12)]" data-testid="legend">
      <div className="mb-2 flex items-center justify-between gap-6">
        <span className="t-etiqueta text-carbon">{metricShort} por hexágono</span>
        <span className="text-gris-700 tnum">H3 res {res}</span>
      </div>
      {bins.length === 0 ? (
        <p className="text-gris-700">Sin datos en la vista.</p>
      ) : (
        <ul className="space-y-1">
          {bins.map((b) => (
            <li key={b.label} className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-5 rounded-[4px] border border-carbon/10" style={{ background: b.color }} />
              <span className="tnum text-carbon">{b.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
