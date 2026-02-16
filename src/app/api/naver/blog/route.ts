export const runtime = "nodejs";

const ALLOWED_REGIONS = ["수원", "대구", "여수", "광명"] as const;
type Region = (typeof ALLOWED_REGIONS)[number];

function stripHtmlTags(s: string): string {
  if (!s) return "";
  return s.replace(/<[^>]*>/g, "");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const query = (sp.get("query") ?? "").trim();
  const regionRaw = (sp.get("region") ?? "수원").trim();
  const region: Region = ALLOWED_REGIONS.includes(regionRaw as Region)
    ? (regionRaw as Region)
    : "수원";

  const display = sp.get("display") ?? "3";
  const start = sp.get("start") ?? "1";
  const sort = "date";

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

  const finalQuery = `${region} ${query} 지역맛집`;
  const endpoint = `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(
    finalQuery,
  )}&display=${encodeURIComponent(display)}&start=${encodeURIComponent(
    start,
  )}&sort=${encodeURIComponent(sort)}`;

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
      .map((it: any) => {
        const title = stripHtmlTags(String(it?.title ?? ""));
        const description = stripHtmlTags(String(it?.description ?? ""));
        return { ...it, title, description };
      })
      .filter(
        (it: any) =>
          String(it.title).includes("맛집") || String(it.description).includes("맛집"),
      )
      .slice(0, 3);

    return Response.json(
      { ...json, items: normalized },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: any) {
    return Response.json(
      { error: "unexpected server error", detail: String(err?.message ?? err) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
