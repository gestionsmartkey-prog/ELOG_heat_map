export const metadata = { title: "Sign in · Seller heat map" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <form method="post" action="/api/login" className="w-full max-w-sm rounded-xl bg-white p-8 shadow-md border border-slate-200">
        <h1 className="text-xl font-semibold text-slate-900">Seller heat map</h1>
        <p className="mt-1 text-sm text-slate-500">Internal tool. Enter the team password to continue.</p>
        <label className="mt-6 block text-sm font-medium text-slate-700" htmlFor="username">User</label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoFocus
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
        <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
        />
        {error ? <p className="mt-2 text-sm text-red-600" role="alert">Wrong user or password. Try again.</p> : null}
        <button type="submit" className="mt-6 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          Sign in
        </button>
      </form>
    </main>
  );
}
