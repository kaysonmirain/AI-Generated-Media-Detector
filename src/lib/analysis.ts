import { z } from "zod";

export const analysisSchema = z.object({
  title: z.string(),
  description: z.string(),
  promptSuggestion: z.string(),
  syntheticScore: z.number().min(0).max(100),
  syntheticLabel: z.enum(["likely_human", "uncertain", "likely_synthetic"]),
  /** Agreement among heuristic signals; not calibrated confidence or a probability. */
  verdictConfidence: z.number().min(0).max(100),
  /** 2–4 short sentences anyone can understand; no jargon. */
  plainEnglishSummary: z.string(),
  /** Observable points that support a real-camera / authentic origin (3–7 items). */
  evidenceForAuthentic: z.array(z.string()).min(2).max(10),
  /** Observable points that support AI / heavy manipulation (3–7 items). */
  evidenceForSynthetic: z.array(z.string()).min(2).max(10),
  /** Thorough step-by-step analysis: 6–12 sentences; weave cues, tradeoffs, frame disagreements. */
  reasoning: z.string(),
  /** Specific pixel-level observations; 5–12 items; concrete not vague. */
  visualCues: z.array(z.string()).min(3).max(14),
});

export type MediaAnalysis = z.infer<typeof analysisSchema>;

export type SessionStats = {
  total: number;
  likelyHuman: number;
  uncertain: number;
  likelySynthetic: number;
};

/** Stable empty stats for `useSyncExternalStore` server snapshots and cache hits. */
export const ZERO_STATS: SessionStats = Object.freeze({
  total: 0,
  likelyHuman: 0,
  uncertain: 0,
  likelySynthetic: 0,
});

export const emptyStats = (): SessionStats => ({
  total: 0,
  likelyHuman: 0,
  uncertain: 0,
  likelySynthetic: 0,
});

export function mergeStats(
  stats: SessionStats,
  label: MediaAnalysis["syntheticLabel"]
): SessionStats {
  const next = { ...stats, total: stats.total + 1 };
  if (label === "likely_human") next.likelyHuman += 1;
  else if (label === "uncertain") next.uncertain += 1;
  else next.likelySynthetic += 1;
  return next;
}

/**
 * Whole-number % for each outcome so human + uncertain + synthetic = 100
 * (largest-remainder method). Use for session dashboard labels.
 */
export function sessionOutcomePercents(stats: SessionStats): {
  human: number;
  uncertain: number;
  synthetic: number;
} {
  const t = stats.total;
  if (t === 0) {
    return { human: 0, uncertain: 0, synthetic: 0 };
  }

  const buckets = [
    { key: "human" as const, n: stats.likelyHuman },
    { key: "uncertain" as const, n: stats.uncertain },
    { key: "synthetic" as const, n: stats.likelySynthetic },
  ];

  const exact = buckets.map((b) => ({
    ...b,
    pct: (100 * b.n) / t,
  }));

  const withFloor = exact.map((b) => ({
    key: b.key,
    floor: Math.floor(b.pct),
    frac: b.pct - Math.floor(b.pct),
  }));

  const flooredSum = withFloor.reduce((s, x) => s + x.floor, 0);
  const need = 100 - flooredSum;

  const sorted = [...withFloor].sort((a, b) => b.frac - a.frac);
  const out = { human: 0, uncertain: 0, synthetic: 0 };

  for (let i = 0; i < sorted.length; i++) {
    const bump = i < need ? 1 : 0;
    out[sorted[i].key] = sorted[i].floor + bump;
  }

  return out;
}
