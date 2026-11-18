import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { evaluations, files, submissions, ticketRequests } from "../../src/db/schema";
import { evaluateTicket, readFileForActor, storeUpload, submitTicket } from "../../src/server/delivery";
import { createRequest } from "../../src/server/ticket-requests";
import { db, resetDb } from "../helpers/db";
import {
  H,
  SEC,
  at,
  expectValidation,
  makeMember,
  notifsOf,
  setSetting,
  setupCycle,
  takenTicket,
  ticketById,
  T0,
} from "../helpers/cycle";
import { expectCode } from "../helpers/errors";
import { auditRows } from "../helpers/plan";

let uploadDir: string;
const prevDir = process.env.UPLOAD_DIR;
beforeAll(() => {
  uploadDir = mkdtempSync(path.join(tmpdir(), "sector7-upl-"));
  process.env.UPLOAD_DIR = uploadDir;
});
afterAll(() => {
  rmSync(uploadDir, { recursive: true, force: true });
  if (prevDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = prevDir;
});
beforeEach(resetDb);

const upload = (bytes = 10, name = "rapor.txt") => ({
  name,
  type: "text/plain",
  size: bytes,
  arrayBuffer: async () => new Uint8Array(bytes).fill(65).buffer as ArrayBuffer,
});

async function setup() {
  const c = await setupCycle();
  const t = await takenTicket(c, c.areaA.id, c.member);
  return { c, t };
}
const sub = (ticketId: string, over: Record<string, unknown> = {}) => ({
  ticketId,
  description: "Yaptım ve bitirdim",
  links: [],
  fileIds: [],
  ...over,
});

describe("submitTicket", () => {
  it("assignee teslim eder: submitted, teslim kaydı, alan yöneticisine bildirim, denetim", async () => {
    const { c, t } = await setup();
    const { submissionId } = await submitTicket(db, c.member, sub(t.id, { links: ["https://example.com/x"] }), at(H));
    expect((await ticketById(t.id)).status).toBe("submitted");
    const rows = await db.select().from(submissions).where(eq(submissions.ticketId, t.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: submissionId, userId: c.member.id, links: ["https://example.com/x"] });
    expect(await notifsOf(c.mgrA.id, "ticket_submitted")).toHaveLength(1);
    expect(await notifsOf(c.mgrB.id, "ticket_submitted")).toHaveLength(0);
    expect(await auditRows("ticket.submit", t.id)).toHaveLength(1);
  });

  it("yalnız assignee teslim eder", async () => {
    const { c, t } = await setup();
    const other = await makeMember(c.home.id);
    await expectCode(submitTicket(db, other, sub(t.id), at(H)), "FORBIDDEN");
    await expectCode(submitTicket(db, c.mgrA, sub(t.id), at(H)), "FORBIDDEN");
    expect((await ticketById(t.id)).status).toBe("taken");
  });

  it("süre dolmuşken de teslim edilebilir", async () => {
    const { c, t } = await setup();
    await submitTicket(db, c.member, sub(t.id), at(200 * H));
    expect((await ticketById(t.id)).status).toBe("submitted");
  });

  it("bekleyen talep varken teslim: talep cancelled, pausedAt null", async () => {
    const { c, t } = await setup();
    const { id } = await createRequest(db, c.member, { ticketId: t.id, kind: "extension", reason: "Daha çok zaman lazım" }, at(10 * SEC));
    await submitTicket(db, c.member, sub(t.id), at(30 * SEC));
    const row = await ticketById(t.id);
    expect(row.status).toBe("submitted");
    expect(row.pausedAt).toBeNull();
    const [r] = await db.select().from(ticketRequests).where(eq(ticketRequests.id, id));
    expect(r!.status).toBe("cancelled");
  });

  it("bağlantı http/https değilse VALIDATION", async () => {
    const { c, t } = await setup();
    for (const bad of ["ftp://example.com/x", "javascript:alert(1)", "example.com", "not a url"]) {
      await expectValidation(submitTicket(db, c.member, sub(t.id, { links: [bad] }), at(H)));
    }
    expect((await ticketById(t.id)).status).toBe("taken");
    await submitTicket(db, c.member, sub(t.id, { links: ["http://example.com/a", "https://example.com/b"] }), at(H));
  });

  it("yeniden teslim (submitted iken) olur; evaluated sonrası INVALID_STATE", async () => {
    const { c, t } = await setup();
    await submitTicket(db, c.member, sub(t.id), at(H));
    await submitTicket(db, c.member, sub(t.id, { description: "İkinci teslim" }), at(2 * H));
    const rows = await db.select().from(submissions).where(eq(submissions.ticketId, t.id));
    expect(rows).toHaveLength(2);
    expect((await ticketById(t.id)).status).toBe("submitted");
    await evaluateTicket(db, c.mgrA, { ticketId: t.id, verdict: "good" }, at(3 * H));
    await expectCode(submitTicket(db, c.member, sub(t.id), at(4 * H)), "INVALID_STATE");
  });

  it("havuzdaki / teklif edilmiş ticket teslim edilemez", async () => {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.member, { status: "offered", offeredAt: T0 });
    await expectCode(submitTicket(db, c.member, sub(t.id), at(H)), "INVALID_STATE");
  });

  it("dosya: başkasının ya da kullanılmış dosyası VALIDATION; kendi dosyası bağlanır", async () => {
    const { c, t } = await setup();
    const other = await makeMember(c.home.id);
    const otherFile = await storeUpload(db, other, upload(), T0);
    await expectValidation(submitTicket(db, c.member, sub(t.id, { fileIds: [otherFile.id] }), at(H)));

    const mine = await storeUpload(db, c.member, upload(), T0);
    await submitTicket(db, c.member, sub(t.id, { fileIds: [mine.id] }), at(H));
    const [f] = await db.select().from(files).where(eq(files.id, mine.id));
    expect(f!.submissionId).not.toBeNull();

    // Aynı dosya tekrar kullanılamaz.
    await expectValidation(submitTicket(db, c.member, sub(t.id, { fileIds: [mine.id] }), at(2 * H)));
    // Var olmayan dosya.
    await expectValidation(
      submitTicket(db, c.member, sub(t.id, { fileIds: ["00000000-0000-4000-8000-000000000000"] }), at(2 * H)),
    );
  });
});

describe("storeUpload / readFileForActor", () => {
  it("dosya diske yazılır, files satırı ve denetim oluşur", async () => {
    const { c } = await setup();
    const ref = await storeUpload(db, c.member, upload(25, "a.txt"), at(H));
    expect(ref).toMatchObject({ name: "a.txt", sizeBytes: 25, mimeType: "text/plain" });
    const [f] = await db.select().from(files).where(eq(files.id, ref.id));
    expect(f).toMatchObject({ ownerId: c.member.id, submissionId: null });
    expect(existsSync(path.join(uploadDir, f!.storagePath))).toBe(true);
    expect(await auditRows("file.upload", ref.id)).toHaveLength(1);
  });

  it("boyut sınırı (uploadMaxMb = 1): aşan dosya VALIDATION, sınırdaki geçer", async () => {
    const { c } = await setup();
    await setSetting("uploadMaxMb", 1);
    await expectValidation(storeUpload(db, c.member, upload(1024 * 1024 + 1), T0));
    await expectValidation(storeUpload(db, c.member, upload(0), T0));
    const ok = await storeUpload(db, c.member, upload(1024 * 1024), T0);
    expect(ok.sizeBytes).toBe(1024 * 1024);
  });

  it("dosya adındaki yol parçaları temizlenir", async () => {
    const { c } = await setup();
    const ref = await storeUpload(db, c.member, upload(5, "../../etc/passwd"), T0);
    expect(ref.name).toBe("passwd");
  });

  it("sahibi, ticket'ı görebilen yönetici okur; ilgisiz üye ve başka alanın yöneticisi NOT_FOUND", async () => {
    const { c, t } = await setup();
    const ref = await storeUpload(db, c.member, upload(), T0);
    // Henüz teslime bağlı değil: yalnız sahibi.
    expect((await readFileForActor(db, c.member, ref.id)).name).toBe("rapor.txt");
    await expectCode(readFileForActor(db, c.mgrA, ref.id), "NOT_FOUND");

    await submitTicket(db, c.member, sub(t.id, { fileIds: [ref.id] }), at(H));
    const r = await readFileForActor(db, c.mgrA, ref.id);
    expect(r.absolutePath.startsWith(uploadDir)).toBe(true);
    expect((await readFileForActor(db, c.admin, ref.id)).sizeBytes).toBe(10);
    expect((await readFileForActor(db, c.member, ref.id)).mimeType).toBe("text/plain");

    const stranger = await makeMember(c.home.id);
    await expectCode(readFileForActor(db, stranger, ref.id), "NOT_FOUND");
    await expectCode(readFileForActor(db, c.mgrB, ref.id), "NOT_FOUND");
  });

  it("var olmayan dosya NOT_FOUND", async () => {
    const { c } = await setup();
    await expectCode(readFileForActor(db, c.member, "00000000-0000-4000-8000-000000000000"), "NOT_FOUND");
  });
});

describe("evaluateTicket", () => {
  async function submitted() {
    const { c, t } = await setup();
    await submitTicket(db, c.member, sub(t.id), at(H));
    return { c, t };
  }

  it("alan yöneticisi değerlendirir: evaluated, kayıt, assignee'ye bildirim, denetim", async () => {
    const { c, t } = await submitted();
    await evaluateTicket(db, c.mgrA, { ticketId: t.id, verdict: "good", comment: "Güzel" }, at(2 * H));
    expect((await ticketById(t.id)).status).toBe("evaluated");
    const rows = await db.select().from(evaluations).where(eq(evaluations.ticketId, t.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ evaluatorId: c.mgrA.id, verdict: "good", comment: "Güzel" });
    expect(rows[0]!.submissionId).not.toBeNull();
    expect(await notifsOf(c.member.id, "ticket_evaluated")).toHaveLength(1);
    expect(await auditRows("ticket.evaluate", t.id)).toHaveLength(1);
  });

  it("ana yönetici de değerlendirebilir", async () => {
    const { c, t } = await submitted();
    await evaluateTicket(db, c.admin, { ticketId: t.id, verdict: "bad" }, at(2 * H));
    expect((await ticketById(t.id)).status).toBe("evaluated");
  });

  it("başka alanın yöneticisi ve üye FORBIDDEN", async () => {
    const { c, t } = await submitted();
    await expectCode(evaluateTicket(db, c.mgrB, { ticketId: t.id, verdict: "good" }, at(2 * H)), "FORBIDDEN");
    const other = await makeMember(c.home.id);
    await expectCode(evaluateTicket(db, other, { ticketId: t.id, verdict: "good" }, at(2 * H)), "FORBIDDEN");
    await expectCode(evaluateTicket(db, c.member, { ticketId: t.id, verdict: "good" }, at(2 * H)), "FORBIDDEN");
    expect((await ticketById(t.id)).status).toBe("submitted");
  });

  it("assignee (ana yönetici bile olsa) kendini değerlendiremez", async () => {
    const c = await setupCycle();
    const t = await takenTicket(c, c.areaA.id, c.admin);
    await submitTicket(db, c.admin, sub(t.id), at(H));
    await expectCode(evaluateTicket(db, c.admin, { ticketId: t.id, verdict: "good" }, at(2 * H)), "FORBIDDEN");
    // Başkası değerlendirebilir.
    await evaluateTicket(db, c.mgrA, { ticketId: t.id, verdict: "good" }, at(2 * H));
  });

  it("submitted değilken INVALID_STATE", async () => {
    const { c, t } = await setup();
    await expectCode(evaluateTicket(db, c.mgrA, { ticketId: t.id, verdict: "good" }, at(2 * H)), "INVALID_STATE");
  });

  it("aynı değerlendirici ikinci kez: güncelleme (tek satır), ticket evaluated", async () => {
    const { c, t } = await submitted();
    await evaluateTicket(db, c.mgrA, { ticketId: t.id, verdict: "good", comment: "İlk" }, at(2 * H));
    await evaluateTicket(db, c.mgrA, { ticketId: t.id, verdict: "bad", comment: "Düzeltme" }, at(3 * H));
    const rows = await db.select().from(evaluations).where(eq(evaluations.ticketId, t.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verdict: "bad", comment: "Düzeltme" });
    expect((await ticketById(t.id)).status).toBe("evaluated");
  });

  it("farklı değerlendiriciler ayrı satır yazar", async () => {
    const { c, t } = await submitted();
    await evaluateTicket(db, c.mgrA, { ticketId: t.id, verdict: "good" }, at(2 * H));
    await evaluateTicket(db, c.admin, { ticketId: t.id, verdict: "bad" }, at(3 * H));
    expect(await db.select().from(evaluations).where(eq(evaluations.ticketId, t.id))).toHaveLength(2);
  });
});
