export const runtime = "nodejs";

const ALLOWED_REGIONS = ["수원", "대구", "여수", "광명"] as const;
type Region = (typeof ALLOWED_REGIONS)[number];

type MapRestaurantSummary = {
  __typename: "RestaurantListSummary";
  name?: string;
  businessCategory?: string;
  roadAddress?: string;
  address?: string;
  commonAddress?: string;
  imageUrl?: string;
  imageUrls?: string[];
};

type ImageResponsePayload = {
  image: string;
  width: number;
  height: number;
  foundFood: boolean;
  isHighResolution: boolean;
  source: "naver-map";
  item: MapRestaurantSummary | null;
};

const IMAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const imageCache = new Map<string, { expiresAt: number; payload: ImageResponsePayload }>();
const inFlight = new Map<string, Promise<ImageResponsePayload>>();

function normalizeText(input: string): string {
  return String(input || "")
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function isHttpUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
}

function decodeNaverEscapedUrl(raw: string): string {
  if (!raw) return "";
  return raw.replace(/\\u002F/g, "/").replace(/\\u0026/g, "&");
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
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
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

function scoreCandidate(
  candidate: MapRestaurantSummary,
  normalizedName: string,
  normalizedAddress: string,
  region: Region,
): number {
  const candidateName = normalizeText(candidate.name || "");
  const candidateAddress = normalizeText(
    [candidate.roadAddress, candidate.address, candidate.commonAddress].filter(Boolean).join(" "),
  );
  const normalizedRegion = normalizeText(region);

  let score = 0;
  if (!candidateName) score -= 10;
  if (candidateName === normalizedName) score += 80;
  else if (candidateName.includes(normalizedName) || normalizedName.includes(candidateName)) score += 50;
  else {
    const overlap = normalizedName
      .split("")
      .filter((ch) => candidateName.includes(ch)).length;
    score += Math.min(20, overlap);
  }

  if (normalizedAddress && candidateAddress) {
    if (candidateAddress.includes(normalizedAddress) || normalizedAddress.includes(candidateAddress)) {
      score += 25;
    } else if (
      normalizedAddress.length >= 4 &&
      candidateAddress.includes(normalizedAddress.slice(0, 4))
    ) {
      score += 10;
    }
  }

  if (candidateAddress.includes(normalizedRegion)) score += 5;
  if (candidate.businessCategory === "restaurant") score += 10;
  return score;
}

function collectCandidates(apolloState: Record<string, unknown>): MapRestaurantSummary[] {
  return Object.values(apolloState)
    .filter((v): v is MapRestaurantSummary => {
      if (!v || typeof v !== "object") return false;
      const item = v as MapRestaurantSummary;
      if (item.__typename !== "RestaurantListSummary") return false;
      const image = decodeNaverEscapedUrl(String(item.imageUrl || ""));
      const firstFromList = decodeNaverEscapedUrl(String(item.imageUrls?.[0] || ""));
      return isHttpUrl(image) || isHttpUrl(firstFromList);
    });
}

async function fetchMapRepresentativeImage(query: string, region: Region) {
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
  if (!res.ok) throw new Error(`naver map error (${res.status})`);
  const html = await res.text();
  const apollo = extractApolloState(html);
  if (!apollo) return null;
  return { apollo, endpoint };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const name = (sp.get("name") ?? "").trim();
  const address = (sp.get("address") ?? "").trim();
  const regionRaw = (sp.get("region") ?? "수원").trim();
  const region: Region = ALLOWED_REGIONS.includes(regionRaw as Region)
    ? (regionRaw as Region)
    : "수원";
  const cacheKey = `${region}::${name}::${address}`;

  if (!name) {
    return Response.json(
      { error: "name parameter is required" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const now = Date.now();
  const cached = imageCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return Response.json(cached.payload, { headers: { "Cache-Control": "no-store" } });
  }
  if (cached && cached.expiresAt <= now) {
    imageCache.delete(cacheKey);
  }

  const queries = [
    `${region} ${name}`,
    `${name} ${address}`.trim(),
    `${region} ${name} 맛집`,
  ];

  try {
    const existing = inFlight.get(cacheKey);
    if (existing) {
      const payload = await existing;
      return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
    }

    const worker = (async (): Promise<ImageResponsePayload> => {
      let best:
        | {
            image: string;
            width: number;
            height: number;
            foundFood: boolean;
            isHighResolution: boolean;
            source: "naver-map";
            item: MapRestaurantSummary;
          }
        | null = null;

    const normalizedName = normalizeText(name);
    const normalizedAddress = normalizeText(address);

      for (const q of queries) {
        if (!q.trim()) continue;
        const mapResult = await fetchMapRepresentativeImage(q, region);
        if (!mapResult) continue;

        const candidates = collectCandidates(mapResult.apollo);
        if (candidates.length === 0) continue;

        const ranked = candidates
          .map((item) => {
            const imagePrimary = decodeNaverEscapedUrl(String(item.imageUrl || ""));
            const imageFromList = decodeNaverEscapedUrl(String(item.imageUrls?.[0] || ""));
            const image = isHttpUrl(imagePrimary) ? imagePrimary : imageFromList;
            return {
              item,
              image,
              score: scoreCandidate(item, normalizedName, normalizedAddress, region),
            };
          })
          .filter((it) => isHttpUrl(it.image))
          .sort((a, b) => b.score - a.score);

        const top = ranked[0];
        if (!top) continue;

        best = {
          image: top.image,
          width: 0,
          height: 0,
          foundFood: true,
          isHighResolution: true,
          source: "naver-map",
          item: top.item,
        };
        break;
      }

      if (!best) {
        return {
          image: "",
          width: 0,
          height: 0,
          foundFood: false,
          isHighResolution: false,
          source: "naver-map",
          item: null,
        };
      }
      return best;
    })();

    inFlight.set(cacheKey, worker);
    const payload = await worker;
    imageCache.set(cacheKey, { expiresAt: now + IMAGE_CACHE_TTL_MS, payload });
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return Response.json(
      {
        error: "unexpected server error",
        detail: String(err?.message ?? err),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  } finally {
    inFlight.delete(cacheKey);
  }
}
