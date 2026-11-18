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
] as const;

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
