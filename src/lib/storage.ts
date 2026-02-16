import type { PlaceMeta } from "./types";

const STORAGE_KEY = "suwon_places_meta_v1";

export function loadMeta(): Record<string, PlaceMeta> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, PlaceMeta>;
  } catch {
    return {};
  }
}

export function saveMeta(map: Record<string, PlaceMeta>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function getOrInitMeta(
  map: Record<string, PlaceMeta>,
  key: string,
): PlaceMeta {
  if (!map[key]) {
    map[key] = {
      saved: false,
      revisitCount: 0,
      tags: [],
      memo: "",
      updatedAt: Date.now(),
    };
  }
  return map[key];
}

export function computeLocalScore(meta: PlaceMeta): number {
  return (meta.saved ? 5 : 0) + meta.revisitCount * 3 + meta.tags.length * 2;
}

