/** Denetim kaydı eylem adları — SÖZLEŞME. Yeni eylemler buraya eklenir. */
export const AUDIT_ACTIONS = [
  "auth.sign_in",
  "auth.sign_out",
  "auth.password_set",
  "user.create_main_admin",
  "user.grant_main_admin",
  "user.revoke_main_admin",
  "user.reset_link_issued",
  "application.submit",
  "application.approve",
  "application.reject",
  "personal_data.view",
  "area.create",
  "area.update",
  "area.archive",
  "area.set_manager",
  "area.unarchive",
  "settings.update",
  "sprint.create",
  "sprint.update",
  "sprint.start",
  "goal.create",
  "goal.update",
  "goal.delete",
  "roadmap.step_add",
  "roadmap.step_update",
  "roadmap.step_delete",
  "roadmap.steps_reorder",
  "roadmap.submit",
  "roadmap.resubmit",
  "roadmap.approve",
  "roadmap.return",
  "ticket.create",
  "ticket.update",
  "ticket.cancel",
  "ticket.publish",
  "ticket.dependency_add",
  "ticket.dependency_remove",
  // Aşama 3 — ticket döngüsü
  "ticket.request_draw", // ticket iste (sonuç data.kind: offered | taken | empty)
  "ticket.offer_accept",
  "ticket.offer_reject",
  "ticket.offer_expired", // zamanlayıcı / sprint kapanışı (actorId null olabilir)
  "ticket.submit",
  "ticket.evaluate",
  "ticket.due_warned", // zamanlayıcı
  "ticket.expired", // zamanlayıcı
  "request.create",
  "request.message",
  "request.approve",
  "request.reject",
  "request.cancel",
  "request.reminded", // zamanlayıcı
  "request.overdue", // zamanlayıcı
  "file.upload",
  "sprint.close_begin",
  "sprint.end_decision",
  "sprint.close",
  // Aşama 4 — iletişim
  "message.send", // data: { channelId, channelKind, messageId, mentions }
  "notification.prefs_update",
  "push.subscribe",
  "push.unsubscribe",
  "user.grant_announce",
  "user.revoke_announce",
  // Aşama 5 — ana yönetici paneli
  "user.set_home_area",
  "user.deactivate",
  "user.activate",
  "ticket.reclaim", // pasif kişide kalan ticket'ı havuza döndürme
] as const;

/** Denetim kaydı ekranındaki Türkçe etiketler. Yeni eylem eklenince buraya da eklenir. */
export const AUDIT_ACTION_LABELS: Record<(typeof AUDIT_ACTIONS)[number], string> = {
  "auth.sign_in": "Giriş yaptı",
  "auth.sign_out": "Çıkış yaptı",
  "auth.password_set": "Şifre belirledi",
  "user.create_main_admin": "Ana yönetici hesabı açıldı (CLI)",
  "user.grant_main_admin": "Ana yönetici yetkisi verdi",
  "user.revoke_main_admin": "Ana yönetici yetkisini aldı",
  "user.reset_link_issued": "Şifre sıfırlama bağlantısı üretti",
  "application.submit": "Başvuru gönderildi",
  "application.approve": "Başvuruyu onayladı",
  "application.reject": "Başvuruyu reddetti",
  "personal_data.view": "Kişisel veri görüntüledi",
  "area.create": "Alan oluşturdu",
  "area.update": "Alanı düzenledi",
  "area.archive": "Alanı arşivledi",
  "area.set_manager": "Alan yöneticisi atadı",
  "area.unarchive": "Alanı arşivden çıkardı",
  "settings.update": "Ayarları değiştirdi",
  "sprint.create": "Sprint açtı",
  "sprint.update": "Sprinti düzenledi",
  "sprint.start": "Sprinti başlattı",
  "goal.create": "Hedef ekledi",
  "goal.update": "Hedefi düzenledi",
  "goal.delete": "Hedefi sildi",
  "roadmap.step_add": "Roadmap basamağı ekledi",
  "roadmap.step_update": "Roadmap basamağını düzenledi",
  "roadmap.step_delete": "Roadmap basamağını sildi",
  "roadmap.steps_reorder": "Roadmap basamaklarını sıraladı",
  "roadmap.submit": "Roadmap'i onaya gönderdi",
  "roadmap.resubmit": "Roadmap yeniden onaya düştü",
  "roadmap.approve": "Roadmap'i onayladı",
  "roadmap.return": "Roadmap'i geri gönderdi",
  "ticket.create": "Ticket oluşturdu",
  "ticket.update": "Ticket'ı düzenledi",
  "ticket.cancel": "Ticket'ı iptal etti",
  "ticket.publish": "Ticket'ı yayınladı",
  "ticket.dependency_add": "Bağımlılık ekledi",
  "ticket.dependency_remove": "Bağımlılık kaldırdı",
  "ticket.request_draw": "Ticket istedi",
  "ticket.offer_accept": "Teklifi kabul etti",
  "ticket.offer_reject": "Teklifi reddetti",
  "ticket.offer_expired": "Teklif süresi doldu",
  "ticket.submit": "Teslim etti",
  "ticket.evaluate": "Değerlendirdi",
  "ticket.due_warned": "Süre uyarısı gönderildi",
  "ticket.expired": "Ticket süresi doldu",
  "request.create": "Talep gönderdi",
  "request.message": "Talep konuşmasına yazdı",
  "request.approve": "Talebi onayladı",
  "request.reject": "Talebi reddetti",
  "request.cancel": "Talebi geri aldı",
  "request.reminded": "Talep hatırlatması gönderildi",
  "request.overdue": "Talep cevapsız kaldı",
  "file.upload": "Dosya yükledi",
  "sprint.close_begin": "Sprint kapanışını başlattı",
  "sprint.end_decision": "Sprint sonu kararı verdi",
  "sprint.close": "Sprinti kapattı",
  "message.send": "Mesaj yazdı",
  "notification.prefs_update": "Bildirim tercihlerini değiştirdi",
  "push.subscribe": "Push bildirimlerini açtı",
  "push.unsubscribe": "Push bildirimlerini kapattı",
  "user.grant_announce": "Duyuru yetkisi verdi",
  "user.revoke_announce": "Duyuru yetkisini aldı",
  "user.set_home_area": "Ana alanı değiştirdi",
  "user.deactivate": "Kişiyi pasifleştirdi",
  "user.activate": "Kişiyi etkinleştirdi",
  "ticket.reclaim": "Pasif kişiden ticket'ı geri aldı",
};

/** Filtre grupları (eylem öneki → etiket). */
export const AUDIT_ACTION_GROUPS: { value: string; label: string }[] = [
  { value: "auth.", label: "Giriş / şifre" },
  { value: "user.", label: "Kişiler" },
  { value: "application.", label: "Başvurular" },
  { value: "personal_data.", label: "Kişisel veri" },
  { value: "area.", label: "Alanlar" },
  { value: "settings.", label: "Ayarlar" },
  { value: "sprint.", label: "Sprintler" },
  { value: "goal.", label: "Hedefler" },
  { value: "roadmap.", label: "Roadmap" },
  { value: "ticket.", label: "Ticket'lar" },
  { value: "request.", label: "Talepler" },
  { value: "file.", label: "Dosyalar" },
  { value: "message.", label: "Mesajlar" },
  { value: "notification.", label: "Bildirimler" },
  { value: "push.", label: "Push" },
];

export type AuditAction = (typeof AUDIT_ACTIONS)[number] | (string & {});

export type AuditEntry = {
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  areaId?: string | null;
  ticketId?: string | null;
  subjectUserId?: string | null;
  data?: Record<string, unknown>;
};
