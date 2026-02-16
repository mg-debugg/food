import test from "node:test";
import assert from "node:assert/strict";
import { computeNopoScore } from "./nopo";

const NOW = new Date("2026-02-16T00:00:00Z");

function mkReview(text: string, createdAt: string) {
  return { text, createdAt };
}

test("fallback score is neutral when review data is missing", () => {
  const r = computeNopoScore({ name: "태화장", reviews: [], now: NOW });
  assert.ok(r.nopoScore >= 0 && r.nopoScore <= 1);
  assert.equal(r.menuFocusScore, 0.5);
});

test("timeline score rises for long-lived reviewed places", () => {
  const r = computeNopoScore({
    name: "태화장",
    now: NOW,
    reviews: [
      mkReview("오래된 단골집", "20150101"),
      mkReview("지금도 그대로 맛있음", "20251210"),
    ],
  });
  assert.ok(r.timelineScore > 0.4);
});

test("recent alive signal is reflected", () => {
  const r = computeNopoScore({
    name: "오래식당",
    now: NOW,
    reviews: [mkReview("최근 방문", "20260120")],
  });
  assert.equal(r.metrics.recentAlive, 1);
});

test("regulars text score increases with positive keywords", () => {
  const r = computeNopoScore({
    name: "동네국밥",
    now: NOW,
    reviews: [
      mkReview("단골 단골 단골 옛날부터 동네 주민", "20240101"),
      mkReview("오래 변함없는 맛", "20250101"),
    ],
  });
  assert.ok(r.regularsTextScore > 0.3);
});

test("regulars text score is penalized by ad-like terms", () => {
  const pos = computeNopoScore({
    name: "동네국밥",
    now: NOW,
    reviews: [mkReview("단골 주민 오래", "20240101")],
  });
  const neg = computeNopoScore({
    name: "동네국밥",
    now: NOW,
    reviews: [mkReview("협찬 광고 체험단 신상 오픈", "20240101")],
  });
  assert.ok(neg.regularsTextScore < pos.regularsTextScore);
});

test("name pattern score boosts traditional names", () => {
  const r = computeNopoScore({
    name: "원조 태화장 국밥",
    now: NOW,
    reviews: [mkReview("방문", "20240101")],
  });
  assert.ok(r.namePatternScore > 0.5);
});

test("name pattern score lowers trendy naming patterns", () => {
  const r = computeNopoScore({
    name: "미드타운 다이닝 라운지",
    now: NOW,
    reviews: [mkReview("방문", "20240101")],
  });
  assert.ok(r.namePatternScore < 0.5);
});

test("penalty score drops when franchise likely", () => {
  const base = computeNopoScore({
    name: "태화장",
    sameNameCount: 1,
    now: NOW,
    reviews: [mkReview("동네 단골", "20240101")],
  });
  const chain = computeNopoScore({
    name: "태화장",
    sameNameCount: 4,
    now: NOW,
    reviews: [mkReview("동네 단골", "20240101")],
  });
  assert.ok(chain.penaltyScore < base.penaltyScore);
});

test("evidence includes timeline and low-ad indicators when applicable", () => {
  const r = computeNopoScore({
    name: "원조 국밥집",
    now: NOW,
    reviews: [
      mkReview("단골집", "20140101"),
      mkReview("여전히 맛있다", "20251201"),
    ],
  });
  assert.ok(r.evidence.length >= 1);
});

test("score stays clamped in [0,1]", () => {
  const r = computeNopoScore({
    name: "광고 핫플 라운지",
    sameNameCount: 10,
    now: NOW,
    reviews: [mkReview("협찬 광고 체험단 신상 핫플", "20260101")],
  });
  assert.ok(r.nopoScore >= 0 && r.nopoScore <= 1);
});
