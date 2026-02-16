"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NaverBlogItem, NaverLocalItem, PlaceMeta } from "../lib/types";
import { placeKey } from "../lib/placeKey";
import { calculateHotplaceScore, type HotplaceScoreResult } from "../lib/hotplace";

type Region = "수원" | "대구" | "여수" | "광명";

type Props = {
  item: NaverLocalItem;
  meta: PlaceMeta;
  score: number;
  scoreMax: number;
  searchIndexScore: number;
  distanceFromUserKm: number | null;
  adEventPenalty: number;
  penaltyDetectedCount: number;
  hotplaceRecentCount: number;
  hotKeywordCount: number;
  isHotNow: boolean;
  region: Region;
  onPenaltySignal: (key: string, detected: number) => void;
  onHotplaceUpdate: (key: string, result: HotplaceScoreResult) => void;
  onUpdate: (key: string, nextMeta: PlaceMeta) => void;
};

const PENALTY_PATTERNS = [/협찬/, /제공/, /광고/, /체험단/, /리뷰\s*이벤트/, /원고료/] as const;

function extractSigungu(address: string): string {
  if (!address) return "";
  const parts = address.split(/\s+/).filter(Boolean);
  const sigungu = parts.filter((p) => p.endsWith("시") || p.endsWith("군") || p.endsWith("구"));
  return sigungu.slice(0, 3).join(" ");
}

function countPenaltyPhrases(s: string): number {
  const text = s || "";
  return PENALTY_PATTERNS.reduce((acc, pattern) => {
    const matches = text.match(new RegExp(pattern.source, "gi"));
    return acc + (matches?.length ?? 0);
  }, 0);
}

export default function PlaceCard({
  item,
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
  region,
  onPenaltySignal,
  onHotplaceUpdate,
  onUpdate,
}: Props) {
  const key = placeKey(item);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoadDetails, setShouldLoadDetails] = useState(false);
  const [blogs, setBlogs] = useState<NaverBlogItem[]>([]);
  const [loadingBlogs, setLoadingBlogs] = useState(false);
  const [menuImage, setMenuImage] = useState<string>("");

  const addr = item.roadAddress || item.address || "";
  const sigungu = useMemo(() => extractSigungu(addr), [addr]);
  const mapQuery = `${item.title} ${sigungu || region}`.trim();
  const naverMapLink = `https://map.naver.com/v5/search/${encodeURIComponent(mapQuery)}`;

  function commit(next: PlaceMeta) {
    onUpdate(key, { ...next, updatedAt: Date.now() });
  }

  useEffect(() => {
    const node = cardRef.current;
    if (!node || shouldLoadDetails) return;
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) {
      setShouldLoadDetails(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          setShouldLoadDetails(true);
          observer.disconnect();
          break;
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldLoadDetails]);

  useEffect(() => {
    if (!shouldLoadDetails) return;
    let mounted = true;
    const run = async () => {
      setLoadingBlogs(true);
      try {
        const params = new URLSearchParams({
          query: item.title,
          region,
          display: "3",
          start: "1",
        });
        const res = await fetch(`/api/naver/blog?${params.toString()}`);
        const data = await res.json().catch(() => null);
        if (!mounted) return;
        if (!res.ok) {
          setBlogs([]);
          onPenaltySignal(key, 0);
          onHotplaceUpdate(key, calculateHotplaceScore([]));
          return;
        }

        const list: NaverBlogItem[] = (Array.isArray(data?.items) ? data.items : []).slice(0, 3);
        setBlogs(list);

        onHotplaceUpdate(
          key,
          calculateHotplaceScore(
            list.map((b) => ({
              date: b.postdate,
              text: `${b.title || ""} ${b.description || ""}`,
            })),
          ),
        );

        const merged = list.map((b) => `${b.title || ""} ${b.description || ""}`).join(" ");
        onPenaltySignal(key, countPenaltyPhrases(merged));
      } catch {
        if (mounted) setBlogs([]);
        onPenaltySignal(key, 0);
        onHotplaceUpdate(key, calculateHotplaceScore([]));
      } finally {
        if (mounted) setLoadingBlogs(false);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [item.title, region, key, onPenaltySignal, onHotplaceUpdate, shouldLoadDetails]);

  useEffect(() => {
    if (!shouldLoadDetails) return;
    let mounted = true;
    const run = async () => {
      try {
        const preloadedImage = typeof item.mapImageUrl === "string" ? item.mapImageUrl : "";
        if (preloadedImage) {
          setMenuImage(preloadedImage);
          return;
        }
        setMenuImage("");
        const params = new URLSearchParams({
          name: item.title,
          address: addr,
          region,
        });
        const res = await fetch(`/api/naver/image?${params.toString()}`);
        const data = await res.json().catch(() => null);
        if (!mounted) return;
        if (!res.ok) {
          setMenuImage("");
          return;
        }

        const imageUrl = typeof data?.image === "string" ? data.image : "";
        setMenuImage(imageUrl);
      } catch {
        if (mounted) setMenuImage("");
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [item.title, item.mapImageUrl, addr, region, shouldLoadDetails]);

  return (
    <div
      ref={cardRef}
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 18,
        padding: 14,
        marginBottom: 12,
        background: "#fff",
        boxShadow: "0 8px 24px rgba(17,24,39,0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <div style={{ fontWeight: 900, fontSize: 18, lineHeight: 1.2, color: "#111827" }}>{item.title}</div>
            <div style={{ fontWeight: 900, fontSize: 20, color: "#0f172a", whiteSpace: "nowrap" }}>
              {score.toFixed(1)}/5.0점
            </div>
          </div>
          <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "#6b7280", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {addr}
            </div>
            <div style={{ fontSize: 11, color: penaltyDetectedCount > 0 ? "#b91c1c" : "#6b7280", fontWeight: 700, whiteSpace: "nowrap" }}>
              광고/이벤트 감지 {penaltyDetectedCount}건
            </div>
          </div>
          <div
            style={{
              marginTop: 8,
              width: "100%",
              height: 180,
              borderRadius: 12,
              overflow: "hidden",
              border: "1px solid #e5e7eb",
              background: "#f3f4f6",
            }}
          >
            {menuImage ? (
              <img
                src={menuImage}
                alt={`${item.title} 음식 사진`}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  color: "#6b7280",
                  fontWeight: 700,
                }}
              >
                음식 사진
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          padding: "8px 10px",
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          background: "#f9fafb",
          fontSize: 11,
          color: "#374151",
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span>검색지수 +{searchIndexScore.toFixed(1)}</span>
        <span>{distanceFromUserKm !== null ? `내 위치 ${distanceFromUserKm.toFixed(1)}km` : "위치 미동의"}</span>
        <span>광고/이벤트 감지 {penaltyDetectedCount}건 · 감점 -{adEventPenalty.toFixed(1)}</span>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {isHotNow ? (
          <span
            style={{
              padding: "5px 9px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 800,
              background: "#fff7ed",
              color: "#9a3412",
              border: "1px solid #fdba74",
            }}
          >
            핫플 마크 · 최근 3개월 리뷰 {hotplaceRecentCount}건
          </span>
        ) : null}
        {hotKeywordCount > 0 ? (
          <span
            style={{
              padding: "5px 9px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 800,
              background: "#eff6ff",
              color: "#1d4ed8",
              border: "1px solid #bfdbfe",
            }}
          >
            핫플 키워드 {hotKeywordCount}건
          </span>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button
          onClick={() => commit({ ...meta, saved: !meta.saved })}
          style={{
            padding: "7px 10px",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: meta.saved ? "#111827" : "#f9fafb",
            color: meta.saved ? "#fff" : "#111827",
            fontWeight: 800,
          }}
        >
          {meta.saved ? "찜됨" : "찜(저장)"}
        </button>

        <a href={naverMapLink} target="_blank" rel="noreferrer">
          <button
            style={{
              padding: "7px 10px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "#fff",
              fontWeight: 800,
            }}
          >
            네이버 지도
          </button>
        </a>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#374151" }}>최신 블로그 후기</div>
        </div>
        {!shouldLoadDetails ? (
          <div style={{ fontSize: 12, color: "#6b7280" }}>카드가 보이면 불러옵니다.</div>
        ) : loadingBlogs ? (
          <div style={{ fontSize: 12, color: "#6b7280" }}>불러오는 중...</div>
        ) : blogs.length === 0 ? (
          <div style={{ fontSize: 12, color: "#6b7280" }}>후기 링크가 없습니다.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {blogs.map((b) => (
              <li key={b.link} style={{ marginBottom: 4 }}>
                <a href={b.link} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "#0f172a" }}>
                  {b.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
