"use client";

import type { NaverLocalItem, PlaceMeta } from "../lib/types";
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

  const addr = item.roadAddress || item.address || "";

  function commit(next: PlaceMeta) {
    onUpdate(key, { ...next, updatedAt: Date.now() });
  }

  function toggleTag(tag: (typeof TAGS)[number]) {
    const on = meta.tags.includes(tag);
    const tags = on ? meta.tags.filter((t) => t !== tag) : [...meta.tags, tag];
    commit({ ...meta, tags });
  }

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
          <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.2 }}>
            {item.title}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
            {item.category}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>
            {addr}
          </div>
          {item.telephone ? (
            <div style={{ marginTop: 4, fontSize: 12, color: "#6b7280" }}>
              {item.telephone}
            </div>
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

        <a href={item.link} target="_blank" rel="noreferrer">
          <button
            style={{
              padding: "6px 10px",
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "#fff",
              fontWeight: 700,
            }}
          >
            네이버 열기
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
        <textarea
          value={meta.memo}
          onChange={(e) => commit({ ...meta, memo: e.target.value })}
          rows={3}
          placeholder="메모를 입력하세요"
          style={{
            width: "100%",
            resize: "vertical",
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            padding: 10,
            outline: "none",
          }}
        />
      </div>
    </div>
  );
}

