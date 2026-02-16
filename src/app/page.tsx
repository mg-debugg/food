"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PlaceCard from "../components/PlaceCard";
import type { NaverLocalItem, PlaceMeta } from "../lib/types";
import { placeKey } from "../lib/placeKey";
import { computeLocalScore, loadMeta, saveMeta } from "../lib/storage";

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

  const [metaMap, setMetaMap] = useState<Record<string, PlaceMeta>>({});
  const [adSignalMap, setAdSignalMap] = useState<Record<string, number>>({});
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
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  const prepared = useMemo(() => {
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
      if (km <= 0.7) return 4;
      if (km <= 1.5) return 3;
      if (km <= 3) return 2;
      if (km <= 5) return 1;
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
      const rankBoost = Math.max(0, 10 - idx);
      const adSignals = adSignalMap[key] ?? 0;
      const adPenalty = adSignals > 0 ? Math.min(4, adSignals * 2) : 0;
      const coord = parseNaverCoords(it);
      const distance =
        userLocation && coord ? distanceKm(userLocation, { lat: coord.lat, lng: coord.lng }) : null;
      const distanceBonus = distance == null ? 0 : getDistanceBonus(distance);
      const score = Math.max(0, computeLocalScore(meta) + rankBoost + distanceBonus - adPenalty);
      return { it, key, meta, score, adSignals, adPenalty, distance, distanceBonus };
    });

    if (sortMode === "local") {
      enriched.sort((a, b) => b.score - a.score || b.meta.updatedAt - a.meta.updatedAt);
    }

    return enriched;
  }, [items, region, category, sortMode, metaMap, adSignalMap, userLocation]);

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
              placeholder="메뉴를 입력하세요 (예: 곱창, 파스타)"
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
              {locating ? "위치 확인중" : userLocation ? "내 위치 갱신" : "내 위치 사용"}
            </button>
          </div>
          {locationError ? (
            <div style={{ marginTop: -4, marginBottom: 10, fontSize: 12, color: "#b91c1c" }}>
              {locationError}
            </div>
          ) : null}
          {userLocation ? (
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
          </div>
        </div>

        {loading ? <div style={{ padding: 12, color: "#6b7280" }}>검색중...</div> : null}
        {error ? <div style={{ padding: 12, color: "#b91c1c" }}>{error}</div> : null}

        {!loading && !error && items.length === 0 ? (
          <div style={{ padding: 12, color: "#6b7280" }}>
            메뉴 검색을 시작해 주세요. 서버에서 자동으로 "{region} " 접두사를 붙입니다.
          </div>
        ) : null}

        {!loading && !error && items.length > 0 && prepared.length === 0 ? (
          <div style={{ padding: 12, color: "#6b7280" }}>결과가 없습니다.</div>
        ) : null}

        <div style={{ marginTop: 14 }}>
          {prepared.map(({ it, key, meta, score, adSignals, adPenalty, distance, distanceBonus }) => (
            <PlaceCard
              key={key}
              item={it}
              meta={meta}
              score={score}
              region={region}
              adSignals={adSignals}
              adPenalty={adPenalty}
              distanceKm={distance}
              distanceBonus={distanceBonus}
              onAdSignal={updateAdSignal}
              onUpdate={updateMeta}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
