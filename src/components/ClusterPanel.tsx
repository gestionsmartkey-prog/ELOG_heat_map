import type { Cluster } from "@/lib/ranking";
import type { MapSeller } from "@/lib/types";
import {
  BAND_LABELS,
  bandOf,
  formatPkgs,
  formatShare,
  isExact,
  shareBin,
  volumeOf,
} from "@/lib/opportunity";

type Props = {
  cluster: Cluster & { rank?: number };
  radiusKm: number;
  target: number;
  claimedBy: Map<string, number>;
  excluded: { noData: number; filtered: number };
  onBack: () => void;
  onSeller: (s: MapSeller) => void;
};

const MIX_COLORS = {
  micro: "var(--color-opp-2)",
  chico: "var(--color-opp-3)",
  core: "var(--color-opp-4)",
} as const;

/** One hub candidate: what it collects and who to win to reach the target (design doc §4). */
export function ClusterPanel({
  cluster: c,
  radiusKm,
  target,
  claimedBy,
  excluded,
  onBack,
  onSeller,
}: Props) {
  const mix = (["micro", "chico", "core"] as const).map((band) => {
    const rows = c.sellers.filter((s) => bandOf(volumeOf(s)) === band);
    return {
      band,
      count: rows.length,
      volume: rows.reduce((sum, s) => sum + (volumeOf(s) ?? 0), 0),
    };
  });
  const missing = Math.max(0, target - c.volume);
  const copyLink = () => {
    void navigator.clipboard?.writeText(window.location.href);
  };

  return (
    <aside
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="panel-cell"
    >
      <div className="space-y-4 border-b border-gris-200 p-4 lg:p-6">
        <button
          type="button"
          onClick={onBack}
          className="text-tostado hover:underline"
        >
          ← Oportunidades
        </button>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="t-h3 text-carbon">
              {c.rank ? `${c.rank} · ` : ""}
              {c.name}
            </h2>
            <p className="t-micro text-gris-700">radio {radiusKm} km</p>
          </div>
          <button
            type="button"
            className="btn btn-light t-meta"
            onClick={copyLink}
          >
            Copiar link
          </button>
        </div>
        <div>
          <div className="flex items-baseline gap-2">
            <span className="t-display-lg text-carbon">
              {formatPkgs(c.volume)}
            </span>
            <span className="text-gris-700">paq/mes alcanzables (est.)</span>
            <span className="t-dato ml-auto tnum">{formatShare(c.share)}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-gris-200">
            <div
              className="h-full"
              style={{
                width: `${Math.min(100, c.share * 100)}%`,
                background: shareBin(c.share).color,
              }}
            />
          </div>
          <p className="t-micro mt-1 text-gris-700">
            {missing
              ? `Faltan ${formatPkgs(missing)} paq/mes para el objetivo de ${formatPkgs(target)}`
              : `Cubre el objetivo de ${formatPkgs(target)}`}
          </p>
        </div>
        {c.needed.picks.length ? (
          <div className="rounded-button bg-papel p-3" data-testid="needed">
            <p className="font-medium text-carbon">
              {c.needed.enough
                ? `Ganando estos ${c.needed.picks.length} llegás a ${formatPkgs(c.needed.reached)}`
                : `Todos juntos suman ${formatPkgs(c.needed.reached)}`}
            </p>
            <ul className="t-meta mt-2 space-y-1">
              {c.needed.picks.slice(0, 8).map((s) => (
                <li key={s.id} className="grid grid-cols-[1fr_auto_auto] gap-3">
                  <span className="truncate">
                    {s.name}
                    {isExact(s) ? "" : " ≈"}
                  </span>
                  <span className="text-gris-700">
                    {BAND_LABELS[bandOf(volumeOf(s))!]}
                  </span>
                  <span className="tnum">{formatPkgs(volumeOf(s)!)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div>
          <p className="t-micro mb-1 text-gris-700">
            Mix por tamaño (sellers · paq/mes)
          </p>
          <div className="flex h-2.5 gap-px overflow-hidden rounded-field">
            {mix.map((m) =>
              m.volume ? (
                <div
                  key={m.band}
                  style={{ flex: m.volume, background: MIX_COLORS[m.band] }}
                />
              ) : null,
            )}
          </div>
          <div className="t-micro mt-1 flex justify-between text-gris-700 tnum">
            {mix.map((m) => (
              <span key={m.band}>
                {BAND_LABELS[m.band].toLowerCase()} {m.count} ·{" "}
                {formatPkgs(m.volume)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p className="t-micro px-4 pt-4 text-gris-700 lg:px-6">
        Sellers ({c.sellers.length}) · por volumen
      </p>
      <ul className="divide-y divide-gris-200" data-testid="door-list">
        {c.sellers.map((s) => {
          const v = volumeOf(s);
          const other = claimedBy.get(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSeller(s)}
                className="grid w-full grid-cols-[1fr_auto] gap-3 px-4 py-3 text-left hover:bg-papel lg:px-6"
              >
                <span className="min-w-0">
                  <span className="block truncate text-carbon">
                    {s.name}
                    {isExact(s) ? "" : " ≈"}
                  </span>
                  <span className="t-micro block text-gris-700">
                    {[
                      v == null ? "sin volumen" : BAND_LABELS[bandOf(v)!],
                      flexLabel(s),
                      repLabel(s),
                      other && other !== c.rank ? `en hub #${other}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="tnum text-carbon">
                  {v == null ? "—" : formatPkgs(v)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p
        className="t-micro border-t border-gris-200 p-4 text-gris-700 lg:px-6"
        data-testid="cluster-footnote"
      >
        {[
          `${Math.round(c.approxShare * 100)}% ubicación aproximada`,
          c.noVolume && `${c.noVolume} sin volumen`,
          c.enterprise && `${c.enterprise} enterprise excluidos`,
          excluded.noData + excluded.filtered &&
            `${excluded.noData + excluded.filtered} excluidos por filtros en todo el mapa`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </aside>
  );
}

const flexLabel = (s: MapSeller) =>
  s.attrs?.flex_candidate === "si"
    ? "Flex sí"
    : s.attrs?.flex_candidate === "probable"
      ? "Flex probable"
      : null;
const REP: Record<string, string> = {
  "5": "verde",
  "4": "verde claro",
  "3": "amarillo",
  "2": "naranja",
  "1": "rojo",
};
const repLabel = (s: MapSeller) =>
  s.attrs?.reputation ? (REP[s.attrs.reputation.split("_")[0]] ?? null) : null;
