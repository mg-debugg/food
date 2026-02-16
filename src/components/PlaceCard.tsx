"use client";

import { useEffect, useMemo, useState } from "react";
import type { NaverBlogItem, NaverLocalItem, PlaceMeta } from "../lib/types";
import { placeKey } from "../lib/placeKey";

type Props = {
  item: NaverLocalItem;
  meta: PlaceMeta;
  score: number;
  onUpdate: (key: string, nextMeta: PlaceMeta) => void;
};

const TAGS = ["혼밥", "데이트", "가족", "회식", "가성비"] as const;

export default function PlaceCard({ item, meta, score, onUpdate }: Props) {
  const key = placeKey(item);
  const [blogs, setBlogs] = useState<NaverBlogItem[]>([]);
  const [loadingBlogs, setLoadingBlogs] = useState(false);

  const addr = item.roadAddress || item.address || "";
  const mapQuery = useMemo(
    () => `${item.title} ${item.roadAddress || item.address || ""}`.trim(),
    [item.title, item.roadAddress, item.address],
  );
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
        const res = await fetch(
          `/api/naver/blog?query=${encodeURIComponent(item.title)}&display=3&start=1`,
        );
        const data = await res.json().catch(() => null);
        if (!mounted) return;
        if (!res.ok) {
          setBlogs([]);
          return;
        }
        const list = Array.isArray(data?.items) ? data.items : [];
        setBlogs(list.slice(0, 3));
      } finally {
        if (mounted) setLoadingBlogs(false);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [item.title]);

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 12,
        marginBottom: 10,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.2 }}>{item.title}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>{item.category}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>{addr}</div>
          {item.telephone ? (
            <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>{item.telephone}</div>
          ) : null}
        </div>

        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 22 }}>{score}</div>
          <div style={{ fontSize: 12, color: "#6b7280" }}>로컬 점수</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button
          onClick={() => commit({ ...meta, saved: !meta.saved })}
          style={{
            padding: "6px 10px",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: meta.saved ? "#111827" : "#f3f4f6",
            color: meta.saved ? "#fff" : "#111827",
            fontWeight: 700,
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
            onClick={() =>
              commit({ ...meta, revisitCount: Math.max(0, meta.revisitCount - 1) })
            }
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "#f9fafb",
              fontWeight: 800,
            }}
          >
            -
          </button>
          <span style={{ minWidth: 18, textAlign: "center", fontWeight: 800 }}>
            {meta.revisitCount}
          </span>
          <button
            onClick={() => commit({ ...meta, revisitCount: meta.revisitCount + 1 })}
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              background: "#f9fafb",
              fontWeight: 800,
            }}
          >
            +
          </button>
        </div>

        <a href={naverMapLink} target="_blank" rel="noreferrer">
          <button
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "#fff",
              fontWeight: 700,
            }}
          >
            네이버 지도 열기
          </button>
        </a>
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
        <div style={{ fontSize: 12, fontWeight: 700, color: "#374151", marginBottom: 6 }}>
          최신 내돈내산 블로그 후기
        </div>
        {loadingBlogs ? (
          <div style={{ fontSize: 12, color: "#6b7280" }}>불러오는 중...</div>
        ) : blogs.length === 0 ? (
          <div style={{ fontSize: 12, color: "#6b7280" }}>내돈내산 후기 링크가 없습니다.</div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {blogs.map((b) => (
              <li key={b.link} style={{ marginBottom: 4 }}>
                <a
                  href={b.link}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 13, color: "#0f172a" }}
                >
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

