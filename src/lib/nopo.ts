export type NopoReview = {
  text: string;
  createdAt?: string | Date | null;
};

export type NopoInput = {
  name: string;
  reviews: NopoReview[];
  sameNameCount?: number;
  menuFocusScore?: number | null;
  now?: Date;
};

export type NopoResult = {
  nopoScore: number;
  timelineScore: number;
  regularsTextScore: number;
  menuFocusScore: number;
  namePatternScore: number;
  penaltyScore: number;
  evidence: string[];
  metrics: {
    oldestReviewAgeYears: number;
    uniqueYearCount: number;
    recentAlive: number;
    posCount: number;
    negCount: number;
    franchiseLikely: number;
  };
};

const POS_TEXT_PATTERNS = [
  /단골/g,
  /\d+\s*년/g,
  /몇\s*년/g,
  /오래/g,
  /어릴\s*때부터/g,
  /변함없/g,
  /그대로/g,
  /동네/g,
  /주민/g,
  /아버지/g,
  /할머니/g,
  /옛날/g,
] as const;

const NEG_TEXT_PATTERNS = [
  /협찬/g,
  /제공/g,
  /광고/g,
  /원고료/g,
  /체험단/g,
  /오픈/g,
  /신상/g,
  /핫플/g,
  /인스타/g,
  /포토존/g,
] as const;

const POS_NAME_PATTERNS = [
  /식당/g,
  /국밥/g,
  /해장국/g,
  /분식/g,
  /칼국수/g,
  /백반/g,
  /원조/g,
  /본가/g,
  /2대/g,
  /3대/g,
  /since/gi,
  /노포/g,
] as const;

const NEG_NAME_PATTERNS = [/키친/g, /다이닝/g, /랩/g, /하우스/g, /바/g, /라운지/g] as const;

function clamp(n: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, n));
}

function toDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  const s = String(input).trim();
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

function countMatches(text: string, patterns: readonly RegExp[]): number {
  let total = 0;
  for (const pattern of patterns) {
    const matched = text.match(pattern);
    total += matched ? matched.length : 0;
  }
  return total;
}

function hasAny(text: string, patterns: readonly RegExp[]): number {
  return patterns.some((p) => p.test(text)) ? 1 : 0;
}

export function computeNopoScore(input: NopoInput): NopoResult {
  const now = input.now ?? new Date();
  const reviews = Array.isArray(input.reviews) ? input.reviews : [];
  const createdDates = reviews
    .map((r) => toDate(r.createdAt))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  let timelineScore = 0.5;
  let oldestReviewAgeYears = 0;
  let uniqueYearCount = 0;
  let recentAlive = 0;

  if (createdDates.length > 0) {
    const oldest = createdDates[0];
    const latest = createdDates[createdDates.length - 1];
    const yearMs = 365.25 * 24 * 60 * 60 * 1000;

    oldestReviewAgeYears = (now.getTime() - oldest.getTime()) / yearMs;
    const reviewSpanYears = (latest.getTime() - oldest.getTime()) / yearMs;
    const yearsBetweenOldestAndNow = Math.max(
      1,
      Math.round((now.getTime() - oldest.getTime()) / yearMs),
    );
    uniqueYearCount = new Set(createdDates.map((d) => d.getFullYear())).size;
    const yearCoverage = uniqueYearCount / Math.max(1, yearsBetweenOldestAndNow);
    const daysFromLatest = (now.getTime() - latest.getTime()) / (24 * 60 * 60 * 1000);
    recentAlive = daysFromLatest <= 180 ? 1 : 0;

    const ageScore = clamp(oldestReviewAgeYears / 8);
    const spanScore = clamp(reviewSpanYears / 6);
    const coverScore = clamp(yearCoverage);
    const aliveScore = recentAlive;

    timelineScore = clamp(
      0.35 * ageScore + 0.25 * spanScore + 0.25 * coverScore + 0.15 * aliveScore,
    );
  }

  const allText = reviews.map((r) => r.text || "").join(" ").toLowerCase();
  const posCount = countMatches(allText, POS_TEXT_PATTERNS);
  const negCount = countMatches(allText, NEG_TEXT_PATTERNS);
  const posScore = 1 - Math.exp(-posCount / 6);
  const negScore = 1 - Math.exp(-negCount / 4);
  const regularsTextScore = clamp(posScore - 0.8 * negScore);

  const menuFocusScore =
    input.menuFocusScore == null || Number.isNaN(input.menuFocusScore)
      ? 0.5
      : clamp(input.menuFocusScore);

  const name = (input.name || "").toLowerCase();
  const namePos = hasAny(name, POS_NAME_PATTERNS);
  const nameNeg = hasAny(name, NEG_NAME_PATTERNS);
  const namePatternScore = clamp(0.6 * namePos - 0.6 * nameNeg + 0.5);

  const franchiseLikely = (input.sameNameCount ?? 1) >= 3 ? 1 : 0;
  const penaltyScore = clamp(1 - (0.7 * franchiseLikely + 0.5 * negScore));

  const nopoScore = clamp(
    0.4 * timelineScore +
      0.25 * regularsTextScore +
      0.15 * menuFocusScore +
      0.1 * namePatternScore +
      0.1 * penaltyScore,
  );

  const evidence: string[] = [];
  if (oldestReviewAgeYears >= 6) evidence.push("리뷰가 오래전부터 존재");
  if (uniqueYearCount >= 4) evidence.push("여러 해에 걸친 리뷰");
  if (recentAlive === 1) evidence.push("최근에도 방문 리뷰");
  if (posCount >= 5) evidence.push("단골/오래됨 언급 많음");
  if (negCount === 0) evidence.push("광고성 키워드 적음");
  if (franchiseLikely === 1) evidence.push("프랜차이즈 의심");
  if (evidence.length === 0) evidence.push("노포 근거 데이터 보강 필요");

  return {
    nopoScore,
    timelineScore,
    regularsTextScore,
    menuFocusScore,
    namePatternScore,
    penaltyScore,
    evidence: evidence.slice(0, 3),
    metrics: {
      oldestReviewAgeYears,
      uniqueYearCount,
      recentAlive,
      posCount,
      negCount,
      franchiseLikely,
    },
  };
}
