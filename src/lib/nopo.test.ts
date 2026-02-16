import test from "node:test";
import assert from "node:assert/strict";
import { computeNopoScore } from "./nopo";

const NOW = new Date("2026-02-16T00:00:00Z");

function review(text: string, createdAt: string) {
  return { text, createdAt };
}

test("nopoScore is always clamped between 0 and 10", () => {
  const r = computeNopoScore({
    name: "테스트",
    sameNameCount: 10,
    now: NOW,
    reviews: [review("협찬 광고 체험단 리뷰이벤트 원고료", "20260101")],
  });
  assert.ok(r.nopoScore >= 0 && r.nopoScore <= 10);
});

test("base score starts from 5", () => {
  const r = computeNopoScore({ name: "기본", reviews: [], now: NOW });
  assert.equal(r.nopoScore, 5);
});

test("ad/event keyword applies -1 once even with many matches", () => {
  const r = computeNopoScore({
    name: "광고테스트",
    now: NOW,
    reviews: [review("협찬 광고 제공 체험단 리뷰이벤트 원고료", "20260101")],
  });
  assert.equal(r.metrics.adPenaltyPoint, 1);
  assert.ok(r.evidence.includes("광고성 키워드 발견"));
});

test("cold-start skips time/text/menu scoring but keeps ad penalty", () => {
  const r = computeNopoScore({
    name: "콜드",
    now: NOW,
    reviews: [review("협찬", "20260101"), review("광고", "20260102")],
  });
  assert.equal(r.nopoScore, 4);
});

test("age and timeline bonuses are applied", () => {
  const r = computeNopoScore({
    name: "오래식당",
    now: NOW,
    reviews: [
      review("단골", "20140101"),
      review("옛날", "20210101"),
      review("최근 방문", "20260101"),
    ],
  });
  assert.ok(r.metrics.agePoint >= 2);
  assert.ok(r.metrics.uniqueYearCount >= 3);
});

test("stale latest review causes -1 penalty", () => {
  const r = computeNopoScore({
    name: "오래된데끊김",
    now: NOW,
    reviews: [
      review("단골", "20100101"),
      review("오래", "20110101"),
      review("옛날", "20120101"),
    ],
  });
  assert.ok(r.metrics.latestReviewAgeMonths > 12);
});

test("positive keyword threshold and strong marker bonus are applied", () => {
  const r = computeNopoScore({
    name: "원조집",
    now: NOW,
    reviews: [
      review("단골 단골 오래 동네 주민", "20240101"),
      review("변함없고 몇년째", "20250101"),
      review("since 1985", "20260101"),
    ],
  });
  assert.ok(r.metrics.regularKeywordPoint >= 1);
  assert.ok(r.metrics.strongKeywordPoint >= 1);
});

test("negative/trendy keywords 4+ apply -1", () => {
  const r = computeNopoScore({
    name: "핫플집",
    now: NOW,
    reviews: [
      review("신상 오픈 핫플 인스타 포토존", "20260101"),
      review("핫플", "20260102"),
      review("인스타", "20260103"),
    ],
  });
  assert.ok(r.metrics.negativeCount >= 4);
});

test("franchise likely applies -1", () => {
  const r = computeNopoScore({
    name: "체인점",
    sameNameCount: 3,
    now: NOW,
    reviews: [review("단골", "20230101"), review("오래", "20240101"), review("옛날", "20250101")],
  });
  assert.equal(r.metrics.franchiseLikely, 1);
  assert.ok(r.evidence.includes("프랜차이즈 의심"));
});

test("evidence contains at most 3 entries", () => {
  const r = computeNopoScore({
    name: "근거많음",
    sameNameCount: 3,
    now: NOW,
    reviews: [
      review("단골 오래 변함없", "20100101"),
      review("동네 주민 몇년", "20150101"),
      review("최근 방문", "20260101"),
    ],
  });
  assert.ok(r.evidence.length <= 3);
});
