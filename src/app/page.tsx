"use client";

import { useEffect, useMemo, useState } from "react";
import PlaceCard from "../components/PlaceCard";
import type { NaverLocalItem, PlaceMeta } from "../lib/types";
import { placeKey } from "../lib/placeKey";
import { computeLocalScore, loadMeta, saveMeta } from "../lib/storage";

type Region = "수원" | "여수";
type SortMode = "local" | "random" | "comment";
type CategoryMode = "전체" | "한식" | "중식" | "일식" | "양식" | "카페" | "술집";

const REGIONS: Region[] = ["수원", "여수"];
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

  function updateMeta(key: string, nextMeta: PlaceMeta) {
    setMetaMap((prev) => {
      const next = { ...prev, [key]: nextMeta };
      saveMeta(next);
      return next;
    });
  }

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
        display: "20",
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
    // Prefer items whose address contains selected region.
    const hasRegion = (it: NaverLocalItem) =>
      (it.address || "").includes(region) || (it.roadAddress || "").includes(region);

    let list = items;
    const prefer = items.filter(hasRegion);
    if (prefer.length > 0) list = prefer;

    if (category !== "전체") {
      list = list.filter((it) => (it.category || "").includes(category));
    }

    const enriched = list.map((it) => {
      const key = placeKey(it);
      const meta =
        metaMap[key] ??
        ({
          saved: false,
          revisitCount: 0,
          tags: [],
          updatedAt: 0,
        } satisfies PlaceMeta);
      const score = computeLocalScore(meta);
      return { it, key, meta, score };
    });

    if (sortMode === "local") {
      enriched.sort((a, b) => b.score - a.score || (b.meta.updatedAt - a.meta.updatedAt));
    }

    return enriched;
  }, [items, region, category, sortMode, metaMap]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #fff7ed 0%, #ffffff 45%, #f8fafc 100%)",
      }}
    >
      <div style={{ maxWidth: 960, margin: "0 auto", padding: 16 }}>
        <h1 style={{ fontSize: 28, fontWeight: 900, margin: "18px 0 12px" }}>
          로컬 맛집 찾기 (MVP)
        </h1>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {REGIONS.map((r) => (
            <button
              key={r}
              onClick={() => setRegion(r)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: region === r ? "#111827" : "#f3f4f6",
                color: region === r ? "#fff" : "#111827",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              {r}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") search();
            }}
            placeholder={`검색어를 입력하세요 (예: 곱창)`}
            style={{
              flex: 1,
              height: 44,
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              padding: "0 12px",
              outline: "none",
              background: "#fff",
            }}
          />
          <button
            onClick={search}
            disabled={loading || !query.trim()}
            style={{
              height: 44,
              padding: "0 14px",
              borderRadius: 12,
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

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: category === c ? "#111827" : "#f3f4f6",
                color: category === c ? "#fff" : "#111827",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              {c}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {([
            { id: "local", label: "로컬점수(기본)" },
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

        {loading ? <div style={{ padding: 10 }}>검색중...</div> : null}
        {error ? <div style={{ padding: 10, color: "#b91c1c" }}>{error}</div> : null}

        {!loading && !error && items.length === 0 ? (
          <div style={{ padding: 10, color: "#6b7280" }}>
            검색어를 입력하고 검색해 주세요. (서버에서 자동으로 &quot;{region} &quot; prefix가
            붙습니다)
          </div>
        ) : null}

        {!loading && !error && items.length > 0 && prepared.length === 0 ? (
          <div style={{ padding: 10, color: "#6b7280" }}>결과가 없습니다.</div>
        ) : null}

        <div>
          {prepared.map(({ it, key, meta, score }) => (
            <PlaceCard
              key={key}
              item={it}
              meta={meta}
              score={score}
              region={region}
              onUpdate={updateMeta}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

