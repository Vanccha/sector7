import { db } from "@/db";
import { getActor } from "@/lib/auth/session";
import { AppError } from "@/lib/contracts/errors";
import { auditLogCsv } from "@/server/audit-log";
import { parseAuditSearchParams } from "@/app/(app)/yonetim/denetim/search";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "Bu işlem için giriş yapmalısın." }, { status: 401 });
  if (!actor.isMainAdmin) return Response.json({ error: "Bu işlem için yetkin yok." }, { status: 403 });
  try {
    const filter = parseAuditSearchParams(new URL(request.url).searchParams);
    const csv = await auditLogCsv(db, actor, filter);
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" })
      .format(new Date())
      .replaceAll("-", "");
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="denetim-${d}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AppError) {
      const status = e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : 400;
      return Response.json({ error: e.message }, { status });
    }
    console.error(e);
    return Response.json({ error: "Kayıtlar hazırlanırken beklenmeyen bir sorun oluştu." }, { status: 500 });
  }
}
