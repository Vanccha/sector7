"use client";
import { useState, useTransition } from "react";
import type { PersonalData, UserAdminRow } from "@/lib/contracts/admin";
import {
  issueResetLinkAction,
  revealPersonalDataAction,
  setHomeAreaAction,
  setMainAdminAction,
  setUserActiveAction,
} from "./actions";
import styles from "./Members.module.css";

type Area = { id: string; name: string };

const dateFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" });
const dateTimeFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });

export function MemberList({ rows, areas }: { rows: UserAdminRow[]; areas: Area[] }) {
  if (rows.length === 0) {
    return (
      <p className={`cut-panel ${styles.empty}`} role="status">
        Eşleşen kişi yok.
      </p>
    );
  }
  return (
    <ul className={styles.list}>
      {rows.map((r) => (
        <li key={r.id}>
          <MemberCard row={r} areas={areas} />
        </li>
      ))}
    </ul>
  );
}

type Confirm = "active" | "admin" | null;
type Outcome = { ok: true; after?: () => void } | { ok: false; error: string };

function MemberCard({ row, areas }: { row: UserAdminRow; areas: Area[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [personal, setPersonal] = useState<PersonalData | null>(null);
  const [reset, setReset] = useState<{ url: string; expiresAt: string; active: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [areaId, setAreaId] = useState(row.homeArea?.id ?? "");

  const nameId = `uye-${row.id}`;
  const panelId = `uye-islem-${row.id}`;

  function run(fn: () => Promise<Outcome>) {
    setError(null);
    setNote(null);
    start(async () => {
      const res = await fn();
      if (res.ok) res.after?.();
      else setError(res.error);
    });
  }

  const reveal = () =>
    run(async () => {
      const res = await revealPersonalDataAction({ userId: row.id });
      return res.ok ? { ok: true, after: () => setPersonal(res.data) } : { ok: false, error: res.error };
    });

  const saveArea = () =>
    run(async () => {
      const res = await setHomeAreaAction({ userId: row.id, areaId: areaId || null });
      return res.ok ? { ok: true, after: () => setNote("Ana alan kaydedildi.") } : { ok: false, error: res.error };
    });

  const issueLink = () =>
    run(async () => {
      const res = await issueResetLinkAction({ userId: row.id });
      return res.ok
        ? {
            ok: true,
            after: () => {
              setReset(res.data);
              setCopied(false);
            },
          }
        : { ok: false, error: res.error };
    });

  const toggleAdmin = () =>
    run(async () => {
      const res = await setMainAdminAction({ userId: row.id, value: !row.isMainAdmin });
      return res.ok
        ? {
            ok: true,
            after: () => {
              setConfirm(null);
              setNote("Yetki güncellendi.");
            },
          }
        : { ok: false, error: res.error };
    });

  const toggleActive = () =>
    run(async () => {
      const res = await setUserActiveAction({ userId: row.id, active: !row.active });
      return res.ok
        ? {
            ok: true,
            after: () => {
              setConfirm(null);
              setNote(row.active ? "Kişi pasifleştirildi." : "Kişi etkinleştirildi.");
            },
          }
        : { ok: false, error: res.error };
    });

  async function copy() {
    if (!reset) return;
    try {
      await navigator.clipboard.writeText(reset.url);
      setCopied(true);
    } catch {
      setError("Kopyalanamadı; bağlantıyı seçip elle kopyalayabilirsin.");
    }
  }

  return (
    <article className={`cut-panel ${styles.card}`} aria-labelledby={nameId}>
      <div className={styles.head}>
        <div style={{ minWidth: 0 }}>
          <h2 id={nameId} className={`h-wide ${styles.name}`}>
            {row.name}
          </h2>
          <span className="muted">@{row.username}</span>
        </div>
        <div className={styles.badges}>
          {row.isMainAdmin && <span className="badge badge--ok">Ana yönetici</span>}
          {row.canAnnounce && <span className="badge">Duyuru yetkisi</span>}
          {!row.active && <span className="badge badge--hot">Pasif</span>}
        </div>
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>Ana alan:</dt>
          <dd>{row.homeArea?.name ?? "Yok"}</dd>
        </div>
        <div>
          <dt>Yönettiği alanlar:</dt>
          <dd>{row.managedAreas.length ? row.managedAreas.map((a) => a.name).join(", ") : "Yok"}</dd>
        </div>
        <div>
          <dt>Elindeki ticket:</dt>
          <dd>{row.heldTickets}</dd>
        </div>
        <div>
          <dt>Bu sprint teslim:</dt>
          <dd>
            {row.submittedThisSprint} <span className="muted">(bilgi amaçlı; puan değildir)</span>
          </dd>
        </div>
        <div>
          <dt>Katılım:</dt>
          <dd>{dateFmt.format(new Date(row.createdAt))}</dd>
        </div>
      </dl>
      <button
        type="button"
        className="btn-line"
        style={{ minHeight: 44, alignSelf: "flex-start" }}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "İşlemleri gizle" : "İşlemler"}
      </button>

      {open && (
        <div id={panelId} className={styles.ops}>
          <section className={styles.op} aria-label="İletişim bilgileri">
            <h3 className={styles.opTitle}>İletişim bilgileri</h3>
            {personal ? (
              <dl className={styles.facts}>
                <div>
                  <dt>E-posta:</dt>
                  <dd>
                    <a href={`mailto:${personal.email}`}>{personal.email}</a>
                  </dd>
                </div>
                <div>
                  <dt>Telefon:</dt>
                  <dd>{personal.phone ? <a href={`tel:${personal.phone}`}>{personal.phone}</a> : "Yok"}</dd>
                </div>
              </dl>
            ) : (
              <div className={styles.row}>
                <button type="button" className="btn-line" onClick={reveal} disabled={pending}>
                  İletişim bilgilerini göster
                </button>
                <span className="muted" style={{ fontSize: 13 }}>
                  Görüntüleme denetim kaydına düşer.
                </span>
              </div>
            )}
          </section>

          <section className={styles.op} aria-label="Ana alan">
            <h3 className={styles.opTitle}>Ana alan</h3>
            <div className={styles.row}>
              <div className="field" style={{ minWidth: 180 }}>
                <label className="label" htmlFor={`alan-${row.id}`}>
                  Ana alan seç
                </label>
                <select id={`alan-${row.id}`} className="select" value={areaId} onChange={(e) => setAreaId(e.target.value)} disabled={pending}>
                  <option value="">Yok</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn-line" onClick={saveArea} disabled={pending || areaId === (row.homeArea?.id ?? "")}>
                Kaydet
              </button>
            </div>
          </section>

          <section className={styles.op} aria-label="Şifre sıfırlama">
            <h3 className={styles.opTitle}>Şifre</h3>
            <div className={styles.row}>
              <button type="button" className="btn-line" onClick={issueLink} disabled={pending}>
                Şifre sıfırlama bağlantısı üret
              </button>
            </div>
            {reset && (
              <div className="notice notice--ok" role="status">
                <p style={{ margin: "0 0 8px" }}>Bağlantı hazır. Yalnız şimdi görünür; kişiye ilet.</p>
                {!reset.active && <p style={{ margin: "0 0 8px" }}>Bu kişi pasif; etkinleştirilene kadar giriş yapamaz.</p>}
                <code className={styles.linkBox}>{reset.url}</code>
                <p className="muted" style={{ margin: "8px 0" }}>
                  Geçerlilik bitişi: {dateTimeFmt.format(new Date(reset.expiresAt))}
                </p>
                <button type="button" className="btn-line" style={{ minHeight: 44 }} onClick={copy}>
                  {copied ? "Kopyalandı" : "Kopyala"}
                </button>
              </div>
            )}
          </section>

          <section className={styles.op} aria-label="Yetki ve durum">
            <h3 className={styles.opTitle}>Yetki ve durum</h3>
            <div className={styles.row}>
              <button
                type="button"
                className="btn-line"
                onClick={() => setConfirm(confirm === "admin" ? null : "admin")}
                disabled={pending}
                aria-expanded={confirm === "admin"}
              >
                {row.isMainAdmin ? "Ana yönetici yetkisini al" : "Ana yönetici yap"}
              </button>
              <button
                type="button"
                className="btn-line btn-danger"
                onClick={() => setConfirm(confirm === "active" ? null : "active")}
                disabled={pending}
                aria-expanded={confirm === "active"}
              >
                {row.active ? "Pasifleştir" : "Etkinleştir"}
              </button>
            </div>
            {confirm === "admin" && (
              <div className={`notice ${styles.confirm}`}>
                <p style={{ margin: 0 }}>
                  {row.isMainAdmin
                    ? `${row.name} artık ana yönetici olmayacak.`
                    : `${row.name} ana yönetici olacak; tüm yönetim ekranlarına erişebilir.`}
                </p>
                <div className={styles.row}>
                  <button type="button" className="btn-solid" onClick={toggleAdmin} disabled={pending}>
                    Onayla
                  </button>
                  <button type="button" className="btn-ghost" style={{ minHeight: 44 }} onClick={() => setConfirm(null)} disabled={pending}>
                    Vazgeç
                  </button>
                </div>
              </div>
            )}
            {confirm === "active" && (
              <div className={`notice ${styles.confirm}`}>
                <p style={{ margin: 0 }}>
                  {row.active
                    ? `Giriş yapamaz, açık oturumları kapanır. Elindeki ${row.heldTickets} ticket kendiliğinden bırakılmaz; panelde 'pasif kişide kalan' olarak görünür ve ticket sayfasından havuza geri alınabilir.`
                    : `${row.name} yeniden giriş yapabilir.`}
                </p>
                <div className={styles.row}>
                  <button type="button" className="btn-solid" onClick={toggleActive} disabled={pending}>
                    Onayla
                  </button>
                  <button type="button" className="btn-ghost" style={{ minHeight: 44 }} onClick={() => setConfirm(null)} disabled={pending}>
                    Vazgeç
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      <div aria-live="polite">
        {error && (
          <p className="notice notice--hot" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        {note && !error && (
          <p className="notice notice--ok" role="status" style={{ margin: 0 }}>
            {note}
          </p>
        )}
      </div>
    </article>
  );
}
