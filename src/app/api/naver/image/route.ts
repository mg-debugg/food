export const runtime = "nodejs";

const ALLOWED_REGIONS = ["수원", "대구", "여수", "광명"] as const;
type Region = (typeof ALLOWED_REGIONS)[number];

function stripHtmlTags(s: string): string {
  if (!s) return "";
  return s.replace(/<[^>]*>/g, "");
}

function toInt(input: unknown): number {
  const n = Number.parseInt(String(input ?? ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function isHttpUrl(s: string): boolean {
  return s.startsWith("http://") || s.startsWith("https://");
}

const FOOD_KEYWORDS = [
  "음식",
  "요리",
  "맛집",
  "메뉴",
  "식당",
  "한식",
  "중식",
  "일식",
  "양식",
  "디저트",
  "카페",
];

const NON_FOOD_KEYWORDS = [
  "간판",
  "외관",
  "내부",
  "인테리어",
  "지도",
  "로고",
  "명함",
  "주차장",
  "전단지",
];

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((k) => text.includes(k));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const query = (sp.get("query") ?? "").trim();
  const regionRaw = (sp.get("region") ?? "수원").trim();
  const region: Region = ALLOWED_REGIONS.includes(regionRaw as Region)
    ? (regionRaw as Region)
    : "수원";

  if (!query) {
    return Response.json(
      { error: "query parameter is required" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
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

  const finalQuery = `${region} ${query} 대표메뉴 음식`;
  const endpoint = `https://openapi.naver.com/v1/search/image.json?query=${encodeURIComponent(
    finalQuery,
  )}&display=20&start=1&sort=sim`;

  try {
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return Response.json(
        { error: "naver api error", status: res.status, detail },
        { status: res.status, headers: { "Cache-Control": "no-store" } },
      );
    }

    const json = (await res.json()) as any;
    const items = Array.isArray(json?.items) ? json.items : [];
    const normalized = items
      .map((it: any) => ({
        ...it,
        title: stripHtmlTags(String(it?.title ?? "")),
        width: toInt(it?.sizewidth),
        height: toInt(it?.sizeheight),
        thumbnail: String(it?.thumbnail ?? ""),
        link: String(it?.link ?? ""),
      }))
      .filter((it: any) => {
        const link = String(it?.link || it?.thumbnail || "");
        return link.startsWith("http://") || link.startsWith("https://");
      });

    const ranked = normalized
      .map((it: any) => {
        const text = `${it.title} ${it.link}`.toLowerCase();
        const hasFoodHint = containsAny(text, FOOD_KEYWORDS);
        const hasNonFoodHint = containsAny(text, NON_FOOD_KEYWORDS);
        const sourceUrl = isHttpUrl(it.link) ? it.link : it.thumbnail;
        const area = Math.max(0, it.width) * Math.max(0, it.height);
        const qualityScore = area > 0 ? Math.log10(area) : 0;
        const score =
          qualityScore +
          (isHttpUrl(it.link) ? 1 : 0) +
          (hasFoodHint ? 2 : 0) -
          (hasNonFoodHint ? 3 : 0);
        return {
          ...it,
          sourceUrl,
          hasFoodHint,
          hasNonFoodHint,
          area,
          score,
        };
      })
      .filter((it: any) => isHttpUrl(it.sourceUrl))
      .sort((a: any, b: any) => b.score - a.score || b.area - a.area);

    const first = ranked[0] ?? null;
    const image = first ? String(first.sourceUrl || "") : "";
    const isHighResolution = first ? first.width >= 640 && first.height >= 640 : false;
    const foundFood = first ? first.hasFoodHint && !first.hasNonFoodHint : false;

    return Response.json(
      {
        image,
        foundFood,
        isHighResolution,
        width: first?.width ?? 0,
        height: first?.height ?? 0,
        item: first ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: any) {
    return Response.json(
      { error: "unexpected server error", detail: String(err?.message ?? err) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
