"use client";

import { useEffect, useMemo, useState } from "react";
import type { NaverBlogItem, NaverLocalItem, PlaceMeta } from "../lib/types";
import { placeKey } from "../lib/placeKey";

type Region = "수원" | "여수" | "대구";

type Props = {
  item: NaverLocalItem;
  meta: PlaceMeta;
  score: number;
  scoreMax: number;
  region: Region;
  adSignals: number;
  adPenalty: number;
  distanceKm: number | null;
  distanceBonus: number;
  scoreDetail: {
    saved: number;
    revisit: number;
    tags: number;
    distance: number;
    adPenalty: number;
    rankBoost: number;
  };
  onAdSignal: (key: string, suspiciousCount: number) => void;
  onUpdate: (key: string, nextMeta: PlaceMeta) => void;
};

const TAGS = ["혼밥", "데이트", "가족", "회식", "가성비"] as const;
const AD_PATTERNS = [
  /협찬/,
  /광고/,
  /제공받아/,
  /원고료/,
  /파트너스/,
  /체험단/,
  /지원받아/,
  /유료\s*광고/,
  /업체로부터/,
] as const;

function extractSigungu(address: string): string {
  if (!address) return "";
  const parts = address.split(/\s+/).filter(Boolean);
  const sigungu = parts.filter((p) => p.endsWith("시") || p.endsWith("군") || p.endsWith("구"));
  return sigungu.slice(0, 3).join(" ");
}

function hasSponsoredPhrase(s: string): boolean {
  const text = (s || "").toLowerCase();
  return AD_PATTERNS.some((pattern) => pattern.test(text));
}

export default function PlaceCard({
  item,
  meta,
  score,
  scoreMax,
  region,
  adSignals,
  adPenalty,
  distanceKm,
  distanceBonus,
  scoreDetail,
  onAdSignal,
  onUpdate,
}: Props) {
  const key = placeKey(item);
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

  function toggleTag(tag: (typeof TAGS)[number]) {
    const on = meta.tags.includes(tag);
    const tags = on ? meta.tags.filter((t) => t !== tag) : [...meta.tags, tag];
    commit({ ...meta, tags });
  }

  useEffect(() => {
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
          onAdSignal(key, 0);
          return;
        }
        const list = (Array.isArray(data?.items) ? data.items : []).slice(0, 3);
        setBlogs(list);

        const suspiciousCount = list.filter((b: NaverBlogItem) => {
          const merged = `${b.title || ""} ${b.description || ""}`;
          return hasSponsoredPhrase(merged);
        }).length;
        onAdSignal(key, suspiciousCount);
      } finally {
        if (mounted) setLoadingBlogs(false);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [item.title, region, key, onAdSignal]);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const params = new URLSearchParams({
          query: item.title,
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
  }, [item.title, region]);

  return (
    <div
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
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 900, fontSize: 18, lineHeight: 1.2, color: "#111827" }}>{item.title}</div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>{item.category}</div>
              <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>{addr}</div>
              {item.telephone ? (
                <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>{item.telephone}</div>
              ) : null}
            </div>

            <div
              style={{
                width: 120,
                height: 90,
                borderRadius: 12,
                overflow: "hidden",
                flexShrink: 0,
                border: "1px solid #e5e7eb",
                background: "#f3f4f6",
              }}
            >
              {menuImage ? (
                <img
                  src={menuImage}
                  alt={`${item.title} 대표 메뉴`}
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
                  메뉴 이미지
                </div>
              )}
            </div>
          </div>
        </div>

        <div style={{ textAlign: "right", flexShrink: 0, minWidth: 74 }}>
          <div style={{ fontWeight: 900, fontSize: 22, color: "#0f172a" }}>
            {score}/{scoreMax}점
          </div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>로컬 점수</div>
          {distanceKm != null ? (
            <div style={{ marginTop: 5, fontSize: 11, color: "#2563eb", fontWeight: 800 }}>
              {distanceKm.toFixed(1)}km · 거리+{distanceBonus}
            </div>
          ) : null}
          {adPenalty > 0 ? (
            <div style={{ marginTop: 5, fontSize: 11, color: "#b91c1c", fontWeight: 800 }}>
              광고감점 -{adPenalty}
            </div>
          ) : null}
        </div>
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

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          <span style={{ fontSize: 12, color: "#6b7280" }}>재방문</span>
          <button
            onClick={() => commit({ ...meta, revisitCount: Math.max(0, meta.revisitCount - 1) })}
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "#f9fafb",
              fontWeight: 900,
            }}
          >
            -
          </button>
          <span style={{ minWidth: 18, textAlign: "center", fontWeight: 800 }}>{meta.revisitCount}</span>
          <button
            onClick={() => commit({ ...meta, revisitCount: meta.revisitCount + 1 })}
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "#f9fafb",
              fontWeight: 900,
            }}
          >
            +
          </button>
        </div>

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
            네이버 지도 열기
          </button>
        </a>
      </div>

      <div
        style={{
          marginTop: 10,
          padding: "8px 10px",
          borderRadius: 10,
          border: "1px solid #e5e7eb",
          background: "#f9fafb",
          fontSize: 11,
          color: "#4b5563",
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span>찜 {scoreDetail.saved}/5</span>
        <span>재방문 {scoreDetail.revisit}/3</span>
        <span>태그 {scoreDetail.tags}/5</span>
        <span>거리 {scoreDetail.distance}/2</span>
        <span>검색순위 {scoreDetail.rankBoost}/10</span>
        <span>광고감점 -{scoreDetail.adPenalty}</span>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {TAGS.map((tag) => {
          const on = meta.tags.includes(tag);
          return (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: on ? "#111827" : "#f3f4f6",
                color: on ? "#fff" : "#111827",
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              {tag}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#374151" }}>최신 블로그 후기</div>
          <div style={{ fontSize: 11, color: adSignals > 0 ? "#b91c1c" : "#6b7280", fontWeight: 700 }}>
            {adSignals > 0 ? `협찬/광고 문구 ${adSignals}건 감지` : "협찬/광고 문구 미감지"}
          </div>
        </div>
        {loadingBlogs ? (
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
