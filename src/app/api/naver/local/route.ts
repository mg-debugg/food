export const runtime = "nodejs";

const ALLOWED_REGIONS = ["수원", "대구", "여수", "광명"] as const;
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

  const wantedDisplay = 10;
  const start = clampInt(sp.get("start") ?? "1", 1, 1000, 1);
  const sortRaw = (sp.get("sort") ?? "random").toLowerCase();
  const sort = sortRaw === "comment" ? "comment" : "random";
  const pageSize = 5;

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
    const seen = new Set<string>();
    const normalizedItems: any[] = [];
    let firstResponse: any = null;
    let pageStart = start;

    for (let attempt = 0; attempt < 20 && normalizedItems.length < wantedDisplay; attempt += 1) {
      const page = await fetchPage(pageSize, pageStart, sort);
      if (!firstResponse) firstResponse = page;
      const items = Array.isArray(page?.items) ? page.items : [];

      for (const raw of items) {
        const it = {
          ...raw,
          title: stripHtmlTags(String(raw?.title ?? "")),
        };
        const key = `${it.title}|${it.roadAddress || it.address || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        normalizedItems.push(it);
        if (normalizedItems.length >= wantedDisplay) break;
      }

      pageStart += pageSize;
    }

    // Fallback pass: when random/page dedupe leaves fewer than 10, try comment sort.
    if (normalizedItems.length < wantedDisplay && sort !== "comment") {
      let fallbackStart = start;
      for (let attempt = 0; attempt < 20 && normalizedItems.length < wantedDisplay; attempt += 1) {
        const page = await fetchPage(pageSize, fallbackStart, "comment");
        if (!firstResponse) firstResponse = page;
        const items = Array.isArray(page?.items) ? page.items : [];

        for (const raw of items) {
          const it = {
            ...raw,
            title: stripHtmlTags(String(raw?.title ?? "")),
          };
          const key = `${it.title}|${it.roadAddress || it.address || ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          normalizedItems.push(it);
          if (normalizedItems.length >= wantedDisplay) break;
        }

        fallbackStart += pageSize;
      }
    }

    const json = { ...(firstResponse ?? {}), items: normalizedItems.slice(0, wantedDisplay) };

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
