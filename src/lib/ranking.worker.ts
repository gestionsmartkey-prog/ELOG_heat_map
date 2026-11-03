import { setBands, type BandRule } from "./opportunity";
import { rankHubs } from "./ranking";
import type { MapSeller } from "./types";

export type RankRequest = {
  id: number;
  sellers: MapSeller[];
  target: number;
  radiusKm: number;
  bands?: BandRule[];
};

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<RankRequest>) => void) | null;
  postMessage: (m: unknown) => void;
};
ctx.onmessage = (e) => {
  const { id, sellers, target, radiusKm, bands } = e.data;
  // The worker has its own copy of the module: give it the same bands as the main thread.
  setBands(bands);
  const r = rankHubs(sellers, { target, radiusKm });
  ctx.postMessage({
    id,
    picks: r.picks,
    scores: [...r.scores],
    claimedBy: [...r.claimedBy],
  });
};
