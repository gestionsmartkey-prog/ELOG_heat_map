import { useMemo, useState } from "react";
import type { Pick } from "@/lib/ranking";
import { formatPkgs, formatShare, shareBin } from "@/lib/opportunity";

type Props = {
  picks: Pick[] | null;
  radiusKm: number;
  hovered: number | null;
  onHover: (rank: number | null) => void;
  onOpen: (p: Pick) => void;
};

/** Default panel: ranked hub candidates (design doc §4). */
export function OpportunityList({
  picks,
  radiusKm,
  hovered,
  onHover,
  onOpen,
}: Props) {
  const [sort, setSort] = useState<"volume" | "fewest">("volume");
  const rows = useMemo(() => {
    const list = [...(picks ?? [])];
    if (sort === "fewest")
      list.sort(
        (a, b) =>
          Number(b.needed.enough) - Number(a.needed.enough) ||
          a.needed.picks.length - b.needed.picks.length,
      );
    return list;
  }, [picks, sort]);

  return (
    <aside
      className="flex min-h-0 flex-1 flex-col"
      data-testid="opportunity-list"
    >
      <div className="flex items-center justify-between gap-2 border-b border-gris-200 px-4 py-3 lg:px-6">
        <h2 className="t-etiqueta text-gris-700">
          Top oportunidades · {radiusKm} km
        </h2>
        <div className="seg t-micro" role="group" aria-label="Ordenar">
          <button
            type="button"
            aria-pressed={sort === "volume"}
            onClick={() => setSort("volume")}
          >
            Más volumen
          </button>
          <button
            type="button"
            aria-pressed={sort === "fewest"}
            onClick={() => setSort("fewest")}
          >
            Menos sellers
          </button>
        </div>
      </div>
      {picks == null ? (
        <p className="p-4 text-gris-700 lg:p-6">Calculando oportunidades…</p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-gris-700 lg:p-6">
          Ninguna zona llega al 25% del objetivo con estos filtros. Probá un
          radio mayor o limpiá los filtros.
        </p>
      ) : (
        <ol className="flex-1 divide-y divide-gris-200 overflow-y-auto">
          {rows.map((p) => (
            <li key={p.cell}>
              <button
                type="button"
                className={`grid w-full grid-cols-[28px_1fr_auto] items-center gap-3 px-4 py-3 text-left lg:px-6 ${hovered === p.rank ? "bg-papel" : "hover:bg-papel"}`}
                onMouseEnter={() => onHover(p.rank)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(p.rank)}
                onBlur={() => onHover(null)}
                onClick={() => onOpen(p)}
                data-testid="opportunity-row"
              >
                <span className="pin" aria-hidden="true">
                  {p.rank}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-carbon">
                    {p.name}
                  </span>
                  <span className="t-micro block text-gris-700 tnum">
                    {formatPkgs(p.volume)} paq/mes ·{" "}
                    {p.needed.enough
                      ? `necesitás ${p.needed.picks.length} (${neededMix(p)})`
                      : "no llega al objetivo"}
                  </span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-pill bg-gris-200">
                    <span
                      className="block h-full"
                      style={{
                        width: `${Math.min(100, p.share * 100)}%`,
                        background: shareBin(p.share).color,
                      }}
                    />
                  </span>
                </span>
                <span className="t-dato tnum text-carbon">
                  {formatShare(p.share)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

export function neededMix(p: Pick): string {
  const { core, chico, micro } = p.needed.byBand;
  return [
    core && `${core} core`,
    chico && `${chico} ${chico === 1 ? "chico" : "chicos"}`,
    micro && `${micro} micro`,
  ]
    .filter(Boolean)
    .join(" + ");
}
