export const runtime = "nodejs";

type Region = "수원" | "대구" | "여수" | "광명";

type MapRestaurantSummary = Record<string, unknown> & {
  __typename?: string;
  name?: string;
  imageUrl?: string;
  imageUrls?: string[];
};

type CachedImagePayload = {
  expiresAt: number;
  image: string;
};

const IMAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const imageCache = new Map<string, CachedImagePayload>();

function normalizeText(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function decodeNaverEscapedUrl(raw: string): string {
  if (!raw) return "";
  return raw.replace(/\\u002F/g, "/").replace(/\\u0026/g, "&");
}

function isHttpUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
}

function extractApolloState(html: string): Record<string, unknown> | null {
  const marker = "window.__APOLLO_STATE__";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;

  const equalIndex = html.indexOf("=", markerIndex);
  if (equalIndex < 0) return null;

  const start = html.indexOf("{", equalIndex);
  if (start < 0) return null;

  let inString = false;
  let escaping = false;
  let depth = 0;
  let end = -1;

  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaping) escaping = false;
      else if (ch === "\\") escaping = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end < 0) return null;

  try {
    return JSON.parse(html.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function collectCandidates(apolloState: Record<string, unknown>): MapRestaurantSummary[] {
  return Object.values(apolloState).filter((v): v is MapRestaurantSummary => {
    if (!v || typeof v !== "object") return false;
    const item = v as MapRestaurantSummary;
    if (item.__typename !== "RestaurantListSummary") return false;

    const image = decodeNaverEscapedUrl(String(item.imageUrl || ""));
    const firstFromList = decodeNaverEscapedUrl(String(item.imageUrls?.[0] || ""));
    return isHttpUrl(image) || isHttpUrl(firstFromList);
  });
}

function scoreName(name: string, candidateName: string): number {
  const normalizedName = normalizeText(name);
  const normalizedCandidate = normalizeText(candidateName);
  if (!normalizedName || !normalizedCandidate) return 0;
  if (normalizedName === normalizedCandidate) return 100;
  if (normalizedCandidate.includes(normalizedName) || normalizedName.includes(normalizedCandidate)) return 70;

  let overlap = 0;
  for (const ch of normalizedName) {
    if (normalizedCandidate.includes(ch)) overlap += 1;
  }
  return Math.min(30, overlap);
}

function pickBestImageByName(name: string, candidates: MapRestaurantSummary[]): string {
  let bestScore = -1;
  let bestImage = "";

  for (const c of candidates) {
    const primary = decodeNaverEscapedUrl(String(c.imageUrl || ""));
    const fallback = decodeNaverEscapedUrl(String(c.imageUrls?.[0] || ""));
    const imageUrl = isHttpUrl(primary) ? primary : fallback;
    if (!isHttpUrl(imageUrl)) continue;

    const score = scoreName(name, String(c.name || ""));
    if (score > bestScore) {
      bestScore = score;
      bestImage = imageUrl;
    }
  }

  if (bestImage) return bestImage;

  for (const c of candidates) {
    const primary = decodeNaverEscapedUrl(String(c.imageUrl || ""));
    const fallback = decodeNaverEscapedUrl(String(c.imageUrls?.[0] || ""));
    const imageUrl = isHttpUrl(primary) ? primary : fallback;
    if (isHttpUrl(imageUrl)) return imageUrl;
  }

  return "";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const name = (sp.get("name") ?? "").trim();
  const regionRaw = (sp.get("region") ?? "").trim();
  const region: Region = (["수원", "대구", "여수", "광명"] as const).includes(regionRaw as Region)
    ? (regionRaw as Region)
    : "수원";

  if (!name) {
    return Response.json(
      { error: "name parameter is required" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const cacheKey = normalizeText(`${region}|${name}`);
  const cached = imageCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json(
      { image: cached.image, source: "naver-map", item: null },
      { headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=86400" } },
    );
  }
  if (cached && cached.expiresAt <= Date.now()) imageCache.delete(cacheKey);

  try {
    const queries = [name, `${region} ${name}`];
    let image = "";

    for (const query of queries) {
      const endpoint = `https://m.place.naver.com/restaurant/list?query=${encodeURIComponent(query)}`;
      const res = await fetch(endpoint, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          Referer: "https://m.place.naver.com/",
        },
        cache: "no-store",
      });

      if (!res.ok) continue;
      const html = await res.text();
      const apolloState = extractApolloState(html);
      if (!apolloState) continue;

      const candidates = collectCandidates(apolloState);
      image = pickBestImageByName(name, candidates);
      if (image) break;
    }

    imageCache.set(cacheKey, {
      expiresAt: Date.now() + IMAGE_CACHE_TTL_MS,
      image,
    });

    return Response.json(
      {
        image,
        source: "naver-map",
        item: null,
      },
      { headers: { "Cache-Control": "public, max-age=600, stale-while-revalidate=86400" } },
    );
  } catch (err: any) {
    return Response.json(
      { error: "unexpected server error", detail: String(err?.message ?? err) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
