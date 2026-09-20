import type { Bin } from "@/lib/hexes";

export function Legend({ bins, metricShort, res }: { bins: Bin[]; metricShort: string; res: number }) {
  return (
    <div className="pointer-events-auto rounded-lg bg-white/95 p-3 text-xs shadow-md border border-slate-200 backdrop-blur" data-testid="legend">
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className="font-semibold text-slate-800">{metricShort} per hex</span>
        <span className="text-slate-400">H3 res {res}</span>
      </div>
      {bins.length === 0 ? (
        <p className="text-slate-500">No data in view.</p>
      ) : (
        <ul className="space-y-1">
          {bins.map((b) => (
            <li key={b.label} className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-5 rounded-sm border border-black/10" style={{ background: b.color }} />
              <span className="tabular-nums text-slate-700">{b.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
