export type HotplaceReview = {
  date: string;
  text: string;
};

export type HotplaceScoreResult = {
  hotplaceScore: number;
  recentRatio: number;
  recentRatioPercent: number;
  recent3mCount: number;
  totalReviewCount: number;
  multiplier: number;
};

export type HotplaceCandidate = {
  name: string;
  score: HotplaceScoreResult;
};

const RECENT_DAYS = 90;

function parseDate(input: string): Date | null {
  const s = (input || "").trim();
  if (!s) return null;
  if (/^\d{8}$/.test(s)) {
    const y = Number.parseInt(s.slice(0, 4), 10);
    const m = Number.parseInt(s.slice(4, 6), 10) - 1;
    const d = Number.parseInt(s.slice(6, 8), 10);
    const dt = new Date(y, m, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function calculateHotplaceScore(
  reviews: HotplaceReview[],
  now = new Date(),
): HotplaceScoreResult {
  const validDates = reviews
    .map((r) => parseDate(r.date))
    .filter((d): d is Date => d !== null);

  const totalReviewCount = validDates.length;
  if (totalReviewCount === 0) {
    return {
      hotplaceScore: 0,
      recentRatio: 0,
      recentRatioPercent: 0,
      recent3mCount: 0,
      totalReviewCount: 0,
      multiplier: 1,
    };
  }

  const cutoff = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const recent3mCount = validDates.filter((d) => d >= cutoff).length;
  if (recent3mCount === 0) {
    return {
      hotplaceScore: 0,
      recentRatio: 0,
      recentRatioPercent: 0,
      recent3mCount: 0,
      totalReviewCount,
      multiplier: 1,
    };
  }

  const base = recent3mCount * 10;
  const recentRatio = recent3mCount / totalReviewCount;
  let multiplier = 1;
  if (recentRatio > 0.8) multiplier = 2;
  else if (recentRatio > 0.5) multiplier = 1.5;

  return {
    hotplaceScore: Math.round(base * multiplier * 100) / 100,
    recentRatio,
    recentRatioPercent: Math.round(recentRatio * 10000) / 100,
    recent3mCount,
    totalReviewCount,
    multiplier,
  };
}

export function getTopHotplace(restaurants: HotplaceCandidate[]): HotplaceCandidate | null {
  if (restaurants.length === 0) return null;
  return [...restaurants].sort(
    (a, b) =>
      b.score.hotplaceScore - a.score.hotplaceScore ||
      b.score.recentRatio - a.score.recentRatio,
  )[0];
}
