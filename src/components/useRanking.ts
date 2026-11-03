"use client";

import { useEffect, useRef, useState } from "react";
import { setBands, type BandRule } from "@/lib/opportunity";
import { rankHubs, type Ranking } from "@/lib/ranking";
import type { MapSeller } from "@/lib/types";

/** Runs the hub ranking off the main thread; the newest request wins. */
export function useRanking(
  sellers: MapSeller[] | null,
  target: number,
  radiusKm: number,
  bands: BandRule[] | undefined,
): Ranking | null {
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    try {
      const w = new Worker(
        new URL("../lib/ranking.worker.ts", import.meta.url),
        { type: "module" },
      );
      w.onmessage = (
        e: MessageEvent<{
          id: number;
          picks: Ranking["picks"];
          scores: [string, number][];
          claimedBy: [string, number][];
        }>,
      ) => {
        if (e.data.id !== reqId.current) return;
        setRanking({
          picks: e.data.picks,
          scores: new Map(e.data.scores),
          claimedBy: new Map(e.data.claimedBy),
        });
      };
      workerRef.current = w;
      return () => {
        w.terminate();
        workerRef.current = null;
      };
    } catch {
      workerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!sellers) return;
    const id = ++reqId.current;
    const w = workerRef.current;
    if (w) {
      w.postMessage({ id, sellers, target, radiusKm, bands });
      return;
    }
    const t = setTimeout(() => {
      if (id !== reqId.current) return;
      setBands(bands);
      setRanking(rankHubs(sellers, { target, radiusKm }));
    }, 0);
    return () => clearTimeout(t);
  }, [sellers, target, radiusKm, bands]);

  return ranking;
}
