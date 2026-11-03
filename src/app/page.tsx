import { HeatMapApp } from "@/components/HeatMapApp";

/** The query is read on the server so the first render already matches a shared link. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp))
    if (typeof v === "string") q.set(k, v);
  return <HeatMapApp initialQuery={q.toString()} />;
}
