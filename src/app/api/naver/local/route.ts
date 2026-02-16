export const runtime = "nodejs";

const ALLOWED_REGIONS = ["수원", "여수", "대구"] as const;
type Region = (typeof ALLOWED_REGIONS)[number];

function stripHtmlTags(s: string): string {
  if (!s) return "";
  return s.replace(/<[^>]*>/g, "");
}

function clampInt(input: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(input, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const query = (sp.get("query") ?? "").trim();
  const regionRaw = (sp.get("region") ?? "수원").trim();
  const region: Region = ALLOWED_REGIONS.includes(regionRaw as Region)
    ? (regionRaw as Region)
    : "수원";

  const wantedDisplay = clampInt(sp.get("display") ?? "10", 1, 10, 10);
  const start = clampInt(sp.get("start") ?? "1", 1, 1000, 1);
  const sortRaw = (sp.get("sort") ?? "random").toLowerCase();
  const sort = sortRaw === "comment" ? "comment" : "random";

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

  const finalQuery = `${region} ${query}`;
  const headers = {
    "X-Naver-Client-Id": clientId,
    "X-Naver-Client-Secret": clientSecret,
  };

  async function fetchPage(display: number, pageStart: number) {
    const endpoint = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(
      finalQuery,
    )}&display=${encodeURIComponent(String(display))}&start=${encodeURIComponent(
      String(pageStart),
    )}&sort=${encodeURIComponent(sort)}`;
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
    const firstDisplay = Math.min(5, wantedDisplay);
    const first = await fetchPage(firstDisplay, start);

    let mergedItems = Array.isArray(first?.items) ? first.items : [];
    if (wantedDisplay > 5) {
      const secondDisplay = wantedDisplay - firstDisplay;
      const secondStart = start + firstDisplay;
      const second = await fetchPage(secondDisplay, secondStart);
      const secondItems = Array.isArray(second?.items) ? second.items : [];
      mergedItems = [...mergedItems, ...secondItems];
    }

    const seen = new Set<string>();
    const normalizedItems = mergedItems
      .map((it: any) => ({
        ...it,
        title: stripHtmlTags(String(it?.title ?? "")),
      }))
      .filter((it: any) => {
        const key = `${it.title}|${it.roadAddress || it.address || ""}|${it.mapx || ""}|${it.mapy || ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, wantedDisplay);

    const json = { ...first, items: normalizedItems };

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
