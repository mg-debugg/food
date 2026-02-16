export const runtime = "nodejs";

function stripHtmlTags(s: string): string {
  if (!s) return "";
  return s.replace(/<[^>]*>/g, "");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const query = (sp.get("query") ?? "").trim();
  const display = sp.get("display") ?? "20";
  const start = sp.get("start") ?? "1";
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

  const finalQuery = `수원 ${query}`;
  const endpoint = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(
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
    if (Array.isArray(json?.items)) {
      json.items = json.items.map((it: any) => ({
        ...it,
        title: stripHtmlTags(String(it?.title ?? "")),
      }));
    }

    return Response.json(json, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return Response.json(
      { error: "unexpected server error", detail: String(err?.message ?? err) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

