export const metadata = { title: "Ingresar · Mapa de sellers · ELOG Group" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="relative min-h-screen bg-carbon overflow-hidden">
      {/* Motivo Ruta: entra por la izquierda, sale por abajo a la derecha. Nunca cruza el logo. */}
      <div className="ruta" aria-hidden="true">
        <svg viewBox="0 0 1440 900" preserveAspectRatio="none" fill="none">
          <path d="M-20 640 H420 A96 96 0 0 0 516 544 V360 A96 96 0 0 1 612 264 H1460" stroke="#FF9038" strokeWidth="5" strokeLinecap="round" />
          <path d="M-20 700 H380 A96 96 0 0 0 476 604 V420 A96 96 0 0 1 572 324 H1460" stroke="#FFFFFF" strokeOpacity="0.15" strokeWidth="4" strokeLinecap="round" />
        </svg>
      </div>
      <div className="relative flex min-h-screen items-center justify-center px-4">
        <form method="post" action="/api/login" className="w-full max-w-sm rounded-card bg-white p-8 shadow-modal sm:p-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/elog-logo-grafito.svg" alt="ELOG" width={140} height={42} className="h-[var(--size-logo-lg)] w-auto" />
          <h1 className="t-h3 mt-6 text-carbon">Mapa de sellers</h1>
          <p className="mt-1 text-gris-700">Herramienta interna. Ingresá con tu usuario del equipo.</p>
          <label className="t-etiqueta mt-6 block text-gris-700" htmlFor="username">Usuario</label>
          <input id="username" name="username" type="text" autoComplete="username" autoFocus required className="field mt-2 w-full" />
          <label className="t-etiqueta mt-4 block text-gris-700" htmlFor="password">Contraseña</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required className="field mt-2 w-full" />
          {error ? <p className="mt-3 text-rojo" role="alert">Usuario o contraseña incorrectos.</p> : null}
          <button type="submit" className="btn btn-primary mt-6 w-full py-2.5">Ingresar</button>
        </form>
      </div>
    </main>
  );
}
