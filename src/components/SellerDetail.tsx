import type { MapSeller } from "@/lib/types";
import {
  BAND_LABELS,
  bandOf,
  formatPkgs,
  isExact,
  volumeOf,
} from "@/lib/opportunity";

/** One seller from a cluster: volume, where it is, and its ML attributes. */
export function SellerDetail({
  seller: s,
  onBack,
}: {
  seller: MapSeller;
  onBack: () => void;
}) {
  const v = volumeOf(s);
  const profile = s.attrs?.profile_url;
  return (
    <aside
      className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 lg:p-6"
      data-testid="panel-seller"
    >
      <button
        type="button"
        onClick={onBack}
        className="mb-4 self-start text-tostado hover:underline"
      >
        ← Volver al cluster
      </button>
      <h2 className="t-h3 text-carbon">{s.name}</h2>
      <p className="mt-1 text-gris-700">id {s.external_id}</p>
      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <dt className="text-gris-700">Volumen</dt>
        <dd className="tnum">
          {v == null
            ? "sin dato"
            : `${formatPkgs(v)} paq/mes (est.) · ${BAND_LABELS[bandOf(v)!]}`}
        </dd>
        <dt className="text-gris-700">Domicilio</dt>
        <dd>
          {isExact(s)
            ? (s.address_display ?? "—")
            : `Aproximado: centro de ${s.locality ?? s.partido ?? "la zona"}`}
          {s.address_edited ? (
            <span className="t-micro ml-2 text-gris-700">
              (corregido a mano)
            </span>
          ) : null}
        </dd>
        {s.unit ? (
          <>
            <dt className="text-gris-700">Unidad</dt>
            <dd>{s.unit}</dd>
          </>
        ) : null}
        <dt className="text-gris-700">Localidad</dt>
        <dd>{[s.locality, s.partido].filter(Boolean).join(" · ") || "—"}</dd>
        <dt className="text-gris-700">Provincia</dt>
        <dd>
          {s.province ?? "—"}
          {s.postal_code ? ` · CP ${s.postal_code}` : ""}
        </dd>
        {s.attrs?.flex_candidate ? (
          <>
            <dt className="text-gris-700">Candidato Flex</dt>
            <dd>{s.attrs.flex_candidate}</dd>
          </>
        ) : null}
        {s.attrs?.reputation ? (
          <>
            <dt className="text-gris-700">Reputación</dt>
            <dd>{s.attrs.reputation.replace(/^\d_/, "").replace("_", " ")}</dd>
          </>
        ) : null}
        {s.attrs?.power_seller ? (
          <>
            <dt className="text-gris-700">Power seller</dt>
            <dd>{s.attrs.power_seller}</dd>
          </>
        ) : null}
        {s.opening_hours ? (
          <>
            <dt className="text-gris-700">Horario</dt>
            <dd>{s.opening_hours}</dd>
          </>
        ) : null}
        {s.note_address ? (
          <>
            <dt className="text-ambar">Nota</dt>
            <dd className="text-ambar">
              Indica {s.note_address}, distinto del domicilio registrado.
            </dd>
          </>
        ) : null}
      </dl>
      {profile ? (
        <a
          href={profile}
          target="_blank"
          rel="noreferrer"
          className="btn btn-light mt-6 self-start"
        >
          Ver perfil en Mercado Libre
        </a>
      ) : null}
    </aside>
  );
}
