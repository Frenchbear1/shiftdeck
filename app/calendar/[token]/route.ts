import { env } from "cloudflare:workers";

function getToken(request: Request) {
  const segment = new URL(request.url).pathname.split("/").pop() ?? "";
  const token = segment.replace(/\.ics$/i, "");
  return /^[a-f0-9]{48}$/i.test(token) ? token.toLowerCase() : "";
}

export async function GET(request: Request) {
  const token = getToken(request);

  if (!token || !env.DB) {
    return new Response("Calendar feed not found.", { status: 404 });
  }

  const row = await env.DB
    .prepare("SELECT calendar_name, ics, updated_at FROM calendar_feeds WHERE token = ?")
    .bind(token)
    .first<{ calendar_name: string; ics: string; updated_at: string }>();

  if (!row) {
    return new Response("Calendar feed not found.", { status: 404 });
  }

  return new Response(row.ics, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Disposition": `inline; filename="${row.calendar_name.replace(/[^a-z0-9-]+/gi, "-") || "shiftdeck"}.ics"`,
      "Content-Type": "text/calendar; charset=utf-8",
      ETag: `"${token}-${Date.parse(row.updated_at) || Date.now()}"`,
    },
  });
}
