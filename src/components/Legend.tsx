import { SHARE_BINS } from "@/lib/opportunity";

/** One legend on the opportunity scale. Fixed breaks, so a colour always means the same share. */
export function Legend({ radiusKm }: { radiusKm: number }) {
  return (
    <div
      className="card t-micro pointer-events-auto px-3 py-2 shadow-card"
      data-testid="legend"
    >
      <p className="mb-1 text-gris-700">% del objetivo a {radiusKm} km</p>
      <div className="flex gap-0.5">
        {SHARE_BINS.map((b) => (
          <span
            key={b.label}
            className="block h-2.5 w-7 rounded-field"
            style={{ background: b.color }}
            title={b.label}
          />
        ))}
      </div>
      <div className="mt-0.5 flex justify-between text-gris-700">
        <span>&lt;25%</span>
        <span>100%+</span>
      </div>
    </div>
  );
}
