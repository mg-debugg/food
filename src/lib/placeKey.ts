import type { NaverLocalItem } from "./types";

function normalize(input: string): string {
  if (!input) return "";
  // Keep only Korean/English/digits. Drop spaces/symbols and lowercase for stability.
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, "")
    .trim();
}

export function placeKey(item: NaverLocalItem): string {
  const title = normalize(item.title ?? "");
  const addr = normalize(item.roadAddress || item.address || "");
  // Prefer a stable key across repeated searches/sort modes.
  return `${title}|${addr}`;
}
