"use client";

import { useState } from "react";
import { RADII_KM, BAND_LABELS, COUNTED_BANDS } from "@/lib/opportunity";
import {
  FLEX_OPTIONS,
  NO_FILTERS,
  POWER_OPTIONS,
  PROSPECTO_FLEX,
  REPUTATION_OPTIONS,
  activeFilterCount,
  type FilterState,
} from "@/lib/filters";

type Props = {
  target: number;
  onTarget: (n: number) => void;
  radiusKm: number;
  onRadius: (km: number) => void;
  filters: FilterState;
  onFilters: (f: FilterState) => void;
  excluded: { noData: number; filtered: number };
};

/**
 * Floating controls over the map (design doc §1, §3): target, radius, filters
 * popover and removable chips. On mobile they fold behind one "Ajustes" button;
 * there is a single instance in the DOM either way.
 */
export function MapDock({
  target,
  onTarget,
  radiusKm,
  onRadius,
  filters,
  onFilters,
  excluded,
}: Props) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState(String(target));
  const set = (patch: Partial<FilterState>) =>
    onFilters({ ...filters, ...patch });
  const commitTarget = () => {
    const n = Math.round(Number(draft));
    if (Number.isFinite(n) && n >= 100) onTarget(n);
    else setDraft(String(target));
  };
  const chips = filterChips(filters, set);
  const active = activeFilterCount(filters);

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-20 flex max-w-[calc(100%-24px)] flex-col items-start gap-2">
      <button
        type="button"
        className="btn btn-light pointer-events-auto shadow-card md:hidden"
        aria-expanded={settingsOpen}
        onClick={() => setSettingsOpen((o) => !o)}
        data-testid="settings-button"
      >
        Ajustes{active ? ` · ${active}` : ""}
      </button>
      <div
        className={`${settingsOpen ? "flex" : "hidden"} flex-col items-start gap-2 md:flex`}
      >
        <div className="dock t-meta pointer-events-auto flex-wrap">
          <label className="flex items-center gap-2 px-2">
            <span className="text-gris-700">Objetivo</span>
            <input
              className="field tnum w-20 py-1"
              inputMode="numeric"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitTarget}
              onKeyDown={(e) => e.key === "Enter" && commitTarget()}
              aria-label="Objetivo de paquetes por mes"
              data-testid="target-input"
            />
          </label>
          <div className="seg" role="group" aria-label="Radio del hub">
            {RADII_KM.map((km) => (
              <button
                key={km}
                type="button"
                aria-pressed={radiusKm === km}
                onClick={() => onRadius(km)}
                data-testid={`radius-${km}`}
              >
                {km}
                {km === RADII_KM[RADII_KM.length - 1] ? " km" : ""}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-light"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            data-testid="filters-button"
          >
            Filtros{active ? ` · ${active}` : ""}
          </button>
        </div>
        {chips.length ? (
          <div
            className="pointer-events-auto flex flex-wrap items-center gap-1"
            data-testid="filter-chips"
          >
            {chips.map((c) => (
              <button
                key={c.label}
                type="button"
                className="chip"
                onClick={c.clear}
                aria-label={`Quitar filtro ${c.label}`}
              >
                {c.label} ×
              </button>
            ))}
            <button
              type="button"
              className="chip text-tostado"
              onClick={() => onFilters(NO_FILTERS)}
              data-testid="clear-filters"
            >
              Limpiar
            </button>
          </div>
        ) : null}
        {open ? (
          <div
            className="card t-meta pointer-events-auto grid w-[min(360px,calc(100vw-24px))] grid-cols-[120px_1fr] items-center gap-x-3 gap-y-3 p-4 shadow-pop"
            data-testid="filters-popover"
          >
            <span className="text-gris-700">Tamaño</span>
            <div className="seg" role="group" aria-label="Tamaño">
              {COUNTED_BANDS.map((b) => (
                <button
                  key={b}
                  type="button"
                  aria-pressed={filters.sizes.includes(b)}
                  onClick={() =>
                    set({
                      sizes: filters.sizes.includes(b)
                        ? filters.sizes.filter((x) => x !== b)
                        : [...filters.sizes, b],
                    })
                  }
                >
                  {BAND_LABELS[b]}
                </button>
              ))}
            </div>
            <span className="text-gris-700">Candidato Flex</span>
            <select
              className="field py-1"
              value={filters.flex}
              onChange={(e) =>
                set({ flex: e.target.value as FilterState["flex"] })
              }
            >
              {FLEX_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="text-gris-700">Reputación mín.</span>
            <select
              className="field py-1"
              value={filters.repMin}
              onChange={(e) => set({ repMin: Number(e.target.value) })}
            >
              {REPUTATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="text-gris-700">Power seller</span>
            <select
              className="field py-1"
              value={filters.power}
              onChange={(e) =>
                set({ power: e.target.value as FilterState["power"] })
              }
            >
              {POWER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="text-gris-700">Ubicación</span>
            <select
              className="field py-1"
              value={filters.precision}
              onChange={(e) =>
                set({ precision: e.target.value as FilterState["precision"] })
              }
            >
              <option value="all">Todas</option>
              <option value="exact">Solo domicilio exacto</option>
            </select>
            <span className="text-gris-700">Referencias</span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters.refs}
                onChange={(e) => set({ refs: e.target.checked })}
              />
              Centros de envío y partners
            </label>
            <div className="t-micro col-span-2 flex flex-wrap items-center justify-between gap-2 text-gris-700">
              <span>
                {excluded.noData
                  ? `${excluded.noData} sin dato, excluidos`
                  : ""}
              </span>
              <button
                type="button"
                className="text-tostado hover:underline"
                onClick={() => onFilters(PROSPECTO_FLEX)}
              >
                Volver a Prospecto Flex
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function filterChips(
  f: FilterState,
  set: (p: Partial<FilterState>) => void,
): { label: string; clear: () => void }[] {
  const out: { label: string; clear: () => void }[] = [];
  if (f.sizes.length)
    out.push({
      label: f.sizes.map((b) => BAND_LABELS[b]).join(" + "),
      clear: () => set({ sizes: [] }),
    });
  if (f.flex !== "all")
    out.push({
      label: `Flex ${FLEX_OPTIONS.find((o) => o.value === f.flex)!.label.toLowerCase()}`,
      clear: () => set({ flex: "all" }),
    });
  if (f.repMin)
    out.push({
      label: `Rep. ${REPUTATION_OPTIONS.find((o) => o.value === f.repMin)!.label.toLowerCase()}`,
      clear: () => set({ repMin: 0 }),
    });
  if (f.power !== "any")
    out.push({
      label: `Power ${POWER_OPTIONS.find((o) => o.value === f.power)!.label.toLowerCase()}`,
      clear: () => set({ power: "any" }),
    });
  if (f.precision !== "all")
    out.push({
      label: "Solo domicilio exacto",
      clear: () => set({ precision: "all" }),
    });
  return out;
}
