export const runtime = "nodejs";

type CachedLocalPayload = { expiresAt: number; payload: any };

const ALLOWED_REGIONS = ["수원", "대구", "여수", "광명"] as const;
type Region = (typeof ALLOWED_REGIONS)[number];

const SEARCH_CACHE_TTL_MS = 60 * 1000;
const searchCache = new Map<string, CachedLocalPayload>();

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
  /다이소/,
  /종합생활용품/,
  /생활용품/,
  /문구/,
  /마트/,
  /편의점/,
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
  /요리/,
  /패스트푸드/,
  /햄버거/,
  /돈가스/,
  /초밥/,
  /국수/,
  /냉면/,
  /찌개/,
  /전골/,
  /곱창/,
  /삼겹살/,
  /갈비/,
  /쌈밥/,
  /뷔페/,
  /닭갈비/,
  /쭈꾸미/,
  /횟집/,
  /해물/,
  /샤브/,
];

type MapRestaurantSummary = {
  __typename: "RestaurantListSummary";
  name?: string;
  roadAddress?: string;
  address?: string;
  commonAddress?: string;
  x?: string;
  y?: string;
  imageUrl?: string;
  imageUrls?: string[];
};

function stripHtmlTags(s: string): string {
  if (!s) return "";
  return s.replace(/<[^>]*>/g, "");
}

function clampInt(input: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(input, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function isFoodCategory(rawCategory: unknown): boolean {
  const category = String(rawCategory ?? "").trim();
  if (!category) return false;
  if (NON_FOOD_CATEGORY_PATTERNS.some((p) => p.test(category))) return false;
  return FOOD_CATEGORY_PATTERNS.some((p) => p.test(category));
}

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
  const raw = html.slice(start, end + 1);
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function collectMapCandidates(apolloState: Record<string, unknown>): MapRestaurantSummary[] {
  return Object.values(apolloState).filter((v): v is MapRestaurantSummary => {
    if (!v || typeof v !== "object") return false;
    const item = v as MapRestaurantSummary;
    if (item.__typename !== "RestaurantListSummary") return false;
    const primary = decodeNaverEscapedUrl(String(item.imageUrl || ""));
    const fallback = decodeNaverEscapedUrl(String(item.imageUrls?.[0] || ""));
    return isHttpUrl(primary) || isHttpUrl(fallback);
  });
}

async function fetchMapCandidates(query: string): Promise<MapRestaurantSummary[]> {
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
  if (!res.ok) return [];
  const html = await res.text();
  const apolloState = extractApolloState(html);
  if (!apolloState) return [];
  return collectMapCandidates(apolloState);
}

function toCoord(raw: unknown): number | null {
  const n = Number(String(raw ?? ""));
  if (!Number.isFinite(n)) return null;
  if (Math.abs(n) > 1000) return n / 10_000_000;
  return n;
}

function scoreCandidate(localItem: any, c: MapRestaurantSummary, region: string): number {
  const name = normalizeText(String(localItem?.title ?? ""));
  const address = normalizeText(String(localItem?.roadAddress || localItem?.address || ""));
  const regionNorm = normalizeText(region);
  const cName = normalizeText(String(c.name || ""));
  const cAddress = normalizeText([c.roadAddress, c.address, c.commonAddress].filter(Boolean).join(" "));

  let score = 0;
  if (cName === name) score += 100;
  else if (cName.includes(name) || name.includes(cName)) score += 60;

  if (address && cAddress && (cAddress.includes(address) || address.includes(cAddress))) {
    score += 30;
  } else if (address && cAddress && address.length >= 4 && cAddress.includes(address.slice(0, 4))) {
    score += 12;
  }

  if (cAddress.includes(regionNorm)) score += 6;

  const localX = toCoord(localItem?.mapx);
  const localY = toCoord(localItem?.mapy);
  const candX = toCoord(c.x);
  const candY = toCoord(c.y);
  if (localX !== null && localY !== null && candX !== null && candY !== null) {
    const d = Math.hypot(localX - candX, localY - candY);
    if (d < 0.0003) score += 120;
    else if (d < 0.001) score += 80;
    else if (d < 0.003) score += 40;
  }

  return score;
}

function getImageUrl(candidate: MapRestaurantSummary): string {
  const primary = decodeNaverEscapedUrl(String(candidate.imageUrl || ""));
  const fallback = decodeNaverEscapedUrl(String(candidate.imageUrls?.[0] || ""));
  return isHttpUrl(primary) ? primary : fallback;
}

function matchImageUrls(items: any[], mapCandidates: MapRestaurantSummary[], region: string): string[] {
  const used = new Set<number>();
  const result: string[] = [];

  for (const item of items) {
    let bestUnusedIdx = -1;
    let bestUnusedScore = -1;
    let bestAnyIdx = -1;
    let bestAnyScore = -1;

    for (let i = 0; i < mapCandidates.length; i += 1) {
      const c = mapCandidates[i];
      const imageUrl = getImageUrl(c);
      if (!isHttpUrl(imageUrl)) continue;

      const score = scoreCandidate(item, c, region);
      if (score > bestAnyScore) {
        bestAnyScore = score;
        bestAnyIdx = i;
      }
      if (!used.has(i) && score > bestUnusedScore) {
        bestUnusedScore = score;
        bestUnusedIdx = i;
      }
    }

    // Avoid noisy wrong-match; if confidence is low, return empty and let client fallback.
    const minScore = 55;
    if (bestUnusedIdx >= 0 && bestUnusedScore >= minScore) {
      used.add(bestUnusedIdx);
      result.push(getImageUrl(mapCandidates[bestUnusedIdx]));
      continue;
    }
    if (bestAnyIdx >= 0 && bestAnyScore >= 95) {
      result.push(getImageUrl(mapCandidates[bestAnyIdx]));
      continue;
    }
    result.push("");
  }

  return result;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const query = (sp.get("query") ?? "").trim();
  const regionRaw = (sp.get("region") ?? "수원").trim();
  const region: Region = ALLOWED_REGIONS.includes(regionRaw as Region)
    ? (regionRaw as Region)
    : "수원";

  const wantedDisplay = 10;
  const start = clampInt(sp.get("start") ?? "1", 1, 1000, 1);
  const sortRaw = (sp.get("sort") ?? "random").toLowerCase();
  const sort = sortRaw === "comment" ? "comment" : "random";
  const pageSize = 5;
  const cacheKey = `${region}|${query}|${sort}|${start}|${wantedDisplay}`;

  if (!query) {
    return Response.json(
      { error: "query parameter is required" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json(cached.payload, { headers: { "Cache-Control": "no-store" } });
  }
  if (cached && cached.expiresAt <= Date.now()) {
    searchCache.delete(cacheKey);
  }

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return Response.json(
      {
        error:
          "Missing env. Set NAVER_CLIENT_ID and NAVER_CLIENT_SECRET in .env.local (server only).",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const finalQuery = `${region} ${query}`;
  const headers = {
    "X-Naver-Client-Id": clientId,
    "X-Naver-Client-Secret": clientSecret,
  };

  async function fetchPage(display: number, pageStart: number, sortMode: "random" | "comment") {
    const endpoint = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(
      finalQuery,
    )}&display=${encodeURIComponent(String(display))}&start=${encodeURIComponent(
      String(pageStart),
    )}&sort=${encodeURIComponent(sortMode)}`;
    const res = await fetch(endpoint, {
      method: "GET",
      headers,
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`naver api error (${res.status}): ${detail}`);
    }
    return (await res.json()) as any;
  }

  try {
    const mapCandidatesPromise = (async () => {
      try {
        let candidates = await fetchMapCandidates(finalQuery);
        if (candidates.length === 0) {
          candidates = await fetchMapCandidates(`${region} ${query} 맛집`);
        }
        return candidates;
      } catch {
        return [] as MapRestaurantSummary[];
      }
    })();

    const seen = new Set<string>();
    const normalizedItems: any[] = [];
    let firstResponse: any = null;

    const appendItems = (page: any) => {
      if (!page) return;
      if (!firstResponse) firstResponse = page;
      const items = Array.isArray(page?.items) ? page.items : [];

      for (const raw of items) {
        const it = {
          ...raw,
          title: stripHtmlTags(String(raw?.title ?? "")),
        };
        if (!isFoodCategory(it.category)) continue;
        const key = `${it.title}|${it.roadAddress || it.address || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        normalizedItems.push(it);
        if (normalizedItems.length >= wantedDisplay) break;
      }
    };

    const collectBySort = async (
      sortMode: "random" | "comment",
      maxPages: number,
      parallelSize: number,
    ) => {
      const starts = Array.from({ length: maxPages }, (_, i) => start + i * pageSize);
      for (let i = 0; i < starts.length && normalizedItems.length < wantedDisplay; i += parallelSize) {
        const batch = starts.slice(i, i + parallelSize);
        const pages = await Promise.all(batch.map((s) => fetchPage(pageSize, s, sortMode).catch(() => null)));
        for (const page of pages) {
          appendItems(page);
          if (normalizedItems.length >= wantedDisplay) break;
        }
      }
    };

    await collectBySort(sort, 8, 3);
    if (normalizedItems.length < wantedDisplay && sort !== "comment") {
      await collectBySort("comment", 4, 2);
    }

    const finalItems = normalizedItems.slice(0, wantedDisplay);
    const mapCandidates = await withTimeout(mapCandidatesPromise, 1200, [] as MapRestaurantSummary[]);
    const mappedImageUrls = matchImageUrls(finalItems, mapCandidates, region);

    const enrichedItems = finalItems.map((it, idx) => ({
      ...it,
      mapImageUrl: mappedImageUrls[idx] || "",
    }));

    const json = { ...(firstResponse ?? {}), items: enrichedItems };
    searchCache.set(cacheKey, { expiresAt: Date.now() + SEARCH_CACHE_TTL_MS, payload: json });

    return Response.json(json, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    const detail = String(err?.message ?? err);
    const statusMatch = detail.match(/\((\d{3})\)/);
    const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : 500;
    return Response.json(
      {
        error: status >= 400 && status < 500 ? "naver api error" : "unexpected server error",
        detail,
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
