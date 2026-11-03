"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SellersResponse } from "@/lib/types";
import { formatPkgs } from "@/lib/opportunity";

type Props = {
  data: SellersResponse | null;
  kpis: { sellers: number; packages: number; hubs: number } | null;
};

/** One slim row: logo, page name, headline numbers for the current filters, one menu (design doc §1). */
export function TopBar({ data, kpis }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent
          ? e.key === "Escape"
          : !ref.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const latest = data?.batches?.[0];
  const reviews = data?.stats.open_reviews ?? 0;

  return (
    <header className="flex items-center gap-4 bg-grafito px-[var(--gutter)] py-2 text-white shadow-ctrl lg:px-[var(--gutter-lg)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/elog-logo-white.svg"
        alt="ELOG"
        width={100}
        height={30}
        className="h-[var(--size-logo)] w-auto"
      />
      <span className="t-etiqueta hidden text-white/70 sm:block">
        Oportunidades
      </span>
      <div
        className="mx-auto hidden items-baseline gap-6 md:flex"
        data-testid="stats"
      >
        {kpis ? (
          <>
            <span>
              <b className="t-dato">{formatPkgs(kpis.sellers)}</b>{" "}
              <span className="t-meta text-white/70">sellers</span>
            </span>
            <span>
              <b className="t-dato">{formatPkgs(kpis.packages)}</b>{" "}
              <span className="t-meta text-white/70">paq/mes</span>
            </span>
            <span>
              <b className="t-dato">{kpis.hubs}</b>{" "}
              <span className="t-meta text-white/70">oportunidades</span>
            </span>
          </>
        ) : (
          <span className="text-white/60">Cargando…</span>
        )}
      </div>
      <div className="relative ml-auto md:ml-0" ref={ref}>
        <button
          type="button"
          className="btn btn-ghost"
          aria-expanded={open}
          aria-haspopup="menu"
          onClick={() => setOpen((o) => !o)}
          data-testid="menu-button"
        >
          Menú
          {reviews ? (
            <span className="t-micro ml-2 rounded-pill bg-naranja px-1.5 text-carbon">
              {reviews}
            </span>
          ) : null}
        </button>
        {open ? (
          <nav
            role="menu"
            className="card absolute right-0 top-full z-40 mt-2 flex w-64 flex-col p-2 text-carbon shadow-pop"
          >
            {data?.viewer ? (
              <p className="t-micro px-2 py-1 text-gris-700">{data.viewer}</p>
            ) : null}
            {latest ? (
              <p className="t-micro px-2 pb-2 text-gris-700">
                Último archivo: {latest.filename},{" "}
                {new Date(latest.created_at).toLocaleDateString("es-AR")}
              </p>
            ) : null}
            <Link
              role="menuitem"
              href="/revisar"
              className="rounded-button px-2 py-2 hover:bg-papel"
              data-testid="review-link"
            >
              Revisar{reviews ? ` (${reviews})` : ""}
            </Link>
            <Link
              role="menuitem"
              href="/importar"
              className="rounded-button px-2 py-2 hover:bg-papel"
              data-testid="import-link"
            >
              Importar
            </Link>
            {data?.viewer_role === "admin" ? (
              <Link
                role="menuitem"
                href="/usuarios"
                className="rounded-button px-2 py-2 hover:bg-papel"
                data-testid="users-link"
              >
                Usuarios
              </Link>
            ) : null}
            <form method="post" action="/api/logout">
              <button
                role="menuitem"
                className="w-full rounded-button px-2 py-2 text-left hover:bg-papel"
              >
                Salir
              </button>
            </form>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
