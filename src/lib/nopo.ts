export type NopoReview = {
  text: string;
  createdAt?: string | Date | null;
};

export type NopoInput = {
  name: string;
  reviews: NopoReview[];
  sameNameCount?: number;
  now?: Date;
};

export type NopoResult = {
  nopoScore: number;
  evidence: string[];
  metrics: {
    oldestReviewAgeYears: number;
    uniqueYearCount: number;
    latestReviewAgeMonths: number;
    positiveCount: number;
    negativeCount: number;
    adEventDetected: number;
    franchiseLikely: number;
    agePoint: number;
    strongKeywordPoint: number;
    regularKeywordPoint: number;
    menuFocusPoint: number;
    adPenaltyPoint: number;
  };
};

const BASE_SCORE = 5;

const POSITIVE_PATTERNS = [
  /단골/g,
  /오래/g,
  /변함없/g,
  /어릴/g,
  /동네/g,
  /주민/g,
  /몇\s*년/g,
  /\d+\s*년/g,
  /십년/g,
  /2대/g,
  /3대/g,
  /since/gi,
] as const;

const STRONG_POSITIVE_PATTERNS = [/2대/g, /3대/g, /since/gi, /몇\s*십년/g, /십년/g] as const;

const NEGATIVE_PATTERNS = [/신상/g, /오픈/g, /핫플/g, /인스타/g, /포토존/g] as const;

const AD_EVENT_PATTERNS = [/협찬/g, /제공/g, /광고/g, /체험단/g, /리뷰\s*이벤트/g, /원고료/g] as const;

const FOOD_PATTERNS = [
  /국밥/g,
  /해장국/g,
  /곱창/g,
  /순대/g,
  /냉면/g,
  /칼국수/g,
  /제육/g,
  /김치찌개/g,
  /된장찌개/g,
  /불고기/g,
  /삼겹/g,
  /짬뽕/g,
  /짜장/g,
  /탕수육/g,
  /돈까스/g,
  /초밥/g,
  /라멘/g,
] as const;

const AMBIENCE_PATTERNS = [/인테리어/g, /감성/g, /분위기/g, /사진/g, /포토/g, /뷰/g] as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseDate(input: string | Date | null | undefined): Date | null {
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

function hasAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function computeMenuFocusPoint(text: string): number {
  const foodCounts = FOOD_PATTERNS
    .map((p) => text.match(p)?.length ?? 0)
    .filter((n) => n > 0)
    .sort((a, b) => b - a);
  const totalMenuMentions = foodCounts.reduce((acc, cur) => acc + cur, 0);

  if (totalMenuMentions > 0) {
    const top1 = foodCounts[0] ?? 0;
    const top2 = (foodCounts[0] ?? 0) + (foodCounts[1] ?? 0);
    const top2Ratio = top2 / Math.max(1, totalMenuMentions);
    if (top2Ratio >= 0.5) return 1;
    return 0;
  }

  const ambienceMentions = countMatches(text, AMBIENCE_PATTERNS);
  if (ambienceMentions >= 3) return -1;
  return 0;
}

export function computeNopoScore(input: NopoInput): NopoResult {
  const now = input.now ?? new Date();
  const reviews = Array.isArray(input.reviews) ? input.reviews : [];
  const allText = reviews.map((r) => r.text || "").join(" ").toLowerCase();

  const adEventDetected = hasAny(allText, AD_EVENT_PATTERNS) ? 1 : 0;
  const adPenaltyPoint = adEventDetected ? 1 : 0;

  const dates = reviews
    .map((r) => parseDate(r.createdAt))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  const oldestReviewAgeYears =
    dates.length > 0 ? (now.getTime() - dates[0].getTime()) / (365.25 * 24 * 60 * 60 * 1000) : 0;
  const uniqueYearCount = dates.length > 0 ? new Set(dates.map((d) => d.getFullYear())).size : 0;
  const latestReviewAgeMonths =
    dates.length > 0
      ? (now.getTime() - dates[dates.length - 1].getTime()) / (30.4375 * 24 * 60 * 60 * 1000)
      : 999;

  let addPoints = 0;
  let minusPoints = 0;
  let agePoint = 0;
  let strongKeywordPoint = 0;
  let regularKeywordPoint = 0;
  let menuFocusPoint = 0;
  let positiveCount = 0;
  let negativeCount = 0;

  const evidence: string[] = [];

  // Cold-start: keep base score. Only ad penalty (always) + franchise penalty apply.
  if (reviews.length >= 3) {
    if (oldestReviewAgeYears >= 6) {
      agePoint += 2;
      evidence.push("리뷰 6년 이상 존재");
    } else if (oldestReviewAgeYears >= 3) {
      agePoint += 1;
      evidence.push("리뷰 3년 이상 존재");
    }
    if (uniqueYearCount >= 4) {
      addPoints += 1;
      evidence.push("여러 해에 걸친 리뷰");
    }
    if (latestReviewAgeMonths <= 6) {
      addPoints += 1;
      evidence.push("최근 방문 리뷰 있음");
    } else if (latestReviewAgeMonths > 12) {
      minusPoints += 1;
    }

    positiveCount = countMatches(allText, POSITIVE_PATTERNS);
    negativeCount = countMatches(allText, NEGATIVE_PATTERNS);

    if (positiveCount >= 5) {
      regularKeywordPoint += 1;
      evidence.push("단골/오래됨 언급 다수");
    }

    if (hasAny(allText, STRONG_POSITIVE_PATTERNS)) {
      strongKeywordPoint += 1;
    }

    if (negativeCount >= 4) {
      minusPoints += 1;
    }

    menuFocusPoint = computeMenuFocusPoint(allText);
  }

  addPoints += agePoint + strongKeywordPoint + regularKeywordPoint + menuFocusPoint;

  if (adPenaltyPoint > 0) {
    minusPoints += adPenaltyPoint;
    evidence.push("광고성 키워드 발견");
  }

  const franchiseLikely = (input.sameNameCount ?? 1) >= 3 ? 1 : 0;
  if (franchiseLikely) {
    minusPoints += 1;
    evidence.push("프랜차이즈 의심");
  }

  const nopoScore = Math.round(clamp(BASE_SCORE + addPoints - minusPoints, 0, 10) * 10) / 10;

  return {
    nopoScore,
    evidence: evidence.slice(0, 3),
    metrics: {
      oldestReviewAgeYears,
      uniqueYearCount,
      latestReviewAgeMonths,
      positiveCount,
      negativeCount,
      adEventDetected,
      franchiseLikely,
      agePoint,
      strongKeywordPoint,
      regularKeywordPoint,
      menuFocusPoint,
      adPenaltyPoint,
    },
  };
}
