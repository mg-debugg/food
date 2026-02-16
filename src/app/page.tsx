"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PlaceCard from "../components/PlaceCard";
import type { NaverLocalItem, PlaceMeta } from "../lib/types";
import { placeKey } from "../lib/placeKey";
import { loadMeta, saveMeta } from "../lib/storage";
import { computeNopoScore, type NopoResult } from "../lib/nopo";
import { getTopHotplace, type HotplaceScoreResult } from "../lib/hotplace";

type Region = "수원" | "여수" | "대구";
type SortMode = "local" | "random" | "comment";
type CategoryMode = "전체" | "한식" | "중식" | "일식" | "양식" | "카페" | "술집";

const REGIONS: Region[] = ["수원", "여수", "대구"];
const CATEGORIES: CategoryMode[] = ["전체", "한식", "중식", "일식", "양식", "카페", "술집"];

export default function Page() {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<Region>("수원");
  const [items, setItems] = useState<NaverLocalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<CategoryMode>("전체");
  const [sortMode, setSortMode] = useState<SortMode>("local");
  const [nopoMode, setNopoMode] = useState(false);
  const [hotplaceMode, setHotplaceMode] = useState(false);

  const [metaMap, setMetaMap] = useState<Record<string, PlaceMeta>>({});
  const [adSignalMap, setAdSignalMap] = useState<Record<string, number>>({});
  const [promoSignalMap, setPromoSignalMap] = useState<Record<string, number>>({});
  const [commentRankBonusMap, setCommentRankBonusMap] = useState<Record<string, number>>({});
  const [blogVolumeBonusMap, setBlogVolumeBonusMap] = useState<Record<string, number>>({});
  const [nopoMap, setNopoMap] = useState<Record<string, NopoResult>>({});
  const [hotplaceMap, setHotplaceMap] = useState<Record<string, HotplaceScoreResult>>({});
  const [useDistanceBonus, setUseDistanceBonus] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

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

  const updateAdSignal = useCallback((key: string, suspiciousCount: number) => {
    setAdSignalMap((prev) => {
      if ((prev[key] ?? 0) === suspiciousCount) return prev;
      return { ...prev, [key]: suspiciousCount };
    });
  }, []);

  const updatePromoSignal = useCallback((key: string, eventCount: number) => {
    setPromoSignalMap((prev) => {
      if ((prev[key] ?? 0) === eventCount) return prev;
      return { ...prev, [key]: eventCount };
    });
  }, []);

  const updateBlogVolumeBonus = useCallback((key: string, bonus: number) => {
    setBlogVolumeBonusMap((prev) => {
      if ((prev[key] ?? 0) === bonus) return prev;
      return { ...prev, [key]: bonus };
    });
  }, []);

  const updateNopo = useCallback((key: string, result: NopoResult) => {
    setNopoMap((prev) => {
      const old = prev[key];
      if (old && old.nopoScore === result.nopoScore && old.evidence.join("|") === result.evidence.join("|")) {
        return prev;
      }
      return { ...prev, [key]: result };
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

  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationError("이 브라우저는 위치 정보를 지원하지 않습니다.");
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLocating(false);
      },
      () => {
        setLocationError("위치 권한을 확인해 주세요.");
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 60000 },
    );
  }, []);

  async function search() {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    try {
      const sortParam = sortMode === "comment" ? "comment" : "random";
      const params = new URLSearchParams({
        query: q,
        region,
        display: "10",
        start: "1",
        sort: sortParam,
      });

      const res = await fetch(`/api/naver/local?${params.toString()}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || "API error");
      }

      const nextItems: NaverLocalItem[] = Array.isArray(data?.items) ? data.items : [];
      setItems(nextItems);

      if (sortMode === "local") {
        const commentParams = new URLSearchParams({
          query: q,
          region,
          display: "10",
          start: "1",
          sort: "comment",
        });
        const commentRes = await fetch(`/api/naver/local?${commentParams.toString()}`);
        const commentData = await commentRes.json().catch(() => null);
        if (commentRes.ok && Array.isArray(commentData?.items)) {
          const map: Record<string, number> = {};
          commentData.items.forEach((it: NaverLocalItem, idx: number) => {
            const k = placeKey(it);
            let bonus = 0;
            if (idx === 0) bonus = 4;
            else if (idx === 1) bonus = 3;
            else if (idx === 2) bonus = 2;
            else if (idx <= 4) bonus = 1;
            map[k] = bonus;
          });
          setCommentRankBonusMap(map);
        } else {
          setCommentRankBonusMap({});
        }
      } else {
        setCommentRankBonusMap({});
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  const prepared = useMemo(() => {
    const sameNameCountMap: Record<string, number> = {};
    for (const it of items) {
      const normTitle = (it.title || "").trim().toLowerCase();
      sameNameCountMap[normTitle] = (sameNameCountMap[normTitle] ?? 0) + 1;
    }

    function parseNaverCoords(it: NaverLocalItem): { lat: number; lng: number } | null {
      const x = Number.parseFloat(it.mapx || "");
      const y = Number.parseFloat(it.mapy || "");
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const asScaled = { lng: x / 1e7, lat: y / 1e7 };
      if (
        asScaled.lat >= 30 &&
        asScaled.lat <= 45 &&
        asScaled.lng >= 120 &&
        asScaled.lng <= 135
      ) {
        return asScaled;
      }
      if (y >= 30 && y <= 45 && x >= 120 && x <= 135) {
        return { lat: y, lng: x };
      }
      return null;
    }

    function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const lat1 = toRad(a.lat);
      const lat2 = toRad(b.lat);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
      return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    function getDistanceBonus(km: number): number {
      if (km <= 1.5) return 2;
      if (km <= 4) return 1;
      return 0;
    }

    const hasRegion = (it: NaverLocalItem) =>
      (it.address || "").includes(region) || (it.roadAddress || "").includes(region);

    let list = items;
    const prefer = items.filter(hasRegion);
    const others = items.filter((it) => !hasRegion(it));
    if (prefer.length > 0) list = [...prefer, ...others];

    if (category !== "전체") {
      list = list.filter((it) => (it.category || "").includes(category));
    }

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
      const rankBoost = Math.max(0, 6 - idx);
      const commentRankBoost = commentRankBonusMap[key] ?? 0;
      const blogVolumeBoost = blogVolumeBonusMap[key] ?? 0;
      const adSignals = adSignalMap[key] ?? 0;
      const promoSignals = promoSignalMap[key] ?? 0;
      const adPenalty = Math.min(3, adSignals);
      const promoPenalty = Math.min(2, promoSignals);
      const coord = parseNaverCoords(it);
      const distance =
        useDistanceBonus && userLocation && coord
          ? distanceKm(userLocation, { lat: coord.lat, lng: coord.lng })
          : null;
      const distanceBonus = distance == null ? 0 : getDistanceBonus(distance);
      const savedScore = meta.saved ? 5 : 0;
      const revisitScore = Math.min(3, meta.revisitCount);
      const tagScore = Math.min(5, meta.tags.length);
      const scoreMax = 28;
      const baseScore =
        savedScore +
        revisitScore +
        tagScore +
        distanceBonus +
        rankBoost +
        commentRankBoost +
        blogVolumeBoost;
      const score = Math.max(0, Math.min(scoreMax, baseScore - adPenalty - promoPenalty));
      const normTitle = (it.title || "").trim().toLowerCase();
      const sameNameCount = sameNameCountMap[normTitle] ?? 1;
      const nopoDefault = computeNopoScore({
        name: it.title,
        sameNameCount,
        reviews: [],
      });
      const nopo = nopoMap[key] ?? nopoDefault;
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
      const totalNorm = score / Math.max(1, scoreMax);
      const distanceNorm = useDistanceBonus ? distanceBonus / 2 : 0.5;
      const hybridScore = 0.55 * nopo.nopoScore + 0.25 * totalNorm + 0.2 * distanceNorm;
      return {
        it,
        key,
        meta,
        score,
        scoreMax,
        nopoScore: nopo.nopoScore,
        nopoEvidence: nopo.evidence,
        hybridScore,
        hotplaceScore: hotplace.hotplaceScore,
        hotplaceRatioPercent: hotplace.recentRatioPercent,
        hotplaceRatio: hotplace.recentRatio,
        hotplaceRecentCount: hotplace.recent3mCount,
        sameNameCount,
        adSignals,
        adPenalty,
        promoPenalty,
        distance,
        distanceBonus,
        scoreDetail: {
          saved: savedScore,
          revisit: revisitScore,
          tags: tagScore,
          distance: distanceBonus,
          adPenalty,
          promoPenalty,
          rankBoost,
          commentRank: commentRankBoost,
          blogVolume: blogVolumeBoost,
        },
      };
    });

    if (hotplaceMode) {
      enriched.sort(
        (a, b) =>
          b.hotplaceScore - a.hotplaceScore ||
          b.hotplaceRatio - a.hotplaceRatio ||
          b.score - a.score,
      );
    } else if (nopoMode) {
      enriched.sort((a, b) => b.hybridScore - a.hybridScore || b.nopoScore - a.nopoScore || b.score - a.score);
    } else if (sortMode === "local") {
      enriched.sort((a, b) => b.score - a.score || b.meta.updatedAt - a.meta.updatedAt);
    }

    return enriched;
  }, [
    items,
    region,
    category,
    sortMode,
    metaMap,
    adSignalMap,
    promoSignalMap,
    commentRankBonusMap,
    blogVolumeBonusMap,
    nopoMap,
    hotplaceMap,
    nopoMode,
    hotplaceMode,
    useDistanceBonus,
    userLocation,
  ]);

  const topHotplace = useMemo(
    () =>
      getTopHotplace(
        prepared.map((p) => ({
          name: p.it.title,
          score: {
            hotplaceScore: p.hotplaceScore,
            recentRatio: p.hotplaceRatio,
            recentRatioPercent: p.hotplaceRatioPercent,
            recent3mCount: p.hotplaceRecentCount,
            totalReviewCount: 0,
            multiplier: 1,
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
            {useDistanceBonus ? (
              <button
                onClick={requestLocation}
                disabled={locating}
                style={{
                  height: 46,
                  padding: "0 12px",
                  borderRadius: 14,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  color: "#111827",
                  fontWeight: 700,
                  opacity: locating ? 0.7 : 1,
                  cursor: locating ? "wait" : "pointer",
                }}
              >
                {locating ? "위치 확인중" : "위치"}
              </button>
            ) : null}
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
              padding: "7px 10px",
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              background: "#fff",
            }}
          >
            <input
              id="distance-bonus-toggle"
              type="checkbox"
              checked={useDistanceBonus}
              onChange={(e) => setUseDistanceBonus(e.target.checked)}
            />
            <label
              htmlFor="distance-bonus-toggle"
              style={{ fontSize: 13, color: "#374151", fontWeight: 700, cursor: "pointer" }}
            >
              가까운 곳 우선 (위치 가점)
            </label>
          </div>
          {useDistanceBonus && locationError ? (
            <div style={{ marginTop: -4, marginBottom: 10, fontSize: 12, color: "#b91c1c" }}>
              {locationError}
            </div>
          ) : null}
          {useDistanceBonus && userLocation ? (
            <div style={{ marginTop: -4, marginBottom: 10, fontSize: 12, color: "#4b5563" }}>
              위치 기반 거리 가점 활성화됨
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #e5e7eb",
                  background: category === c ? "#111827" : "#f9fafb",
                  color: category === c ? "#fff" : "#374151",
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                {c}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {([
              { id: "local", label: "로컬점수" },
              { id: "random", label: "네이버 random" },
              { id: "comment", label: "네이버 comment" },
            ] as const).map((s) => (
              <button
                key={s.id}
                onClick={() => setSortMode(s.id)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid #e5e7eb",
                  background: sortMode === s.id ? "#111827" : "#ffffff",
                  color: sortMode === s.id ? "#fff" : "#111827",
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                {s.label}
              </button>
            ))}
            <button
              onClick={() =>
                setNopoMode((v) => {
                  const next = !v;
                  if (next) setHotplaceMode(false);
                  return next;
                })
              }
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #0f766e",
                background: nopoMode ? "#0f766e" : "#ffffff",
                color: nopoMode ? "#fff" : "#0f766e",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              노포모드(찐 노포)
            </button>
            <button
              onClick={() =>
                setHotplaceMode((v) => {
                  const next = !v;
                  if (next) setNopoMode(false);
                  return next;
                })
              }
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #b45309",
                background: hotplaceMode ? "#b45309" : "#ffffff",
                color: hotplaceMode ? "#fff" : "#b45309",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              핫플모드(최근 급상승)
            </button>
          </div>
        </div>

        {loading ? <div style={{ padding: 12, color: "#6b7280" }}>검색중...</div> : null}
        {error ? <div style={{ padding: 12, color: "#b91c1c" }}>{error}</div> : null}

        {!loading && !error && items.length > 0 && prepared.length === 0 ? (
          <div style={{ padding: 12, color: "#6b7280" }}>결과가 없습니다.</div>
        ) : null}
        {!loading && !error && hotplaceMode && topHotplace ? (
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
            현재 Top 핫플: {topHotplace.name} · 지수 {topHotplace.score.hotplaceScore.toFixed(0)} ·
            최근 3개월 비율 {topHotplace.score.recentRatioPercent.toFixed(0)}%
          </div>
        ) : null}

        <div style={{ marginTop: 14 }}>
          {prepared.map(
            ({
              it,
              key,
              meta,
              score,
              scoreMax,
              nopoScore,
              nopoEvidence,
              hybridScore,
              hotplaceScore,
              hotplaceRatioPercent,
              sameNameCount,
              adSignals,
              adPenalty,
              promoPenalty,
              distance,
              distanceBonus,
              scoreDetail,
            }) => (
            <PlaceCard
              key={key}
              item={it}
              meta={meta}
              score={score}
              scoreMax={scoreMax}
              nopoScore={nopoScore}
              nopoEvidence={nopoEvidence}
              isNopoMode={nopoMode}
              hotplaceScore={hotplaceScore}
              hotplaceRatioPercent={hotplaceRatioPercent}
              isHotplaceMode={hotplaceMode}
              isTopHotplace={topHotplace?.name === it.title}
              region={region}
              adSignals={adSignals}
              adPenalty={adPenalty}
              promoPenalty={promoPenalty}
              distanceKm={distance}
              distanceBonus={distanceBonus}
              scoreDetail={scoreDetail}
              onAdSignal={updateAdSignal}
              onPromoSignal={updatePromoSignal}
              onBlogVolumeBonus={updateBlogVolumeBonus}
              onNopoUpdate={updateNopo}
              onHotplaceUpdate={updateHotplace}
              sameNameCount={sameNameCount}
              onUpdate={updateMeta}
            />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
