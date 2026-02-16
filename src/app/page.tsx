"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PlaceCard from "../components/PlaceCard";
import type { NaverLocalItem, PlaceMeta } from "../lib/types";
import { placeKey } from "../lib/placeKey";
import { loadMeta, saveMeta } from "../lib/storage";
import { getTopHotplace, type HotplaceScoreResult } from "../lib/hotplace";

type Region = "수원" | "대구" | "여수" | "광명";

const REGIONS: Region[] = ["수원", "대구", "여수", "광명"];
const DISPLAY_LIMIT = 10;
const EARTH_RADIUS_KM = 6371;
const NEARBY_DISTANCE_KM = 5;
const NON_FOOD_CATEGORY_PATTERNS = [
  /행정복지센터/,
  /주민센터/,
  /구청/,
  /시청/,
  /공공/,
  /사회기관/,
  /관공서/,
  /복지/,
  /병원/,
  /약국/,
  /학교/,
  /학원/,
  /부동산/,
  /은행/,
  /숙박/,
  /호텔/,
  /펜션/,
];
const FOOD_CATEGORY_PATTERNS = [
  /음식점/,
  /한식/,
  /중식/,
  /일식/,
  /양식/,
  /카페/,
  /분식/,
  /치킨/,
  /피자/,
  /족발/,
  /보쌈/,
  /국밥/,
  /해장국/,
  /고기/,
  /술집/,
  /포차/,
  /디저트/,
  /베이커리/,
];

function toRadians(degree: number): number {
  return (degree * Math.PI) / 180;
}

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return EARTH_RADIUS_KM * c;
}

function parseMapCoordinate(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return null;
  if (Math.abs(n) > 1000) return n / 10_000_000;
  return n;
}

function isFoodPlace(it: NaverLocalItem): boolean {
  const category = (it.category || "").trim();
  if (!category) return true;
  if (NON_FOOD_CATEGORY_PATTERNS.some((p) => p.test(category))) return false;
  if (FOOD_CATEGORY_PATTERNS.some((p) => p.test(category))) return true;
  return !/센터|기관|학교|병원|약국|은행|호텔|모텔|공공|관공서/.test(category);
}

export default function Page() {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<Region>("수원");
  const [items, setItems] = useState<NaverLocalItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hotMode, setHotMode] = useState(false);
  const [useNearbyBoost, setUseNearbyBoost] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationResolved, setLocationResolved] = useState(false);

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

  useEffect(() => {
    if (locationResolved || userLocation) return;
    if (typeof window === "undefined" || !navigator.geolocation) {
      setLocationResolved(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setLocationResolved(true);
      },
      () => {
        setLocationResolved(true);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 },
    );
  }, [locationResolved, userLocation]);

  async function search(nextHotMode: boolean) {
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setHotMode(nextHotMode);
    try {
      const params = new URLSearchParams({
        query: q,
        region,
        display: String(DISPLAY_LIMIT),
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

    const food = items.filter(isFoodPlace);
    const preferredFood = food.filter(hasRegion);
    const otherFood = food.filter((it) => !hasRegion(it));

    let list = preferredFood.length > 0 ? [...preferredFood, ...otherFood] : food;
    list = list.slice(0, DISPLAY_LIMIT);

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
      const lat = parseMapCoordinate(it.mapy);
      const lng = parseMapCoordinate(it.mapx);
      const distanceFromUserKm =
        userLocation && lat !== null && lng !== null
          ? distanceKm(userLocation.lat, userLocation.lng, lat, lng)
          : null;
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
          hotKeywordCount: 0,
          recentHotKeywordCount: 0,
        } satisfies HotplaceScoreResult);

      const isHotNow =
        hotplace.recent3mCount > 0 || hotplace.multiplier > 1 || hotplace.hotKeywordCount > 0;
      const hotRankScore = hotplace.recent3mCount * 100 + hotplace.hotKeywordCount * 10 + searchIndexScore;

      return {
        it,
        key,
        meta,
        score,
        scoreMax,
        searchIndexScore,
        distanceFromUserKm,
        adEventPenalty,
        penaltyDetectedCount: penaltySignalMap[key] ?? 0,
        hotplaceScore: hotplace.hotplaceScore,
        hotplaceRatioPercent: hotplace.recentRatioPercent,
        hotplaceRecentCount: hotplace.recent3mCount,
        hotplaceRatio: hotplace.recentRatio,
        hotKeywordCount: hotplace.hotKeywordCount,
        hotRankScore,
        isHotNow,
      };
    });

    const nearbyFiltered = useNearbyBoost
      ? userLocation
        ? enriched.filter(
            (p) => p.distanceFromUserKm !== null && p.distanceFromUserKm <= NEARBY_DISTANCE_KM,
          )
        : []
      : enriched;

    if (hotMode) {
      const hotSorted = [...nearbyFiltered];
      hotSorted.sort(
        (a, b) =>
          b.hotRankScore - a.hotRankScore ||
          b.hotplaceRecentCount - a.hotplaceRecentCount ||
          b.hotKeywordCount - a.hotKeywordCount ||
          b.searchIndexScore - a.searchIndexScore ||
          b.score - a.score,
      );
      return hotSorted;
    }

    nearbyFiltered.sort((a, b) => b.score - a.score || b.meta.updatedAt - a.meta.updatedAt);
    return nearbyFiltered;
  }, [items, region, metaMap, penaltySignalMap, hotplaceMap, hotMode, useNearbyBoost, userLocation]);

  const topHotplace = useMemo(
    () =>
      getTopHotplace(
        prepared
          .map((p) => ({
            name: p.it.title,
            score: {
              hotplaceScore: p.hotplaceScore,
              recentRatio: p.hotplaceRatio,
              recentRatioPercent: p.hotplaceRatioPercent,
              recent3mCount: p.hotplaceRecentCount,
              totalReviewCount: 0,
              multiplier: p.hotplaceScore > 0 ? 1 : 0,
              hotKeywordCount: p.hotKeywordCount,
              recentHotKeywordCount: p.hotKeywordCount,
            },
          }))
          .filter((p) => p.score.recent3mCount > 0 || p.score.hotKeywordCount > 0),
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
          <div style={{ margin: "8px 0 14px", display: "flex", alignItems: "center", gap: 10 }}>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, color: "#111827" }}>로컬 맛집찾기</h1>
            <img
              src="/title-mascot.svg"
              alt="로컬 맛집찾기 마스코트"
              style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", border: "1px solid #d1d5db" }}
            />
          </div>

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
                if (e.key === "Enter") search(false);
              }}
              placeholder="동네이름 또는 메뉴를 입력하세요 (예 : 수원 국밥)"
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
              onClick={() => search(false)}
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
            <button
              onClick={() => search(true)}
              disabled={loading || !query.trim()}
              style={{
                height: 46,
                padding: "0 16px",
                borderRadius: 14,
                border: "1px solid #b45309",
                background: hotMode ? "#b45309" : "#fff7ed",
                color: hotMode ? "#fff" : "#9a3412",
                fontWeight: 800,
                opacity: loading || !query.trim() ? 0.6 : 1,
                cursor: loading || !query.trim() ? "not-allowed" : "pointer",
              }}
            >
              핫플
            </button>
          </div>

          <label
            style={{
              marginTop: 2,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "#374151",
              fontWeight: 700,
            }}
          >
            <input
              type="checkbox"
              checked={useNearbyBoost}
              onChange={(e) => {
                const checked = e.target.checked;
                setUseNearbyBoost(checked);
              }}
            />
            5km 이내만 보기 (위치 동의)
          </label>
        </div>

        {loading ? <div style={{ padding: 12, color: "#6b7280" }}>검색중...</div> : null}
        {error ? <div style={{ padding: 12, color: "#b91c1c" }}>{error}</div> : null}
        {!loading && !error && useNearbyBoost && !userLocation && !locationResolved ? (
          <div style={{ padding: 12, color: "#6b7280" }}>현재 위치 확인 중입니다. 확인 후 5km 이내 식당만 표시됩니다.</div>
        ) : null}
        {!loading && !error && useNearbyBoost && !userLocation && locationResolved ? (
          <div style={{ padding: 12, color: "#6b7280" }}>위치 권한이 필요합니다. 권한 허용 후 5km 이내 필터를 사용할 수 있습니다.</div>
        ) : null}
        {!loading && !error && useNearbyBoost && userLocation && prepared.length === 0 ? (
          <div style={{ padding: 12, color: "#6b7280" }}>5km 이내 식당이 없습니다.</div>
        ) : null}

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

        <div style={{ marginTop: 14 }}>
          {prepared.map(
            ({
              it,
              key,
              meta,
              score,
              scoreMax,
              searchIndexScore,
              distanceFromUserKm,
              adEventPenalty,
              penaltyDetectedCount,
              hotplaceRecentCount,
              hotKeywordCount,
              isHotNow,
            }) => (
              <PlaceCard
                key={key}
                item={it}
                meta={meta}
                score={score}
                scoreMax={scoreMax}
                searchIndexScore={searchIndexScore}
                distanceFromUserKm={distanceFromUserKm}
                adEventPenalty={adEventPenalty}
                penaltyDetectedCount={penaltyDetectedCount}
                hotplaceRecentCount={hotplaceRecentCount}
                hotKeywordCount={hotKeywordCount}
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
