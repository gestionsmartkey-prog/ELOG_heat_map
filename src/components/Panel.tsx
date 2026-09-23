import { useMemo, useState } from "react";
import type { MapSeller } from "@/lib/types";
import { neighbourCount, type CellAgg } from "@/lib/hexes";

type Props = {
  cell: CellAgg | null;
  catchmentValue: number | null;
  catchmentK: number;
  metricShort: string;
  onClear: () => void;
};

/** Panel derecho: vacío, resumen del hexágono agrupado por domicilio, o detalle de un seller. */
export function Panel({ cell, catchmentValue, catchmentK, metricShort, onClear }: Props) {
  const [selected, setSelected] = useState<MapSeller | null>(null);

  const groups = useMemo(() => {
    if (!cell) return [];
    const byLoc = new Map<string, { address: string; locality: string | null; sellers: MapSeller[] }>();
    for (const s of cell.sellers) {
      const key = s.location_id ?? s.id;
      const g = byLoc.get(key) ?? { address: s.address_display ?? "Sin domicilio", locality: s.locality, sellers: [] };
      g.sellers.push(s);
      byLoc.set(key, g);
    }
    return [...byLoc.values()].sort((a, b) => b.sellers.length - a.sellers.length);
  }, [cell]);

  const localities = useMemo(() => {
    if (!cell) return "";
    const counts = new Map<string, number>();
    for (const s of cell.sellers) if (s.locality) counts.set(s.locality, (counts.get(s.locality) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => n).join(", ");
  }, [cell]);

  if (!cell) {
    return (
      <aside className="flex flex-1 flex-col p-4 lg:p-6" data-testid="panel-empty">
        <p className="t-h3 text-carbon">Seleccioná un área para ver sus sellers.</p>
        <p className="mt-2 text-gris-700">Pasá el mouse por un hexágono para ver la cantidad. Acercá el mapa para hexágonos más finos y domicilios individuales.</p>
      </aside>
    );
  }

  if (selected && cell.sellers.includes(selected)) {
    const s = selected;
    return (
      <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 lg:p-6" data-testid="panel-seller">
        <button onClick={() => setSelected(null)} className="mb-4 self-start text-tostado hover:underline">← Volver a la lista</button>
        <h2 className="t-h3 text-carbon">{s.name}</h2>
        <p className="mt-1 text-gris-700">{s.kind_label} · id {s.external_id}</p>
        <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          <dt className="text-gris-700">Domicilio</dt><dd>{s.address_display ?? "—"}</dd>
          <dt className="text-gris-700">Localidad</dt><dd>{[s.locality, s.partido].filter(Boolean).join(" · ") || "—"}</dd>
          <dt className="text-gris-700">Provincia</dt><dd>{s.province ?? "—"}{s.postal_code ? ` · CP ${s.postal_code}` : ""}</dd>
          {s.opening_hours ? <><dt className="text-gris-700">Horario</dt><dd>{s.opening_hours}</dd></> : null}
          {s.note_address ? <><dt className="text-ambar">Nota</dt><dd className="text-ambar">Indica {s.note_address}, distinto del domicilio registrado.</dd></> : null}
          <dt className="text-gris-700">Geocodificación</dt><dd>{geocodeLabel(s.geocode_status)}</dd>
          <dt className="text-gris-700">Volumen</dt><dd className="text-gris-400">fase 2</dd>
        </dl>
      </aside>
    );
  }

  return (
    <aside className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="panel-cell">
      <div className="border-b border-gris-200 p-4 lg:p-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="t-h3 text-carbon">{localities || "Área seleccionada"}</h2>
            <p className="mt-0.5 text-gris-700 tnum">hexágono {cell.cell}</p>
          </div>
          <button onClick={onClear} className="text-tostado hover:underline">Limpiar</button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label={metricShort} value={cell.value} />
          <Stat label="domicilios" value={groups.length} />
          <Stat label="en la zona" value={catchmentK ? catchmentValue ?? 0 : null} />
        </div>
        <p className="t-micro mt-2 text-gris-700" data-testid="zone-note">
          {catchmentK ? `Zona = este hexágono + los ${neighbourCount(catchmentK)} que lo rodean.` : "Elegí una zona en los filtros para sumar los hexágonos vecinos."}
        </p>
      </div>
      <ul className="flex-1 divide-y divide-gris-200 overflow-y-auto" data-testid="door-list">
        {groups.map((g) => (
          <li key={g.address + g.locality} className="px-4 py-4 lg:px-6">
            <p className="font-medium text-carbon">{g.address} <span className="font-normal text-gris-700">{g.locality ?? ""}</span></p>
            <p className="text-gris-700">{g.sellers.length === 1 ? "1 seller" : `${g.sellers.length} sellers, 1 domicilio`}</p>
            <ul className="mt-2 space-y-1">
              {g.sellers.map((s) => (
                <li key={s.id}>
                  <button onClick={() => setSelected(s)} className="w-full rounded-button px-2 py-1 text-left hover:bg-papel">
                    <span className="mr-2 inline-block h-2 w-2 rounded-pill" style={{ background: kindColor(s.kind) }} />
                    {s.name}
                    <span className="ml-2 text-gris-700">{s.kind_label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-button bg-papel px-2 py-2">
      <div className="t-display-lg text-carbon">{value ?? "—"}</div>
      <div className="t-etiqueta mt-1 text-gris-700">{label}</div>
    </div>
  );
}

function geocodeLabel(s: string | null): string {
  switch (s) {
    case "ok": return "ubicado";
    case "review": return "a revisar";
    case "failed": return "sin ubicar";
    case "pending": return "pendiente";
    default: return "—";
  }
}

/** Colores por tipo: naranja de marca para sellers; semánticos del manual para el resto. */
export function kindColor(kind: string): string {
  return kind === "dropoff_agency" ? "#2B6E8F" : kind === "partner" ? "#2E7D5B" : kind === "unknown" ? "#A3A09E" : "#FF9038";
}
