/** Teslim, değerlendirme ve dosya depolama. Next.js'e bağımlı değildir. */
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DB } from "@/db";
import { evaluations, files, submissions, tickets } from "@/db/schema";
import { audit } from "@/lib/audit";
import { canManageArea, requireActor } from "@/lib/auth/guards";
import type { Actor } from "@/lib/contracts/actor";
import { AppError, forbidden, invalidState, notFound } from "@/lib/contracts/errors";
import {
  evaluateTicketSchema,
  isEvaluable,
  isSubmittable,
  submitTicketSchema,
  type FileRef,
} from "@/lib/contracts/tickets";
import { notify } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { resumeTimes } from "@/lib/ticket-time";
import {
  areaRecipients,
  areaNames,
  canViewTicket,
  cancelPendingRequest,
  lockTicket,
  postTicketMessage,
  ticketLink,
} from "./ticket-common";

export type UploadInput = { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

function uploadRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR || "./uploads");
}

/** Kök dizinin dışına çıkmayan mutlak yol; çıkıyorsa null. */
function safeResolve(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  return abs.startsWith(root + path.sep) ? abs : null;
}

function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
  const cleaned = base === "." || base === ".." ? "" : base;
  return (cleaned || "dosya").slice(0, 200);
}

export async function storeUpload(db: DB, actor: Actor | null, file: UploadInput, now: Date = new Date()): Promise<FileRef> {
  const a = requireActor(actor);
  const { uploadMaxMb } = await getSettings(db);
  if (file.size > uploadMaxMb * 1024 * 1024) throw new AppError("VALIDATION", `Dosya en fazla ${uploadMaxMb} MB olabilir.`);
  if (file.size <= 0) throw new AppError("VALIDATION", "Dosya boş olamaz.");

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength > uploadMaxMb * 1024 * 1024) throw new AppError("VALIDATION", `Dosya en fazla ${uploadMaxMb} MB olabilir.`);
  if (buf.byteLength === 0) throw new AppError("VALIDATION", "Dosya boş olamaz.");

  const root = uploadRoot();
  const rel = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}`;
  const abs = safeResolve(root, rel);
  if (!abs) throw new Error("Geçersiz depolama yolu.");
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buf);

  const name = cleanFileName(file.name);
  const mimeType = file.type || "application/octet-stream";
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(files)
        .values({ ownerId: a.id, storagePath: rel, originalName: name, mimeType, sizeBytes: buf.byteLength })
        .returning({ id: files.id });
      if (!row) throw new Error("Dosya kaydedilemedi.");
      await audit(tx, {
        actorId: a.id,
        action: "file.upload",
        entityType: "file",
        entityId: row.id,
        data: { name, mimeType, sizeBytes: buf.byteLength },
      });
      return { id: row.id, name, mimeType, sizeBytes: buf.byteLength };
    });
  } catch (e) {
    await unlink(abs).catch(() => undefined);
    throw e;
  }
}

export async function readFileForActor(
  db: DB,
  actor: Actor | null,
  fileId: string,
): Promise<{ absolutePath: string; name: string; mimeType: string; sizeBytes: number }> {
  const a = requireActor(actor);
  const [f] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!f) throw notFound("Dosya bulunamadı.");
  let allowed = f.ownerId === a.id;
  if (!allowed && f.submissionId) {
    const [t] = await db
      .select({ areaId: tickets.areaId, assigneeId: tickets.assigneeId })
      .from(submissions)
      .innerJoin(tickets, eq(tickets.id, submissions.ticketId))
      .where(eq(submissions.id, f.submissionId))
      .limit(1);
    allowed = !!t && canViewTicket(a, t);
  }
  if (!allowed) throw notFound("Dosya bulunamadı.");
  const absolutePath = safeResolve(uploadRoot(), f.storagePath);
  if (!absolutePath) throw notFound("Dosya bulunamadı.");
  return { absolutePath, name: f.originalName, mimeType: f.mimeType, sizeBytes: f.sizeBytes };
}

export async function submitTicket(db: DB, actor: Actor | null, raw: unknown, now: Date = new Date()): Promise<{ submissionId: string }> {
  const a = requireActor(actor);
  const input = submitTicketSchema.parse(raw);
  return db.transaction(async (tx) => {
    const t = await lockTicket(tx, input.ticketId);
    if (t.assigneeId !== a.id) throw forbidden("Bu ticket sende değil.");
    if (!isSubmittable(t.status)) {
      throw invalidState(
        t.status === "evaluated" ? "Değerlendirilmiş ticket'a yeniden teslim yapılamaz." : "Bu ticket şu an teslim edilemez.",
      );
    }
    const resubmit = t.status === "submitted";
    const settings = await getSettings(tx);

    const patch: Partial<typeof tickets.$inferInsert> = { status: "submitted", updatedAt: now };
    if (t.status === "extension_pending" || t.status === "withdrawal_pending") {
      const cancelled = await cancelPendingRequest(tx, t.id, now);
      if (cancelled) await postTicketMessage(tx, t, { authorId: null, body: "Teslim yapıldığı için bekleyen talep geri alındı." });
      Object.assign(patch, resumeTimes(t, now, settings.ticketWarnBeforeHours));
    }

    let fileIds: string[] = [];
    if (input.fileIds.length > 0) {
      const uniq = [...new Set(input.fileIds)];
      const rows = await tx
        .select({ id: files.id })
        .from(files)
        .where(
          and(inArray(files.id, uniq), eq(files.ownerId, a.id), isNull(files.submissionId), isNull(files.messageId)),
        )
        .for("update");
      if (rows.length !== uniq.length) {
        throw new AppError("VALIDATION", "Dosyalardan biri bulunamadı ya da başka yerde kullanılmış.");
      }
      fileIds = rows.map((r) => r.id);
    }

    const [sub] = await tx
      .insert(submissions)
      .values({ ticketId: t.id, userId: a.id, description: input.description, links: input.links, createdAt: now })
      .returning({ id: submissions.id });
    if (!sub) throw new Error("Teslim kaydedilemedi.");
    if (fileIds.length > 0) await tx.update(files).set({ submissionId: sub.id }).where(inArray(files.id, fileIds));

    await tx.update(tickets).set(patch).where(eq(tickets.id, t.id));
    await postTicketMessage(tx, t, { authorId: null, body: "Teslim edildi." });

    const recipients = await areaRecipients(tx, t.areaId, a.id);
    await notify(tx, {
      userIds: recipients,
      type: "ticket_submitted",
      title: "Yeni teslim geldi",
      body: `"${t.title}" teslim edildi, değerlendirmeni bekliyor.`,
      link: ticketLink(t.id),
    });
    await audit(tx, {
      actorId: a.id,
      action: "ticket.submit",
      entityType: "ticket",
      entityId: t.id,
      areaId: t.areaId,
      ticketId: t.id,
      data: { submissionId: sub.id, links: input.links.length, files: fileIds.length, resubmit },
    });
    return { submissionId: sub.id };
  });
}

export async function evaluateTicket(db: DB, actor: Actor | null, raw: unknown, now: Date = new Date()): Promise<void> {
  const a = requireActor(actor);
  const input = evaluateTicketSchema.parse(raw);
  await db.transaction(async (tx) => {
    const t = await lockTicket(tx, input.ticketId);
    if (!canManageArea(a, t.areaId)) throw forbidden("Bu ticket'ı değerlendirme yetkin yok.");
    if (t.assigneeId === a.id) throw forbidden("Kendi teslimini değerlendiremezsin.");
    if (!isEvaluable(t.status)) throw invalidState("Bu ticket şu an değerlendirilemez.");

    const [sub] = await tx
      .select({ id: submissions.id })
      .from(submissions)
      .where(eq(submissions.ticketId, t.id))
      .orderBy(desc(submissions.createdAt))
      .limit(1);

    const [prev] = await tx
      .select({ id: evaluations.id })
      .from(evaluations)
      .where(and(eq(evaluations.ticketId, t.id), eq(evaluations.evaluatorId, a.id)))
      .limit(1);

    await tx
      .insert(evaluations)
      .values({
        ticketId: t.id,
        evaluatorId: a.id,
        verdict: input.verdict,
        comment: input.comment || null,
        submissionId: sub?.id ?? null,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: [evaluations.ticketId, evaluations.evaluatorId],
        set: { verdict: input.verdict, comment: input.comment || null, submissionId: sub?.id ?? null, createdAt: now },
      });

    await tx.update(tickets).set({ status: "evaluated", updatedAt: now }).where(eq(tickets.id, t.id));

    const names = await areaNames(tx, [t.areaId]);
    await notify(tx, {
      userIds: [t.assigneeId],
      type: "ticket_evaluated",
      title: "Teslimin değerlendirildi",
      body: `"${t.title}" (${names.get(t.areaId) ?? "alan"}) değerlendirildi.`,
      link: ticketLink(t.id),
    });
    await audit(tx, {
      actorId: a.id,
      action: "ticket.evaluate",
      entityType: "ticket",
      entityId: t.id,
      areaId: t.areaId,
      ticketId: t.id,
      subjectUserId: t.assigneeId,
      data: { verdict: input.verdict, updated: !!prev },
    });
  });
}
