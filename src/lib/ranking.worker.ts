import { rankHubs } from "./ranking";
import type { MapSeller } from "./types";

export type RankRequest = {
  id: number;
  sellers: MapSeller[];
  target: number;
  radiusKm: number;
};

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<RankRequest>) => void) | null;
  postMessage: (m: unknown) => void;
};
ctx.onmessage = (e) => {
  const { id, sellers, target, radiusKm } = e.data;
  const r = rankHubs(sellers, { target, radiusKm });
  ctx.postMessage({
    id,
    picks: r.picks,
    scores: [...r.scores],
    claimedBy: [...r.claimedBy],
  });
};
