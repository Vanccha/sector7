/** Üyelik başvurusu → onay akışı. Next.js'e bağımlı değildir. */
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { applications, areas } from "@/db/schema";
import { audit } from "@/lib/audit";
import { requireMainAdmin } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import {
  applicationInputSchema,
  approveApplicationSchema,
  rejectApplicationSchema,
  type ApplicationInput,
} from "@/lib/contracts/applications";
import { conflict, invalidState, notFound } from "@/lib/contracts/errors";
import { createUser, findAccountConflicts, issuePasswordToken } from "./accounts";

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

/** Dışarıdan başvuru (oturum gerekmez). */
export async function submitApplication(db: DB, raw: ApplicationInput): Promise<{ id: string }> {
  const input = applicationInputSchema.parse(raw);
  const conflicts = await findAccountConflicts(db, input.username, input.email);
  if (conflicts.username) throw conflict("Bu kullanıcı adı kullanımda.", { username: conflicts.username });
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(applications).values(input).returning({ id: applications.id });
      if (!row) throw new Error("Başvuru kaydedilemedi.");
      await audit(tx, {
        actorId: null,
        action: "application.submit",
        entityType: "application",
        entityId: row.id,
        data: { username: input.username },
      });
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw conflict("Bu kullanıcı adıyla bekleyen bir başvuru var.", {
        username: "Bu kullanıcı adıyla bekleyen bir başvuru var.",
      });
    }
    throw e;
  }
}

export type ApplicationRow = typeof applications.$inferSelect;

/**
 * Başvuruları listeler (yalnız ana yönetici). Kişisel veri (e-posta, telefon) içerdiği için
 * görüntüleme denetim kaydına düşer.
 */
export async function listApplications(
  db: DB,
  actor: Actor | null,
  status: "pending" | "approved" | "rejected" = "pending",
): Promise<ApplicationRow[]> {
  const a = requireMainAdmin(actor);
  const rows = await db
    .select()
    .from(applications)
    .where(eq(applications.status, status))
    .orderBy(status === "pending" ? asc(applications.createdAt) : desc(applications.reviewedAt));
  if (rows.length) {
    await audit(db, {
      actorId: a.id,
      action: "personal_data.view",
      entityType: "application",
      data: { status, applicationIds: rows.map((r) => r.id) },
    });
  }
  return rows;
}

/**
 * Başvuruyu onaylar: hesap açılır, ana alan atanır, tek kullanımlık şifre bağlantısı üretilir.
 * Bağlantı yalnız bu yanıtta döner (lokalde ekranda gösterilir).
 */
export async function approveApplication(
  db: DB,
  actor: Actor | null,
  raw: { applicationId: string; homeAreaId: string },
): Promise<{ userId: string; setupUrl: string; expiresAt: Date }> {
  const a = requireMainAdmin(actor);
  const input = approveApplicationSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [app] = await tx
      .select()
      .from(applications)
      .where(eq(applications.id, input.applicationId))
      .for("update")
      .limit(1);
    if (!app) throw notFound("Başvuru bulunamadı.");
    if (app.status !== "pending") throw invalidState("Bu başvuru zaten sonuçlanmış.");

    const [area] = await tx
      .select({ id: areas.id })
      .from(areas)
      .where(and(eq(areas.id, input.homeAreaId), isNull(areas.archivedAt)))
      .limit(1);
    if (!area) throw invalidState("Seçilen alan bulunamadı ya da arşivlenmiş.");

    const userId = await createUser(tx, {
      name: app.fullName,
      username: app.username,
      email: app.email,
      phone: app.phone,
      homeAreaId: area.id,
    });
    const now = new Date();
    await tx
      .update(applications)
      .set({ status: "approved", reviewedById: a.id, reviewedAt: now, createdUserId: userId })
      .where(eq(applications.id, app.id));
    const link = await issuePasswordToken(tx, userId, "setup", a.id, now);
    await audit(tx, {
      actorId: a.id,
      action: "application.approve",
      entityType: "application",
      entityId: app.id,
      areaId: area.id,
      subjectUserId: userId,
    });
    return { userId, setupUrl: link.url, expiresAt: link.expiresAt };
  });
}

/** Başvuruyu reddeder; kayıt silinmez. */
export async function rejectApplication(
  db: DB,
  actor: Actor | null,
  raw: { applicationId: string; note?: string },
): Promise<void> {
  const a = requireMainAdmin(actor);
  const input = rejectApplicationSchema.parse(raw);
  await db.transaction(async (tx) => {
    const [app] = await tx
      .select({ id: applications.id, status: applications.status })
      .from(applications)
      .where(eq(applications.id, input.applicationId))
      .for("update")
      .limit(1);
    if (!app) throw notFound("Başvuru bulunamadı.");
    if (app.status !== "pending") throw invalidState("Bu başvuru zaten sonuçlanmış.");
    await tx
      .update(applications)
      .set({ status: "rejected", reviewedById: a.id, reviewedAt: new Date(), reviewNote: input.note ?? null })
      .where(eq(applications.id, app.id));
    await audit(tx, {
      actorId: a.id,
      action: "application.reject",
      entityType: "application",
      entityId: app.id,
      data: input.note ? { note: input.note } : {},
    });
  });
}

/** Onay formunda seçilebilecek aktif alanlar. */
export async function listActiveAreas(db: DB) {
  return db
    .select({ id: areas.id, name: areas.name })
    .from(areas)
    .where(isNull(areas.archivedAt))
    .orderBy(asc(areas.name));
}
