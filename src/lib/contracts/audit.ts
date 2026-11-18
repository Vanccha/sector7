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
  "settings.update",
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
