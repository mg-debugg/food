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
  )}&display=5&start=1&sort=sim`;

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
      }))
      .filter((it: any) => {
        const link = String(it?.thumbnail || it?.link || "");
        return link.startsWith("http://") || link.startsWith("https://");
      });

    const first = normalized[0];
    const image = first ? String(first.thumbnail || first.link || "") : "";
    return Response.json(
      { image, item: first ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err: any) {
    return Response.json(
      { error: "unexpected server error", detail: String(err?.message ?? err) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
