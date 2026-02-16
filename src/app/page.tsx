"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PlaceCard from "../components/PlaceCard";
import type { NaverLocalItem, PlaceMeta } from "../lib/types";
import { placeKey } from "../lib/placeKey";
import { loadMeta, saveMeta } from "../lib/storage";
import { getTopHotplace, type HotplaceScoreResult } from "../lib/hotplace";

type Region = "수원" | "여수" | "대구";

const REGIONS: Region[] = ["수원", "여수", "대구"];

export default function Page() {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<Region>("수원");
  const [items, setItems] = useState<NaverLocalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hotMode, setHotMode] = useState(false);

  const [metaMap, setMetaMap] = useState<Record<string, PlaceMeta>>({});
  const [penaltySignalMap, setPenaltySignalMap] = useState<Record<string, number>>({});
  const [hotplaceMap, setHotplaceMap] = useState<Record<string, HotplaceScoreResult>>({});

  useEffect(() => {
    setMetaMap(loadMeta());
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    setMetaMap((prev) => {
      let changed = false;
      const next: Record<string, PlaceMeta> = { ...prev };
      for (const it of items) {
        const k = placeKey(it);
        if (!next[k]) {
          next[k] = {
            saved: false,
            revisitCount: 0,
            tags: [],
            updatedAt: Date.now(),
          };
          changed = true;
        }
      }
      if (changed) saveMeta(next);
      return changed ? next : prev;
    });
  }, [items]);

  const updateMeta = useCallback((key: string, nextMeta: PlaceMeta) => {
    setMetaMap((prev) => {
      const next = { ...prev, [key]: nextMeta };
      saveMeta(next);
      return next;
    });
  }, []);

  const updatePenaltySignal = useCallback((key: string, detected: number) => {
    setPenaltySignalMap((prev) => {
      if ((prev[key] ?? 0) === detected) return prev;
      return { ...prev, [key]: detected };
    });
  }, []);

  const updateHotplace = useCallback((key: string, result: HotplaceScoreResult) => {
    setHotplaceMap((prev) => {
      const old = prev[key];
      if (
        old &&
        old.hotplaceScore === result.hotplaceScore &&
        old.recentRatio === result.recentRatio &&
        old.recent3mCount === result.recent3mCount
      ) {
        return prev;
      }
      return { ...prev, [key]: result };
    });
  }, []);

  async function search() {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        query: q,
        region,
        display: "10",
        start: "1",
        sort: "random",
      });

      const res = await fetch(`/api/naver/local?${params.toString()}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "API error");

      const nextItems: NaverLocalItem[] = Array.isArray(data?.items) ? data.items : [];
      setItems(nextItems);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  const prepared = useMemo(() => {
    const hasRegion = (it: NaverLocalItem) =>
      (it.address || "").includes(region) || (it.roadAddress || "").includes(region);

    let list = items;
    const prefer = items.filter(hasRegion);
    const others = items.filter((it) => !hasRegion(it));
    if (prefer.length > 0) list = [...prefer, ...others];

    const enriched = list.map((it, idx) => {
      const key = placeKey(it);
      const meta =
        metaMap[key] ??
        ({
          saved: false,
          revisitCount: 0,
          tags: [],
          updatedAt: 0,
        } satisfies PlaceMeta);

      const searchIndexScore = Math.max(0.5, 5 - idx * 0.5);
      const adEventPenalty = (penaltySignalMap[key] ?? 0) > 0 ? 1 : 0;
      const scoreMax = 5.0;
      const score = Math.max(0, Math.min(scoreMax, searchIndexScore - adEventPenalty));

      const hotplace =
        hotplaceMap[key] ??
        ({
          hotplaceScore: 0,
          recentRatio: 0,
          recentRatioPercent: 0,
          recent3mCount: 0,
          totalReviewCount: 0,
          multiplier: 1,
        } satisfies HotplaceScoreResult);

      const isHotNow = hotplace.recent3mCount > 0 || hotplace.multiplier > 1;

      return {
        it,
        key,
        meta,
        score,
        scoreMax,
        searchIndexScore,
        adEventPenalty,
        penaltyDetectedCount: penaltySignalMap[key] ?? 0,
        hotplaceScore: hotplace.hotplaceScore,
        hotplaceRatioPercent: hotplace.recentRatioPercent,
        hotplaceRecentCount: hotplace.recent3mCount,
        hotplaceRatio: hotplace.recentRatio,
        isHotNow,
      };
    });

    if (hotMode) {
      const hotOnly = enriched.filter((e) => e.isHotNow);
      hotOnly.sort(
        (a, b) =>
          b.hotplaceScore - a.hotplaceScore ||
          b.hotplaceRatio - a.hotplaceRatio ||
          b.score - a.score,
      );
      return hotOnly;
    }

    enriched.sort((a, b) => b.score - a.score || b.meta.updatedAt - a.meta.updatedAt);
    return enriched;
  }, [items, region, metaMap, penaltySignalMap, hotplaceMap, hotMode]);

  const topHotplace = useMemo(
    () =>
      getTopHotplace(
        prepared
          .filter((p) => p.isHotNow)
          .map((p) => ({
            name: p.it.title,
            score: {
              hotplaceScore: p.hotplaceScore,
              recentRatio: p.hotplaceRatio,
              recentRatioPercent: p.hotplaceRatioPercent,
              recent3mCount: p.hotplaceRecentCount,
              totalReviewCount: 0,
              multiplier: p.hotplaceScore > 0 ? 1 : 0,
            },
          })),
      ),
    [prepared],
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at 15% 0%, #fde68a 0%, #fff7ed 30%, #fff 72%), linear-gradient(120deg, #f8fafc 0%, #fff 100%)",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 16px 36px" }}>
        <div
          style={{
            background: "rgba(255,255,255,0.88)",
            border: "1px solid #e5e7eb",
            borderRadius: 24,
            padding: 18,
            boxShadow: "0 18px 45px rgba(17,24,39,0.06)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: "#92400e", letterSpacing: "0.08em" }}>
            LOCAL DINING PICKER
          </div>
          <h1 style={{ margin: "8px 0 14px", fontSize: 30, fontWeight: 900, color: "#111827" }}>
            노포/맛집 탐색
          </h1>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {REGIONS.map((r) => (
              <button
                key={r}
                onClick={() => setRegion(r)}
                style={{
                  padding: "7px 12px",
                  borderRadius: 999,
                  border: "1px solid #d1d5db",
                  background: region === r ? "#111827" : "#fff",
                  color: region === r ? "#fff" : "#374151",
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                {r}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") search();
              }}
              placeholder="메뉴를 입력하세요 (예 : 국밥)"
              style={{
                flex: 1,
                height: 46,
                borderRadius: 14,
                border: "1px solid #d1d5db",
                padding: "0 14px",
                outline: "none",
                background: "#fff",
                fontSize: 14,
              }}
            />
            <button
              onClick={search}
              disabled={loading || !query.trim()}
              style={{
                height: 46,
                padding: "0 16px",
                borderRadius: 14,
                border: "1px solid #111827",
                background: "#111827",
                color: "#fff",
                fontWeight: 800,
                opacity: loading || !query.trim() ? 0.6 : 1,
                cursor: loading || !query.trim() ? "not-allowed" : "pointer",
              }}
            >
              검색
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => setHotMode((v) => !v)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #b45309",
                background: hotMode ? "#b45309" : "#ffffff",
                color: hotMode ? "#fff" : "#b45309",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              핫플 {hotMode ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        {loading ? <div style={{ padding: 12, color: "#6b7280" }}>검색중...</div> : null}
        {error ? <div style={{ padding: 12, color: "#b91c1c" }}>{error}</div> : null}

        {!loading && !error && hotMode && topHotplace ? (
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid #fdba74",
              background: "#fff7ed",
              color: "#9a3412",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            최근 인기 가게: {topHotplace.name} · 지수 {topHotplace.score.hotplaceScore.toFixed(0)} · 최근 3개월 비율 {topHotplace.score.recentRatioPercent.toFixed(0)}%
          </div>
        ) : null}

        {!loading && !error && items.length > 0 && prepared.length === 0 ? (
          <div style={{ padding: 12, color: "#6b7280" }}>핫플 조건에 맞는 결과가 없습니다.</div>
        ) : null}

        <div style={{ marginTop: 14 }}>
          {prepared.map(
            ({
              it,
              key,
              meta,
              score,
              scoreMax,
              searchIndexScore,
              adEventPenalty,
              penaltyDetectedCount,
              hotplaceRecentCount,
              isHotNow,
            }) => (
              <PlaceCard
                key={key}
                item={it}
                meta={meta}
                score={score}
                scoreMax={scoreMax}
                searchIndexScore={searchIndexScore}
                adEventPenalty={adEventPenalty}
                penaltyDetectedCount={penaltyDetectedCount}
                hotplaceRecentCount={hotplaceRecentCount}
                isHotNow={isHotNow}
                region={region}
                onPenaltySignal={updatePenaltySignal}
                onHotplaceUpdate={updateHotplace}
                onUpdate={updateMeta}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
