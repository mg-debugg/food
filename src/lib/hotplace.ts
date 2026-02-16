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
  hotKeywordCount: number;
  recentHotKeywordCount: number;
};

export type HotplaceCandidate = {
  name: string;
  score: HotplaceScoreResult;
};

const RECENT_DAYS = 90;
const HOTPLACE_KEYWORDS = [/인스타/g, /핫플/g, /포토존/g, /웨이팅/g, /줄\s*서/g, /데이트/g] as const;

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
  const reviewRows = reviews
    .map((r) => ({
      date: parseDate(r.date),
      text: r.text || "",
    }))
    .filter((r): r is { date: Date; text: string } => r.date !== null);

  const totalReviewCount = reviewRows.length;
  if (totalReviewCount === 0) {
    return {
      hotplaceScore: 0,
      recentRatio: 0,
      recentRatioPercent: 0,
      recent3mCount: 0,
      totalReviewCount: 0,
      multiplier: 1,
      hotKeywordCount: 0,
      recentHotKeywordCount: 0,
    };
  }

  const cutoff = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  const recentReviews = reviewRows.filter((r) => r.date >= cutoff);
  const recent3mCount = recentReviews.length;

  const countHotKeywords = (texts: string[]) =>
    HOTPLACE_KEYWORDS.reduce((acc, pattern) => {
      const count = texts.reduce((sum, txt) => sum + (txt.match(pattern)?.length ?? 0), 0);
      return acc + count;
    }, 0);

  const hotKeywordCount = countHotKeywords(reviewRows.map((r) => r.text));
  const recentHotKeywordCount = countHotKeywords(recentReviews.map((r) => r.text));

  if (recent3mCount === 0 && hotKeywordCount === 0) {
    return {
      hotplaceScore: 0,
      recentRatio: 0,
      recentRatioPercent: 0,
      recent3mCount: 0,
      totalReviewCount,
      multiplier: 1,
      hotKeywordCount: 0,
      recentHotKeywordCount: 0,
    };
  }

  const base = recent3mCount * 10;
  const recentRatio = recent3mCount / totalReviewCount;
  let multiplier = 1;
  if (recentRatio > 0.8) multiplier = 2;
  else if (recentRatio > 0.5) multiplier = 1.5;
  const hotKeywordBonus = Math.min(20, hotKeywordCount * 4 + recentHotKeywordCount * 2);
  const hotplaceScore = Math.round((base * multiplier + hotKeywordBonus) * 100) / 100;

  return {
    hotplaceScore,
    recentRatio,
    recentRatioPercent: Math.round(recentRatio * 10000) / 100,
    recent3mCount,
    totalReviewCount,
    multiplier,
    hotKeywordCount,
    recentHotKeywordCount,
  };
}

export function getTopHotplace(restaurants: HotplaceCandidate[]): HotplaceCandidate | null {
  if (restaurants.length === 0) return null;
  return [...restaurants].sort(
    (a, b) =>
      b.score.hotplaceScore - a.score.hotplaceScore ||
      b.score.recentHotKeywordCount - a.score.recentHotKeywordCount ||
      b.score.hotKeywordCount - a.score.hotKeywordCount ||
      b.score.recentRatio - a.score.recentRatio,
  )[0];
}
