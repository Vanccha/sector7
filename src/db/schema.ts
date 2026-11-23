/**
 * SECTOR7 veritabanı şeması — SÖZLEŞME DOSYASI.
 * Alt ajanlar bu dosyayı değiştirmez; değişiklik yalnız teknik lider (Opus) tarafından,
 * göç (migration) üretilerek yapılır. Kararlar: docs/KARARLAR.md
 *
 * Kimlik tabloları (user, session, account, verification, rate_limit) Better Auth'un
 * beklediği alanlarla tanımlıdır; alan adları camelCase, sütun adları snake_case.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ------------------------------------------------------------------ */
/* Kimlik (Better Auth)                                                */
/* ------------------------------------------------------------------ */

export const user = pgTable(
  "user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // username eklentisi: username küçük harfe normalize edilmiş hâlidir.
    username: text("username").unique(),
    displayUsername: text("display_username"),
    // SECTOR7 alanları (Better Auth'a additionalFields olarak tanıtılır, input: false)
    phone: text("phone"),
    homeAreaId: uuid("home_area_id").references((): AnyPgColumn => areas.id),
    isMainAdmin: boolean("is_main_admin").notNull().default(false),
    canAnnounce: boolean("can_announce").notNull().default(false),
    active: boolean("active").notNull().default(true),
    // Aşama 7.5: bağlı GitHub hesabı (OAuth ile doğrulanmış). Token SAKLANMAZ; yalnız kimlik ve ad.
    githubId: text("github_id").unique(),
    githubLogin: text("github_login"),
    githubLinkedAt: ts("github_linked_at"),
  },
  (t) => [index("user_home_area_idx").on(t.homeAreaId)],
);

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expiresAt: ts("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable("verification", {
  id: uuid("id").primaryKey().defaultRandom(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const rateLimit = pgTable("rate_limit", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/* ------------------------------------------------------------------ */
/* Alanlar, ayarlar, üyelik                                            */
/* ------------------------------------------------------------------ */

export const areas = pgTable("areas", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** Alan yöneticisi. Bir alanın tek yöneticisi olur; bir kişi birden çok alanı yönetebilir. */
  managerId: uuid("manager_id").references((): AnyPgColumn => user.id),
  /** Geçmişi olan alan silinmez, arşivlenir; yalnız boş alan silinebilir (deleteArea). */
  archivedAt: ts("archived_at"),
  /** Aşama 7.5: alanın GitHub deposu (org içindeki ad, ör. "alan-tasarim"). Boşsa alan senkron dışı. */
  githubRepo: text("github_repo"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Anahtar-değer ayarları. Anahtarlar ve varsayılanlar: src/lib/contracts/settings.ts */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
  updatedById: uuid("updated_by_id").references(() => user.id),
});

export const applicationStatus = pgEnum("application_status", ["pending", "approved", "rejected"]);

/** Dışarıdan gelen üyelik başvuruları. Reddedilen başvuru kayıtta kalır. */
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    /** İstenen kullanıcı adı, küçük harfe normalize edilmiş. */
    username: text("username").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    intro: text("intro").notNull(),
    /** Aşama 7.5: isteğe bağlı, beyan edilen GitHub kullanıcı adı (doğrulanmamış; yalnız bilgi). */
    githubUsername: text("github_username"),
    status: applicationStatus("status").notNull().default("pending"),
    reviewedById: uuid("reviewed_by_id").references(() => user.id),
    reviewedAt: ts("reviewed_at"),
    reviewNote: text("review_note"),
    /** Onaylanınca açılan hesap. */
    createdUserId: uuid("created_user_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("applications_status_idx").on(t.status, t.createdAt),
    // Aynı kullanıcı adıyla aynı anda yalnız bir bekleyen başvuru olabilir.
    uniqueIndex("applications_pending_username_uq")
      .on(t.username)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const passwordTokenPurpose = pgEnum("password_token_purpose", ["setup", "reset"]);

/** Tek kullanımlık şifre belirleme / sıfırlama bağlantıları. Yalnız token'ın SHA-256 özeti saklanır. */
export const passwordTokens = pgTable(
  "password_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    purpose: passwordTokenPurpose("purpose").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdById: uuid("created_by_id").references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index("password_tokens_user_idx").on(t.userId)],
);

/**
 * "Beni hatırla" cihazları: tarayıcıdaki httpOnly çerezde ham token, burada yalnız SHA-256 özeti.
 * Her kullanımda token yenilenir (aynı satır), süre kayar. Şifre değişince / pasifleştirmede silinir.
 */
export const rememberedDevices = pgTable(
  "remembered_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    /** Son yenilemeden önceki token'ın özeti: iki sekme yarışında kısa süre (bir kez) kabul edilir. */
    previousTokenHash: text("previous_token_hash"),
    rotatedAt: ts("rotated_at"),
    createdAt: createdAt(),
    lastUsedAt: ts("last_used_at"),
    expiresAt: ts("expires_at").notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("remembered_devices_user_idx").on(t.userId),
    index("remembered_devices_prev_idx").on(t.previousTokenHash),
    index("remembered_devices_expires_idx").on(t.expiresAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Sprint, hedef, roadmap                                              */
/* ------------------------------------------------------------------ */

export const sprintStatus = pgEnum("sprint_status", ["planned", "active", "closing", "closed"]);

/** Sprintler tüm topluluk için ortaktır; tema sprint gününden hesaplanır. */
export const sprints = pgTable(
  "sprints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: integer("number").notNull().unique(),
    name: text("name").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    lengthDays: integer("length_days").notNull(),
    status: sprintStatus("status").notNull().default("planned"),
    closedAt: ts("closed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    // Aynı anda en fazla bir aktif sprint.
    uniqueIndex("sprints_one_active_uq")
      .on(t.status)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => sprints.id),
    areaId: uuid("area_id")
      .notNull()
      .references(() => areas.id),
    /** Hedef nedir. */
    title: text("title").notNull(),
    /** Ulaşmak için ne gerekir. */
    requirements: text("requirements").notNull().default(""),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("goals_sprint_area_idx").on(t.sprintId, t.areaId)],
);

export const roadmapStatus = pgEnum("roadmap_status", ["draft", "submitted", "approved", "returned"]);

/** Bir alanın bir sprintteki roadmap'i. Ana yönetici onaylar ya da notla geri gönderir. */
export const roadmaps = pgTable(
  "roadmaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => sprints.id),
    areaId: uuid("area_id")
      .notNull()
      .references(() => areas.id),
    status: roadmapStatus("status").notNull().default("draft"),
    submittedAt: ts("submitted_at"),
    reviewedById: uuid("reviewed_by_id").references(() => user.id),
    reviewedAt: ts("reviewed_at"),
    reviewNote: text("review_note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("roadmaps_sprint_area_uq").on(t.sprintId, t.areaId)],
);

export const roadmapSteps = pgTable(
  "roadmap_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roadmapId: uuid("roadmap_id")
      .notNull()
      .references(() => roadmaps.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").references(() => goals.id),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /**
     * Aşama 7.4: önceki basamakla ilişki. false = paralel (beklemeden havuza çıkabilir), true = sıralı
     * (önceki basamağın ticket'ı bitmeden alınamaz). Yalnız ticket'lara bölerken bağımlılığa çevrilir;
     * sonrasında ilişkilerin tek kaynağı `ticket_dependencies`.
     */
    afterPrevious: boolean("after_previous").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("roadmap_steps_roadmap_idx").on(t.roadmapId, t.position)],
);

/* ------------------------------------------------------------------ */
/* Ticket'lar                                                          */
/* ------------------------------------------------------------------ */

/**
 * Ana akış: draft → available → (offered) → taken → submitted → evaluated.
 * offered: rastgele çekilen ticket kişiye teklif edildi (assigneeId = teklif edilen); kabul edince taken.
 * Yan durumlar: extension_pending, withdrawal_pending (ticket alınmışken talep bekliyor),
 * returned_to_pool (havuza döndü; alınabilirlik açısından available ile aynı), cancelled.
 */
export const ticketStatus = pgEnum("ticket_status", [
  "draft",
  "available",
  "offered",
  "taken",
  "submitted",
  "evaluated",
  "extension_pending",
  "withdrawal_pending",
  "returned_to_pool",
  "cancelled",
]);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    areaId: uuid("area_id")
      .notNull()
      .references(() => areas.id),
    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => sprints.id),
    roadmapStepId: uuid("roadmap_step_id").references(() => roadmapSteps.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: ticketStatus("status").notNull().default("draft"),
    assigneeId: uuid("assignee_id").references(() => user.id),
    /** Teklif anı (status = offered). Teklif OFFER_MINUTES sonra kendiliğinden düşer. */
    offeredAt: ts("offered_at"),
    takenAt: ts("taken_at"),
    /** Teslim son anı. Geri sayım duraklatıldığında, devam ederken duraklama süresi kadar ileri itilir. */
    dueAt: ts("due_at"),
    /** Doluysa geri sayım bu andan beri duruyor (yöneticinin cevabı bekleniyor). */
    pausedAt: ts("paused_at"),
    warnedAt: ts("warned_at"),
    expiredNotifiedAt: ts("expired_notified_at"),
    /** Bağımlılık düzenleyicisindeki konum (masaüstü). */
    posX: real("pos_x"),
    posY: real("pos_y"),
    /** Aşama 7.5: GitHub issue'su (alanın deposunda) ve iş dalı. Senkron sürecinin çıktısıdır. */
    githubIssueNumber: integer("github_issue_number"),
    githubIssueUrl: text("github_issue_url"),
    githubBranch: text("github_branch"),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tickets_status_area_idx").on(t.status, t.areaId),
    index("tickets_assignee_idx").on(t.assigneeId),
    index("tickets_sprint_idx").on(t.sprintId),
  ],
);

/** Yönlü, döngüsüz bağımlılık grafiği: ticketId, dependsOnId tamamlanmadan alınamaz. */
export const ticketDependencies = pgTable(
  "ticket_dependencies",
  {
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    dependsOnId: uuid("depends_on_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.ticketId, t.dependsOnId] }),
    index("ticket_deps_depends_on_idx").on(t.dependsOnId),
  ],
);

/** Red hakkı kullanımları (sprint başına sınırlı). */
export const ticketRejections = pgTable(
  "ticket_rejections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => sprints.id),
    createdAt: createdAt(),
  },
  (t) => [index("ticket_rejections_user_sprint_idx").on(t.userId, t.sprintId)],
);

export const ticketRequestKind = pgEnum("ticket_request_kind", ["extension", "withdrawal"]);
export const ticketRequestStatus = pgEnum("ticket_request_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

/** Ek süre ve geri çekme talepleri. Konuşma ticket kanalında yürür; talep otomatik sonuçlanmaz. */
export const ticketRequests = pgTable(
  "ticket_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id),
    kind: ticketRequestKind("kind").notNull(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => user.id),
    reason: text("reason").notNull(),
    status: ticketRequestStatus("status").notNull().default("pending"),
    /** Ek süre onayında verilen saat. */
    grantedHours: integer("granted_hours"),
    respondedById: uuid("responded_by_id").references(() => user.id),
    respondedAt: ts("responded_at"),
    responseNote: text("response_note"),
    /** Yöneticinin cevap vermesi gereken son an. */
    respondBy: ts("respond_by").notNull(),
    /** Doluysa yönetici soru sordu, talep sahibinin cevabı bekleniyor; bu sırada cevap süresi işlemez. */
    awaitingRequesterAt: ts("awaiting_requester_at"),
    remindedAt: ts("reminded_at"),
    /** Cevap süresi aşıldığında işaretlenir; ana yönetici panelinde öne çıkar. */
    overdueAt: ts("overdue_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ticket_requests_status_idx").on(t.status, t.respondBy),
    index("ticket_requests_ticket_idx").on(t.ticketId),
  ],
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    description: text("description").notNull(),
    links: jsonb("links").$type<string[]>().notNull().default([]),
    /** Aşama 7.5: teslim edilen PR (ticket'a bağlı PR'lardan biri). */
    pullRequestId: uuid("pull_request_id").references((): AnyPgColumn => ticketPullRequests.id),
    createdAt: createdAt(),
  },
  (t) => [index("submissions_ticket_idx").on(t.ticketId)],
);

/* ------------------------------------------------------------------ */
/* GitHub senkronu (Aşama 7.5)                                         */
/* ------------------------------------------------------------------ */

/**
 * Senkron kuyruğu: ticket başına tek bekleyen satır (birleşir). `tickets` / `ticket_dependencies`
 * değişince tetikleyici (göç 0006) ekler/tazeler. İşleyici ticket'ın güncel hâlinden GitHub'daki issue'nun
 * olması gereken durumunu hesaplayıp uygular (durum tabanlı, idempotent); başarıda satırı siler
 * (yalnız `enqueuedAt` okunduğundan beri değişmediyse).
 */
export const githubOutbox = pgTable(
  "github_outbox",
  {
    ticketId: uuid("ticket_id")
      .primaryKey()
      .references(() => tickets.id, { onDelete: "cascade" }),
    enqueuedAt: ts("enqueued_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    lastError: text("last_error"),
  },
  (t) => [index("github_outbox_next_idx").on(t.nextAttemptAt)],
);

/** Depo başına sprint milestone'u önbelleği. */
export const githubMilestones = pgTable(
  "github_milestones",
  {
    repo: text("repo").notNull(),
    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => sprints.id),
    number: integer("number").notNull(),
  },
  (t) => [primaryKey({ columns: [t.repo, t.sprintId] })],
);

/** Ticket'a bağlanan PR'lar (webhook'tan; dal öneki ya da gövdedeki issue referansıyla eşlenir). */
export const ticketPullRequests = pgTable(
  "ticket_pull_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id),
    repo: text("repo").notNull(),
    number: integer("number").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    state: text("state").$type<"open" | "closed">().notNull(),
    merged: boolean("merged").notNull().default(false),
    authorLogin: text("author_login"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("ticket_prs_repo_number_uq").on(t.repo, t.number), index("ticket_prs_ticket_idx").on(t.ticketId)],
);

/** Webhook teslimat kimlikleri (X-GitHub-Delivery): aynı teslimat iki kez işlenmez. */
export const githubWebhookDeliveries = pgTable("github_webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  event: text("event").notNull(),
  receivedAt: createdAt(),
});

export const evaluationVerdict = pgEnum("evaluation_verdict", ["good", "bad"]);

/** "Kötü oldu" ceza değildir; yalnız kayıt ve geri bildirimdir. */
export const evaluations = pgTable(
  "evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id),
    submissionId: uuid("submission_id").references(() => submissions.id),
    evaluatorId: uuid("evaluator_id")
      .notNull()
      .references(() => user.id),
    verdict: evaluationVerdict("verdict").notNull(),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [
    index("evaluations_ticket_idx").on(t.ticketId),
    // Her değerlendirici bir ticket'ı bir kez değerlendirir (sonra güncelleyebilir).
    uniqueIndex("evaluations_ticket_evaluator_uq").on(t.ticketId, t.evaluatorId),
  ],
);

/**
 * Sprint sonu kararları. `decision` bilinçli olarak metin: seçenekler
 * src/lib/contracts/sprint-end.ts içindeki kayıttan gelir, yeni seçenek eklenebilir.
 */
export const sprintEndDecisions = pgTable(
  "sprint_end_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sprintId: uuid("sprint_id")
      .notNull()
      .references(() => sprints.id),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id),
    decision: text("decision").notNull(),
    note: text("note"),
    decidedById: uuid("decided_by_id")
      .notNull()
      .references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sprint_end_decisions_uq").on(t.sprintId, t.ticketId)],
);

/* ------------------------------------------------------------------ */
/* Dosyalar                                                            */
/* ------------------------------------------------------------------ */

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => user.id),
  /** UPLOAD_DIR'e göre göreli yol. */
  storagePath: text("storage_path").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  submissionId: uuid("submission_id").references(() => submissions.id),
  messageId: uuid("message_id").references((): AnyPgColumn => messages.id),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ */
/* İletişim                                                            */
/* ------------------------------------------------------------------ */

export const channelKind = pgEnum("channel_kind", ["area", "ticket", "announcement"]);

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: channelKind("kind").notNull(),
    areaId: uuid("area_id").references(() => areas.id),
    ticketId: uuid("ticket_id").references(() => tickets.id),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("channels_area_uq")
      .on(t.areaId)
      .where(sql`${t.kind} = 'area'`),
    uniqueIndex("channels_ticket_uq")
      .on(t.ticketId)
      .where(sql`${t.kind} = 'ticket'`),
    // Tek ortak duyuru kanalı.
    uniqueIndex("channels_announcement_uq")
      .on(t.kind)
      .where(sql`${t.kind} = 'announcement'`),
  ],
);

/** Kişinin bir kanalı en son okuduğu an (okunmamış sayısı bundan sonraki, başkasının yazdığı mesajlar). */
export const channelReads = pgTable(
  "channel_reads",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id),
    lastReadAt: ts("last_read_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.channelId] })],
);

export const messageKind = pgEnum("message_kind", ["text", "system"]);

/** Mesajlar düzenlenmez ve silinmez (geliştirici kararı, Aşama 4); editedAt kullanılmıyor. */

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id),
    /** Sistem mesajlarında boş. */
    authorId: uuid("author_id").references(() => user.id),
    kind: messageKind("kind").notNull().default("text"),
    body: text("body").notNull(),
    /** Ek süre / geri çekme talebine bağlı mesajlar. */
    requestId: uuid("request_id").references(() => ticketRequests.id),
    createdAt: createdAt(),
    editedAt: ts("edited_at"),
  },
  (t) => [index("messages_channel_idx").on(t.channelId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Bildirim türü; liste: src/lib/contracts/notifications.ts */
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link"),
    readAt: ts("read_at"),
    /** Push gönderimi için ele alındığı an (gönderilmese de: tercih kapalı, abonelik yok). Boşsa sırada. */
    pushedAt: ts("pushed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_idx").on(t.userId, t.createdAt),
    index("notifications_push_queue_idx")
      .on(t.createdAt)
      .where(sql`${t.pushedAt} is null`),
  ],
);

export const notificationPrefs = pgTable(
  "notification_prefs",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    push: boolean("push").notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.type] })],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ */
/* Denetim kaydı                                                       */
/* ------------------------------------------------------------------ */

/** Her işlem ve her mesaj buraya düşer. Kişisel veri görüntülemeleri de kaydedilir. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").references(() => user.id),
    /** Nokta ayrımlı eylem adı, ör. "application.approve". Liste: src/lib/contracts/audit.ts */
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    areaId: uuid("area_id").references(() => areas.id),
    ticketId: uuid("ticket_id").references(() => tickets.id),
    /** Etkilenen kişi (ör. kişisel verisi görüntülenen). */
    subjectUserId: uuid("subject_user_id").references(() => user.id),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_created_idx").on(t.createdAt),
    index("audit_actor_idx").on(t.actorId, t.createdAt),
    index("audit_area_idx").on(t.areaId, t.createdAt),
    index("audit_ticket_idx").on(t.ticketId, t.createdAt),
  ],
);
