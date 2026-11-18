/**
 * Lokal DEMO verisi: lokal deneme hesapları, üretimde çalışmaz.
 *   npm run db:demo
 *
 * Aşama 1-5 akışlarını gerçekçi veriyle görmek için "demo" önekli yeni kayıtlar açar
 * (kişiler, alanlar, hedefler, roadmap'ler, ticket'lar, teklif/teslim/değerlendirme, mesajlar, başvuru).
 * Mevcut verilere dokunmaz; `demo.admin` varsa hiçbir şey yapmaz.
 * Şifre: DEMO_PASSWORD ortam değişkeni, yoksa lokal varsayılan (README).
 * Servisler `now` parametresiyle geçmiş zamana kaydırılır; servisin kendi "şimdi" ile yazdığı
 * kayıtlar (mesaj, bildirim, denetim, talep) her adımdan sonra o adımın zamanına çekilir.
 */
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { createDb } from "../src/db/index";
import { sprints, ticketRejections, tickets, user } from "../src/db/schema";
import { audit } from "../src/lib/audit";
import { loadActor } from "../src/lib/auth/guards";
import type { Actor } from "../src/lib/contracts/actor";
import { localDateString } from "../src/lib/sprint";
import { getSettings } from "../src/lib/settings";
import { addHours, addMinutes } from "../src/lib/ticket-time";
import { createUser, setCredentialPassword } from "../src/server/accounts";
import { submitApplication } from "../src/server/applications";
import { createArea, setAreaManager } from "../src/server/areas";
import { getAnnouncementChannel, getAreaChannel } from "../src/server/channel-access";
import { addDependency, takeableCondition } from "../src/server/dependencies";
import { evaluateTicket, storeUpload, submitTicket } from "../src/server/delivery";
import { getTicketChannelId, markChannelRead, sendMessage } from "../src/server/messaging";
import { addStep, approveRoadmap, createGoal, submitRoadmap } from "../src/server/plan";
import { acceptOffer, rejectOffer, requestTicket } from "../src/server/pool";
import { runScheduledTick } from "../src/server/scheduler";
import { rejectionQuota } from "../src/server/ticket-common";
import { createSprint, startSprint } from "../src/server/sprints";
import { createRequest, postRequestMessage } from "../src/server/ticket-requests";
import { publishTickets, createTicket } from "../src/server/tickets";

if (process.env.NODE_ENV === "production") {
  console.error("Demo verisi üretimde çalıştırılamaz (NODE_ENV=production).");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL tanımlı değil.");
  process.exit(1);
}

const PASSWORD = process.env.DEMO_PASSWORD || "demo12345";
const HOUR = 3_600_000;
const T = new Date();
const ago = (h: number) => new Date(T.getTime() - h * HOUR);

const { db, pool } = createDb(url);

/** Servisin kendi "şimdi"siyle yazdığı satırları (betik başlangıcından sonra oluşanlar) `at` anına çeker. */
const STAMP_TABLES = [
  "messages",
  "notifications",
  "audit_log",
  "ticket_requests",
  "tickets",
  "goals",
  "roadmaps",
  "roadmap_steps",
  "ticket_dependencies",
  "ticket_rejections",
  "files",
];
async function stamp(at: Date): Promise<void> {
  for (const t of STAMP_TABLES) {
    await db.execute(
      sql.raw(`update ${t} set created_at = '${at.toISOString()}' where created_at >= '${T.toISOString()}'`),
    );
  }
}

const must = <V>(v: V | null | undefined, what: string): V => {
  if (v === null || v === undefined) throw new Error(`${what} bulunamadı.`);
  return v;
};
const actorOf = async (id: string) => must(await loadActor(db, id), "Kullanıcı");

type AreaPlanDef = {
  name: string;
  description: string;
  goals: { title: string; requirements: string }[];
  steps: { title: string; goal: number }[];
  tickets: string[];
};

/** Her alanda 9 ticket: [0→1→2] zinciri, paralel olanlar, sonuncusu taslak. */
const LAYOUT: { step: number; dep?: number; draft?: boolean }[] = [
  { step: 0 },
  { step: 1, dep: 0 },
  { step: 1, dep: 1 },
  { step: 2 },
  { step: 2 },
  { step: 3 },
  { step: 3 },
  { step: 4 },
  { step: 0, draft: true },
];

const AREA_DEFS: AreaPlanDef[] = [
  {
    name: "Demo · Web",
    description: "Kurumsal site ve web arayüzü (demo).",
    goals: [
      { title: "Kurumsal sitenin yeni arayüzü yayında", requirements: "Ana sayfa, giriş ve şifre akışları tasarım sistemine geçmiş olmalı." },
      { title: "Sitenin hızı ve erişilebilirliği ölçülmüş", requirements: "Lighthouse puanı 90 üzeri; klavye ile gezinme sorunsuz." },
    ],
    steps: [
      { title: "Tasarım sistemi kurulumu", goal: 0 },
      { title: "Ana sayfa bileşenleri", goal: 0 },
      { title: "Giriş ve şifre akışı", goal: 0 },
      { title: "Performans ölçümü", goal: 1 },
      { title: "Erişilebilirlik denetimi", goal: 1 },
    ],
    tickets: [
      "Renk ve tipografi tokenlarını yaz",
      "Düğme ve form bileşenlerini kodla",
      "Ana sayfa hero bölümünü bitir",
      "Giriş formunu doğrulamalarıyla yaz",
      "Şifre sıfırlama sayfasını kur",
      "Lighthouse raporunu çıkar",
      "Görselleri sıkıştırıp tembel yükle",
      "Klavye ile gezinmeyi test et",
      "Koyu tema için renk planı çıkar",
    ],
  },
  {
    name: "Demo · Mobil",
    description: "Mobil uygulama geliştirme (demo).",
    goals: [
      { title: "Mobil uygulamanın ilk sürümü mağazaya hazır", requirements: "Giriş, profil ve bildirimler çalışır; mağaza materyalleri tamam." },
      { title: "Çevrimdışı çalışma desteği", requirements: "Bağlantı yokken son veriler görünür, eşitleme çakışmaları ele alınır." },
    ],
    steps: [
      { title: "Proje iskeleti", goal: 0 },
      { title: "Profil ve giriş ekranları", goal: 0 },
      { title: "Bildirim altyapısı", goal: 0 },
      { title: "Çevrimdışı önbellek", goal: 1 },
      { title: "Mağaza hazırlığı", goal: 0 },
    ],
    tickets: [
      "Gezinme yapısını kur",
      "Giriş ekranını tasarıma uydur",
      "Profil ekranını bitir",
      "Anlık bildirim izinlerini yaz",
      "Bildirim ayarları ekranını kodla",
      "Çevrimdışı önbellek şemasını çıkar",
      "Eşitleme çakışmalarını ele al",
      "Mağaza ekran görüntülerini hazırla",
      "Uygulama simgesi varyantlarını dene",
    ],
  },
  {
    name: "Demo · Tasarım",
    description: "Marka ve arayüz tasarımı (demo).",
    goals: [
      { title: "Marka rehberi tamamlanmış", requirements: "Logo, renk, tipografi ve ikon kuralları tek rehberde." },
      { title: "Web ve mobil arayüz kitleri hazır", requirements: "Bileşenler Figma'da, karanlık tema dahil." },
    ],
    steps: [
      { title: "Logo ve renk paleti", goal: 0 },
      { title: "Tipografi ve ikon seti", goal: 0 },
      { title: "Web arayüz kiti", goal: 1 },
      { title: "Mobil arayüz kiti", goal: 1 },
      { title: "Kullanılabilirlik testi", goal: 1 },
    ],
    tickets: [
      "Logo varyantlarını çiz",
      "Yazı tipi eşleşmelerini seç",
      "İkon setini 24px ızgarada çiz",
      "Web bileşen kitini Figma'da kur",
      "Boş durum ve hata ekranlarını çiz",
      "Mobil bileşen kitini hazırla",
      "Karanlık tema ekranlarını çiz",
      "Beş kişilik kullanılabilirlik testi yap",
      "Marka rehberi PDF'ini derle",
    ],
  },
];

async function main(): Promise<void> {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.username, "demo.admin")).limit(1);
  if (existing) {
    console.log("Demo verisi zaten var (demo.admin mevcut); bir şey yapılmadı.");
    return;
  }

  const summary: Record<string, number | string> = {};
  const skipped: string[] = [];

  /* ------------------------------ Kişiler, alanlar ------------------------------ */
  const adminId = await createUser(db, {
    name: "Ayşe Demir",
    username: "demo.admin",
    email: "demo.admin@example.com",
    isMainAdmin: true,
  });
  await db.update(user).set({ canAnnounce: true }).where(eq(user.id, adminId));
  await setCredentialPassword(db, adminId, PASSWORD, { allowWeak: true });
  await audit(db, {
    actorId: null,
    action: "user.create_main_admin",
    entityType: "user",
    entityId: adminId,
    subjectUserId: adminId,
    data: { via: "demo-seed" },
  });
  const admin = await actorOf(adminId);

  const areaIds: string[] = [];
  for (const def of AREA_DEFS) {
    const { id } = await createArea(db, admin, { name: def.name, description: def.description });
    areaIds.push(id);
  }
  const [webId, mobilId, tasarimId] = areaIds as [string, string, string];

  const people: { username: string; name: string; home: string }[] = [
    { username: "demo.yonetici1", name: "Mert Yılmaz", home: webId },
    { username: "demo.yonetici2", name: "Elif Şahin", home: mobilId },
    { username: "demo.yonetici3", name: "Can Öztürk", home: tasarimId },
    { username: "demo.uye1", name: "Zeynep Arslan", home: webId },
    { username: "demo.uye2", name: "Burak Çelik", home: webId },
    { username: "demo.uye3", name: "Selin Aydın", home: mobilId },
    { username: "demo.uye4", name: "Emre Koç", home: mobilId },
    { username: "demo.uye5", name: "Deniz Polat", home: tasarimId },
    { username: "demo.uye6", name: "Ceren Kurt", home: tasarimId },
    { username: "demo.pasif", name: "Kaan Yıldız", home: webId },
  ];
  const ids = new Map<string, string>();
  for (const p of people) {
    const id = await createUser(db, {
      name: p.name,
      username: p.username,
      email: `${p.username}@example.com`,
      homeAreaId: p.home,
    });
    await setCredentialPassword(db, id, PASSWORD, { allowWeak: true });
    ids.set(p.username, id);
  }
  const idOf = (u: string) => must(ids.get(u), u);
  for (const [i, areaId] of areaIds.entries()) {
    await setAreaManager(db, admin, { areaId, managerId: idOf(`demo.yonetici${i + 1}`) });
  }
  const mgrs = [await actorOf(idOf("demo.yonetici1")), await actorOf(idOf("demo.yonetici2")), await actorOf(idOf("demo.yonetici3"))] as const;
  const mgrByArea = new Map<string, Actor>(areaIds.map((a, i) => [a, mgrs[i] as Actor]));
  const mgrOfArea = (areaId: string) => must(mgrByArea.get(areaId), "Alan yöneticisi");
  const members: Record<string, Actor> = {};
  for (const k of ["uye1", "uye2", "uye3", "uye4", "uye5", "uye6", "pasif"]) members[k] = await actorOf(idOf(`demo.${k}`));
  const m = (k: string) => must(members[k], k);
  await stamp(ago(9 * 24));

  /* ------------------------------ Sprintler ------------------------------ */
  let [active] = await db.select().from(sprints).where(eq(sprints.status, "active")).limit(1);
  let sprintNote = "mevcut aktif sprint kullanıldı";
  if (!active) {
    const { id } = await createSprint(db, admin, { startDate: localDateString(ago(8 * 24)), lengthDays: 21 });
    await startSprint(db, admin, { sprintId: id });
    [active] = await db.select().from(sprints).where(eq(sprints.id, id)).limit(1);
    sprintNote = "yeni sprint açılıp başlatıldı";
  }
  const sprint = must(active, "Aktif sprint");
  let [planned] = await db.select().from(sprints).where(eq(sprints.status, "planned")).limit(1);
  if (!planned) {
    const [y, mo, d] = sprint.startDate.split("-").map(Number);
    const next = new Date(Date.UTC(y ?? 1970, (mo ?? 1) - 1, (d ?? 1) + sprint.lengthDays));
    const { id } = await createSprint(db, admin, { startDate: next.toISOString().slice(0, 10), lengthDays: sprint.lengthDays });
    [planned] = await db.select().from(sprints).where(eq(sprints.id, id)).limit(1);
  }
  const nextSprint = must(planned, "Planlanan sprint");
  summary["Aktif sprint"] = `${sprint.name} (${sprintNote})`;
  summary["Sonraki sprint"] = nextSprint.name;

  /* ------------------------------ Plan: hedef, roadmap, ticket ------------------------------ */
  const ticketIds: string[][] = [];
  for (const [ai, def] of AREA_DEFS.entries()) {
    const areaId = areaIds[ai] as string;
    const mgr = mgrs[ai] as Actor;
    const goalIds: string[] = [];
    for (const g of def.goals) {
      goalIds.push((await createGoal(db, mgr, { areaId, sprintId: sprint.id, ...g })).id);
    }
    const stepIds: string[] = [];
    for (const s of def.steps) {
      const r = await addStep(db, mgr, {
        areaId,
        sprintId: sprint.id,
        title: s.title,
        description: `${s.title} için gerekli işler.`,
        goalId: goalIds[s.goal] ?? null,
      });
      stepIds.push(r.id);
    }
    await submitRoadmap(db, mgr, { areaId, sprintId: sprint.id });
    const [rm] = await db.execute<{ id: string }>(
      sql`select id from roadmaps where area_id = ${areaId} and sprint_id = ${sprint.id}`,
    ).then((r) => r.rows);
    await approveRoadmap(db, admin, { roadmapId: must(rm, "Roadmap").id });
    const created: string[] = [];
    for (const [i, lay] of LAYOUT.entries()) {
      const title = def.tickets[i] as string;
      const r = await createTicket(db, mgr, {
        roadmapStepId: stepIds[lay.step] as string,
        title,
        description: `${title} işini bitir ve basamağın hedefine uygun şekilde teslim et.`,
      });
      created.push(r.id);
    }
    for (const [i, lay] of LAYOUT.entries()) {
      if (lay.dep !== undefined) {
        await addDependency(db, mgr, { ticketId: created[i] as string, dependsOnId: created[lay.dep] as string });
      }
    }
    ticketIds.push(created);
  }
  // Alanlar arası bağımlılık: Mobil "mağaza ekran görüntüleri" ← Tasarım "mobil bileşen kiti".
  await addDependency(db, mgrs[1], {
    ticketId: (ticketIds[1] as string[])[7] as string,
    dependsOnId: (ticketIds[2] as string[])[5] as string,
  });
  for (const [ai, created] of ticketIds.entries()) {
    const toPublish = created.filter((_, i) => !(LAYOUT[i] as { draft?: boolean }).draft);
    await publishTickets(db, mgrs[ai] as Actor, { ticketIds: toPublish });
  }
  await stamp(ago(8 * 24 + 6));

  // Onay bekleyen roadmap: Web alanı, sonraki sprint.
  const g = await createGoal(db, mgrs[0], {
    areaId: webId,
    sprintId: nextSprint.id,
    title: "Yönetim paneli ilk sürüm",
    requirements: "Tablolar, süzgeçler ve dışa aktarma çalışır.",
  });
  for (const title of ["Tablo bileşeni", "Süzgeç çubuğu", "CSV dışa aktarma"]) {
    await addStep(db, mgrs[0], {
      areaId: webId,
      sprintId: nextSprint.id,
      title,
      description: `${title} için gerekli işler.`,
      goalId: g.id,
    });
  }
  await submitRoadmap(db, mgrs[0], { areaId: webId, sprintId: nextSprint.id });
  await stamp(ago(30));

  /* ------------------------------ Ticket yaşam döngüleri ------------------------------ */
  const areaOfTicket = async (id: string) => {
    const [t] = await db.select({ areaId: tickets.areaId }).from(tickets).where(eq(tickets.id, id)).limit(1);
    return must(t, "Ticket").areaId;
  };
  // Havuzda demo dışı (mevcut) alınabilir ticket varsa servis rastgele onları çekebilir; mevcut veriye
  // dokunmamak için o durumda çekme, servisin kurallarını izleyerek yalnız demo alanlarından yapılır.
  const [foreign] = (
    await db.execute<{ n: string }>(
      sql`select count(*) n from tickets where sprint_id = ${sprint.id} and ${takeableCondition()} and area_id not in (${sql.join(
        areaIds.map((a) => sql`${a}::uuid`),
        sql`, `,
      )})`,
    )
  ).rows;
  const manualDraw = Number(foreign?.n ?? 0) > 0;
  if (manualDraw) skipped.push("Havuzda demo dışı alınabilir ticket var: çekmeler demo alanlarından elle (servis kurallarıyla) yapıldı");
  type Draw = { kind: "offered" | "taken" | "empty"; ticketId: string };
  const draw = async (who: Actor, at: Date): Promise<Draw> => {
    if (!manualDraw) {
      const r = await requestTicket(db, who, at);
      if (r.kind === "empty") return { kind: "empty", ticketId: "" };
      return { kind: r.kind, ticketId: r.kind === "offered" ? r.offer.ticket.id : r.ticket.id };
    }
    return db.transaction(async (tx) => {
      const settings = await getSettings(tx);
      const rejected = (
        await tx
          .select({ id: ticketRejections.ticketId })
          .from(ticketRejections)
          .where(and(eq(ticketRejections.userId, who.id), eq(ticketRejections.sprintId, sprint.id)))
      ).map((r) => r.id);
      const own = [...new Set([...(who.homeAreaId ? [who.homeAreaId] : []), ...who.managedAreaIds])];
      const [c] = await tx
        .select({ id: tickets.id, areaId: tickets.areaId })
        .from(tickets)
        .where(
          and(
            eq(tickets.sprintId, sprint.id),
            inArray(tickets.areaId, areaIds),
            takeableCondition(),
            own.length ? notInArray(tickets.areaId, own) : undefined,
            rejected.length ? notInArray(tickets.id, rejected) : undefined,
          ),
        )
        .orderBy(sql`random()`)
        .limit(1)
        .for("update");
      if (!c) return { kind: "empty" as const, ticketId: "" };
      const quota = await rejectionQuota(tx, who.id, sprint.id, settings.rejectionsPerSprint);
      const offered = quota.remaining > 0;
      await tx
        .update(tickets)
        .set(
          offered
            ? { status: "offered", assigneeId: who.id, offeredAt: at, updatedAt: at }
            : { status: "taken", assigneeId: who.id, takenAt: at, dueAt: addHours(at, settings.ticketHours), updatedAt: at },
        )
        .where(eq(tickets.id, c.id));
      await audit(tx, {
        actorId: who.id,
        action: "ticket.request_draw",
        entityType: "ticket",
        entityId: c.id,
        areaId: c.areaId,
        ticketId: c.id,
        data: { kind: offered ? "offered" : "taken" },
      });
      return { kind: offered ? ("offered" as const) : ("taken" as const), ticketId: c.id };
    });
  };
  const take = async (who: Actor, at: Date): Promise<string> => {
    const r = await draw(who, at);
    await stamp(at);
    if (r.kind === "empty") throw new Error("Havuz boş: demo için yeterli alınabilir ticket yok.");
    if (r.kind === "offered") {
      const accepted = addMinutes(at, 4);
      await acceptOffer(db, who, { ticketId: r.ticketId }, accepted);
      await stamp(accepted);
    }
    return r.ticketId;
  };
  const deliver = async (who: Actor, ticketId: string, at: Date, withFile: boolean) => {
    const fileIds: string[] = [];
    if (withFile) {
      const content = Buffer.from(`Demo teslim notları\n${at.toISOString()}\n`, "utf8");
      const f = await storeUpload(
        db,
        who,
        { name: "teslim-notlari.txt", type: "text/plain", size: content.byteLength, arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer },
        at,
      );
      fileIds.push(f.id);
    }
    await submitTicket(
      db,
      who,
      {
        ticketId,
        description: "İş tamamlandı; ayrıntılar ve çıktı aşağıdaki bağlantıda.",
        links: [`https://example.com/demo/teslim/${ticketId.slice(0, 8)}`],
        fileIds,
      },
      at,
    );
    await stamp(at);
  };
  const say = async (who: Actor, channelId: string, body: string, at: Date) => {
    await sendMessage(db, who, { channelId, body }, at);
    await stamp(at);
  };
  const sayInTicket = async (who: Actor, ticketId: string, body: string, at: Date) => {
    const channelId = await getTicketChannelId(db, who, { ticketId });
    await say(who, channelId, body, at);
  };

  // A) uye1: teslim + "iyi oldu".
  const tA = await take(m("uye1"), ago(70));
  await deliver(m("uye1"), tA, ago(52), true);
  await evaluateTicket(db, mgrOfArea(await areaOfTicket(tA)), { ticketId: tA, verdict: "good", comment: "Temiz iş, teşekkürler." }, ago(40));
  await stamp(ago(40));

  // B) uye2: teslim + "kötü oldu" (nazik yorum).
  const tB = await take(m("uye2"), ago(60));
  await deliver(m("uye2"), tB, ago(36), true);
  await evaluateTicket(
    db,
    mgrOfArea(await areaOfTicket(tB)),
    {
      ticketId: tB,
      verdict: "bad",
      comment: "Teşekkürler, emeğin için sağ ol. Bu sefer beklentiyi tam karşılamadı; istersen birlikte bir bakalım, yardımcı olurum.",
    },
    ago(22),
  );
  await stamp(ago(22));

  // C) uye3: dosyasız teslim, değerlendirme bekliyor.
  const tC = await take(m("uye3"), ago(30));
  await deliver(m("uye3"), tC, ago(3), false);

  // D) uye3: geri çekme talebi, süresinde cevaplanmamış.
  const tD = await take(m("uye3"), ago(62));
  await createRequest(db, m("uye3"), { ticketId: tD, kind: "withdrawal", reason: "Başka bir projedeki yoğunluk yüzünden bu işe zaman ayıramıyorum." }, ago(30));
  await stamp(ago(30));

  // E) uye4: süresi 6 saatten az kalmış.
  const tE = await take(m("uye4"), ago(67.5));
  // F) uye5: ek süre talebi; yönetici sormuş, üye cevaplamış.
  const tF = await take(m("uye5"), ago(40));
  const reqF = await createRequest(db, m("uye5"), { ticketId: tF, kind: "extension", reason: "Tasarım dosyalarının bir kısmı hâlâ eksik, ek süre rica ediyorum." }, ago(14));
  await stamp(ago(14));
  const mgrF = mgrOfArea(await areaOfTicket(tF));
  await postRequestMessage(db, mgrF, { requestId: reqF.id, body: "Kaç saat yeterli olur, eksik dosyalar ne zaman gelir?" }, ago(10));
  await stamp(ago(10));
  await postRequestMessage(db, m("uye5"), { requestId: reqF.id, body: "Dosyalar yarın sabah gelecek; 24 saat yeterli olur." }, ago(8));
  await stamp(ago(8));

  // G) uye6: bir teklifi reddeder, sonra aldığı ticket'ın süresi dolar.
  const rej = await draw(m("uye6"), ago(80));
  await stamp(ago(80));
  if (rej.kind === "offered") {
    await rejectOffer(db, m("uye6"), { ticketId: rej.ticketId }, addMinutes(ago(80), 3));
    await stamp(addMinutes(ago(80), 3));
  } else {
    skipped.push("Reddedilmiş teklif: red hakkı olmadığı için teklif yerine doğrudan atama oldu");
  }
  await take(m("uye6"), ago(78));

  // H) uye1: yeni başlamış süren ticket.
  const tH = await take(m("uye1"), ago(6));
  // I) pasif kişi: süren ticket; sonra pasife alınır (ticket üzerinde kalır).
  const tI = await take(m("pasif"), ago(21));

  // Ticket konuşmaları.
  await sayInTicket(mgrOfArea(await areaOfTicket(tE)), tE, "Merhaba, süre kısalıyor; takıldığın bir yer var mı?", ago(5));
  await sayInTicket(m("uye4"), tE, "Son testleri yapıyorum, bugün teslim ederim.", ago(4));
  await sayInTicket(mgrOfArea(await areaOfTicket(tI)), tI, "Selam, nasıl gidiyor?", ago(10));
  await sayInTicket(m("pasif"), tI, "Yarına kadar ilk taslağı çıkaracağım.", ago(9));
  await sayInTicket(mgrOfArea(await areaOfTicket(tC)), tC, "Teslim için teşekkürler, akşam göz atacağım.", ago(2));
  await sayInTicket(m("uye1"), tH, "Başlamadan önce kapsamı doğrulamak istiyorum: mobil görünüm de dahil mi?", ago(5));
  await sayInTicket(mgrOfArea(await areaOfTicket(tH)), tH, "Evet, mobil önce; tableti sonraya bırakabiliriz.", ago(4.5));

  // Pasife al (ticket'ı kişide kalsın diye servis değil, doğrudan güncelleme).
  await db.update(user).set({ active: false }).where(eq(user.id, idOf("demo.pasif")));
  await audit(db, {
    actorId: adminId,
    action: "user.deactivate",
    entityType: "user",
    entityId: idOf("demo.pasif"),
    subjectUserId: idOf("demo.pasif"),
    data: { via: "demo-seed" },
  });
  await stamp(ago(5));

  // J) uye2: bekleyen teklif (30 dakikalık pencere içinde).
  const offerAt = ago(1 / 60);
  const offerRes = await draw(m("uye2"), offerAt);
  await stamp(offerAt);
  if (offerRes.kind !== "offered") skipped.push("Bekleyen teklif: teklif yerine doğrudan atama oldu / havuz boştu");

  /* ------------------------------ Mesajlar ------------------------------ */
  const chWeb = await getAreaChannel(db, { id: webId, name: AREA_DEFS[0]?.name ?? "" });
  const chMobil = await getAreaChannel(db, { id: mobilId, name: AREA_DEFS[1]?.name ?? "" });
  const chTasarim = await getAreaChannel(db, { id: tasarimId, name: AREA_DEFS[2]?.name ?? "" });
  const chAnn = await getAnnouncementChannel(db);

  await say(admin, chAnn.id, "Yeni sprint başladı! Hedefler ve roadmap'ler onaylandı; ticket havuzu açık. Kolay gelsin.", ago(8 * 24 - 2));
  await say(admin, chAnn.id, "Cuma 18:00'de ortak demo toplantısı var. Katılım zorunlu değil ama herkes davetli.", ago(40));

  const webMsgs: [Actor, string, number][] = [
    [mgrs[0], "Hoş geldiniz! Bu sprintin hedefleri planda; alanınız dışından ticket çekebilirsiniz.", 70],
    [m("uye1"), "Tasarım sistemi tokenlarını yarın birlikte gözden geçirebilir miyiz?", 66],
    [admin, "@demo.yonetici1 roadmap onaylandı, ticket'ları yayınlayabilirsin.", 60],
    [m("uye2"), "Lighthouse çıktısını paylaştım, performans puanı 82.", 30],
    [mgrs[0], "Güzel ilerleme. Bugünkü hedef: giriş akışı bitsin.", 4],
  ];
  const mobilMsgs: [Actor, string, number][] = [
    [mgrs[1], "Mobil ekip, bildirim izinleri için iOS metinlerini bu hafta netleştirelim.", 68],
    [m("uye3"), "Önbellek şemasını çıkardım, PR açıyorum.", 45],
    [admin, "@demo.uye4 mağaza ekran görüntüleri için tasarım ekibinin kitini beklemen gerekiyor.", 20],
    [m("uye4"), "Tamam, o zamana kadar bildirim ayarları ekranına bakıyorum.", 18],
  ];
  const tasarimMsgs: [Actor, string, number][] = [
    [mgrs[2], "Logo varyantlarının ilk turu klasörde, yorumlarınızı bekliyorum.", 65],
    [m("uye5"), "İkon setinde 24px ızgara kuralını uyguladım.", 38],
    [m("uye6"), "Karanlık tema ekranları için palet önerisi ekledim.", 12],
  ];
  for (const [ch, list] of [
    [chWeb, webMsgs],
    [chMobil, mobilMsgs],
    [chTasarim, tasarimMsgs],
  ] as const) {
    for (const [who, body, h] of list) await say(who, ch.id, body, ago(h));
  }
  // Bazı kişiler ana alan kanallarını 3 saat önce okumuş sayılsın (son mesajlar okunmamış kalır).
  for (const [who, ch] of [
    [m("uye1"), chWeb],
    [m("uye2"), chWeb],
    [mgrs[1], chMobil],
    [m("uye5"), chTasarim],
  ] as const) {
    await markChannelRead(db, who, { channelId: ch.id }, ago(3));
  }

  /* ------------------------------ Başvuru, tarih düzeltmeleri, tarama ------------------------------ */
  await submitApplication(db, {
    fullName: "Demo Başvuru",
    username: "demo.basvuru",
    email: "demo.basvuru@example.com",
    phone: "05551112233",
    intro: "Merhaba, yazılım ve tasarıma meraklıyım; topluluğa katılıp ticket'larda çalışmak istiyorum.",
  });
  await db.execute(sql`update applications set created_at = ${ago(26).toISOString()} where email = 'demo.basvuru@example.com'`);
  await stamp(ago(26));
  await db.execute(sql`update "user" set created_at = ${ago(9 * 24).toISOString()} where username like 'demo.%'`);

  const tick = await runScheduledTick(db, new Date());

  /* ------------------------------ Özet ------------------------------ */
  const count = async (q: string) => {
    const r = await db.execute<{ n: string }>(sql.raw(q));
    return Number(r.rows[0]?.n ?? 0);
  };
  const areaList = areaIds.map((a) => `'${a}'`).join(",");
  summary["Kişi (demo.*)"] = await count(`select count(*) n from "user" where username like 'demo.%'`);
  summary["Demo alan"] = areaIds.length;
  summary["Ticket"] = await count(`select count(*) n from tickets where area_id in (${areaList})`);
  for (const st of ["draft", "available", "returned_to_pool", "offered", "taken", "extension_pending", "withdrawal_pending", "submitted", "evaluated"]) {
    const n = await count(`select count(*) n from tickets where area_id in (${areaList}) and status = '${st}'`);
    if (n) summary[`  ${st}`] = n;
  }
  summary["Mesaj"] = await count(`select count(*) n from messages m join channels c on c.id = m.channel_id where c.area_id in (${areaList}) or c.kind = 'announcement'`);
  summary["Bildirim (demo kişilere)"] = await count(`select count(*) n from notifications n join "user" u on u.id = n.user_id where u.username like 'demo.%'`);
  summary["Tarama"] = JSON.stringify(tick);

  console.log("Demo verisi oluşturuldu.");
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
  if (skipped.length) console.log(`Atlananlar: ${skipped.join("; ")}`);
  console.log("\nHesaplar (kullanıcı adı):");
  console.log("  Ana yönetici: demo.admin");
  console.log("  Alan yöneticileri: demo.yonetici1, demo.yonetici2, demo.yonetici3");
  console.log("  Üyeler: demo.uye1 ... demo.uye6 (pasif: demo.pasif)");
  console.log("Şifre: DEMO_PASSWORD ya da README'deki varsayılan.");
}

main()
  .catch((e: unknown) => {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
    console.error("Demo verisi yarım kalmış olabilir; temizlemeden tekrar çalıştırma.");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
