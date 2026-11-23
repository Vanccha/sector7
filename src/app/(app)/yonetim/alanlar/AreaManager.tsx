"use client";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/contracts/errors";
import type { AreaDeleteBlockers, AreaRow, UserOption } from "@/lib/contracts/plan";
import {
  archiveAreaAction,
  createAreaAction,
  deleteAreaAction,
  setAreaManagerAction,
  setAreaRepoAction,
  unarchiveAreaAction,
  updateAreaAction,
} from "./actions";
import styles from "./AreaManager.module.css";

type Failure = Extract<ActionResult<unknown>, { ok: false }>;

type RepoInfo = { org: string; syncEnabled: boolean };
type AreaWithRepo = AreaRow & { githubRepo?: string | null };

export function AreaManager({ areas, users, github }: { areas: AreaRow[]; users: UserOption[]; github: RepoInfo }) {
  const active = areas.filter((a) => !a.archivedAt);
  const archived = areas.filter((a) => a.archivedAt);
  return (
    <div className={styles.page}>
      <h1 className="h-wide">Alanlar</h1>
      <NewAreaForm />
      <section className={styles.section} aria-labelledby="aktif-alanlar">
        <h2 id="aktif-alanlar" className={`h-wide ${styles.sectionTitle}`}>
          Aktif alanlar
        </h2>
        {active.length === 0 ? (
          <p className={`cut-panel ${styles.empty}`}>Henüz aktif alan yok. Yukarıdan ilk alanı açabilirsin.</p>
        ) : (
          <ul className={styles.grid}>
            {active.map((a) => (
              <li key={a.id}>
                <AreaCard area={a} users={users} github={github} />
              </li>
            ))}
          </ul>
        )}
      </section>
      {archived.length > 0 && (
        <section className={styles.section} aria-labelledby="arsiv-alanlar">
          <h2 id="arsiv-alanlar" className={`h-wide ${styles.sectionTitle}`}>
            Arşivlenen alanlar
          </h2>
          <ul className={styles.grid}>
            {archived.map((a) => (
              <li key={a.id}>
                <ArchivedCard area={a} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function NewAreaForm() {
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    setDone(false);
    startTransition(async () => {
      const res = await createAreaAction({ name, description });
      if (res.ok) {
        setName("");
        setDescription("");
        setDone(true);
      } else {
        setError(res.error);
        setFields(res.fields ?? {});
      }
    });
  }

  return (
    <form className={`cut-panel ${styles.card} ${styles.form}`} onSubmit={submit} aria-labelledby="yeni-alan">
      <h2 id="yeni-alan" className={`h-wide ${styles.sectionTitle}`}>
        Yeni alan
      </h2>
      <div className="field">
        <label className="label" htmlFor="new-area-name">
          Ad
        </label>
        <input
          id="new-area-name"
          className="input"
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
          aria-invalid={fields.name ? true : undefined}
          required
        />
        {fields.name && <p role="alert">{fields.name}</p>}
      </div>
      <div className="field">
        <label className="label" htmlFor="new-area-desc">
          Açıklama (isteğe bağlı)
        </label>
        <textarea
          id="new-area-desc"
          className="textarea"
          rows={3}
          maxLength={5000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={pending}
        />
        {fields.description && <p role="alert">{fields.description}</p>}
      </div>
      <div className={styles.actions}>
        <button type="submit" className="btn-solid" disabled={pending}>
          Alanı aç
        </button>
      </div>
      <div aria-live="polite">
        {error && (
          <p className="notice notice--hot" role="alert">
            {error}
          </p>
        )}
        {done && <p className="notice notice--ok">Alan açıldı.</p>}
      </div>
    </form>
  );
}

function AreaCard({ area, users, github }: { area: AreaWithRepo; users: UserOption[]; github: RepoInfo }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(area.name);
  const [description, setDescription] = useState(area.description);
  const [managerId, setManagerId] = useState(area.managerId ?? "");
  const [warn, setWarn] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [info, setInfo] = useState<string | null>(null);
  const nameId = `area-${area.id}`;
  const savedRepo = area.githubRepo ?? "";
  const [repo, setRepo] = useState(savedRepo);

  function saveRepo() {
    reset();
    startTransition(async () => {
      const res = await setAreaRepoAction({ areaId: area.id, repo });
      if (res.ok) setInfo(repo.trim() ? "GitHub deposu kaydedildi." : "Depo eşlemesi kaldırıldı; bu alan senkron dışı.");
      else fail(res);
    });
  }

  function fail(res: Failure) {
    setError(res.error);
    setFields(res.fields ?? {});
  }
  function reset() {
    setError(null);
    setFields({});
    setInfo(null);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    reset();
    startTransition(async () => {
      const res = await updateAreaAction({ areaId: area.id, name, description });
      if (res.ok) setEditing(false);
      else fail(res);
    });
  }

  function saveManager() {
    reset();
    startTransition(async () => {
      const res = await setAreaManagerAction({ areaId: area.id, managerId: managerId || null });
      if (res.ok) setInfo("Yönetici kaydedildi.");
      else fail(res);
    });
  }

  function archive(confirm: boolean) {
    reset();
    startTransition(async () => {
      const res = await archiveAreaAction({ areaId: area.id, confirm });
      if (!res.ok) fail(res);
      else if (!res.data.archived) setWarn(res.data.activeTicketCount);
      else setWarn(null);
    });
  }

  function remove() {
    reset();
    startTransition(async () => {
      const res = await deleteAreaAction({ areaId: area.id });
      if (!res.ok) fail(res);
      else if (!res.data.deleted) {
        setConfirmDelete(false);
        setError(blockerMessage(res.data.blockers));
      }
    });
  }

  const managerMissing = area.managerId !== null && !users.some((u) => u.id === area.managerId);

  return (
    <article className={`cut-panel ${styles.card}`} aria-labelledby={nameId}>
      <div className={styles.head}>
        <h3 id={nameId} className={`h-wide ${styles.name}`}>
          {area.name}
        </h3>
        <span className="count" title="Aktif ticket sayısı" aria-label={`${area.activeTicketCount} aktif ticket`}>
          {area.activeTicketCount}
        </span>
      </div>

      {editing ? (
        <form className={styles.form} onSubmit={save}>
          <div className="field">
            <label className="label" htmlFor={`${nameId}-name`}>
              Ad
            </label>
            <input
              id={`${nameId}-name`}
              className="input"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
              aria-invalid={fields.name ? true : undefined}
              required
            />
            {fields.name && <p role="alert">{fields.name}</p>}
          </div>
          <div className="field">
            <label className="label" htmlFor={`${nameId}-desc`}>
              Açıklama
            </label>
            <textarea
              id={`${nameId}-desc`}
              className="textarea"
              rows={3}
              maxLength={5000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={pending}
            />
            {fields.description && <p role="alert">{fields.description}</p>}
          </div>
          <div className={styles.actions}>
            <button type="submit" className="btn-solid" disabled={pending}>
              Kaydet
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                setName(area.name);
                setDescription(area.description);
                reset();
              }}
            >
              Vazgeç
            </button>
          </div>
        </form>
      ) : (
        <>
          {area.description && <p className={styles.desc}>{area.description}</p>}
          <p className="muted">Yönetici: {area.managerName ?? "yok"}</p>
        </>
      )}

      <div className={styles.managerRow}>
        <div className="field">
          <label className="label" htmlFor={`${nameId}-mgr`}>
            Yönetici
          </label>
          <select
            id={`${nameId}-mgr`}
            className="select"
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            disabled={pending}
          >
            <option value="">— Yönetici yok —</option>
            {managerMissing && area.managerId && (
              <option value={area.managerId}>{area.managerName ?? "Bilinmeyen kullanıcı"}</option>
            )}
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} (@{u.username})
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn-line"
          onClick={saveManager}
          disabled={pending || managerId === (area.managerId ?? "")}
        >
          Kaydet
        </button>
      </div>
      {fields.managerId && <p role="alert">{fields.managerId}</p>}

      <div className={styles.managerRow}>
        <div className="field">
          <label className="label" htmlFor={`${nameId}-repo`}>
            GitHub deposu
          </label>
          <div className={styles.repoInput}>
            {github.org ? <span className="muted" aria-hidden="true">{github.org}/</span> : null}
            <input
              id={`${nameId}-repo`}
              className="input"
              value={repo}
              maxLength={100}
              placeholder="depo-adı"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setRepo(e.target.value)}
              disabled={pending}
              aria-invalid={fields.repo ? true : undefined}
              aria-describedby={`${nameId}-repo-help`}
            />
          </div>
          <p id={`${nameId}-repo-help`} className="muted">
            Boş bırakırsan bu alan GitHub ile senkronlanmaz.
            {github.syncEnabled ? "" : " GitHub App yapılandırılmadı; depo eşlemesi kaydedilir, senkron App kurulunca başlar."}
          </p>
          {fields.repo && <p role="alert">{fields.repo}</p>}
        </div>
        <button type="button" className="btn-line" onClick={saveRepo} disabled={pending || repo.trim() === savedRepo}>
          Kaydet
        </button>
      </div>

      {warn !== null && (
        <div className="notice notice--hot" role="alert">
          <p>Bu alanda {warn} aktif ticket var. Arşivlersen geçmiş korunur ama alana yeni plan girilemez.</p>
          <div className={styles.actions}>
            <button type="button" className="btn-line" onClick={() => archive(true)} disabled={pending}>
              Yine de arşivle
            </button>
            <button type="button" className="btn-ghost" onClick={() => setWarn(null)} disabled={pending}>
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="notice notice--hot" role="alert">
          <p>&apos;{area.name}&apos; alanı kalıcı olarak silinecek. Bu geri alınamaz.</p>
          <div className={styles.actions}>
            <button type="button" className="btn-line btn-danger" onClick={remove} disabled={pending}>
              Evet, sil
            </button>
            <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)} disabled={pending}>
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {!editing && warn === null && !confirmDelete && (
        <div className={styles.actions}>
          <button type="button" className="btn-line" onClick={() => setEditing(true)} disabled={pending}>
            Düzenle
          </button>
          <button type="button" className="btn-ghost" onClick={() => archive(false)} disabled={pending}>
            Arşivle
          </button>
          <button
            type="button"
            className="btn-ghost btn-danger"
            onClick={() => {
              reset();
              setConfirmDelete(true);
            }}
            disabled={pending}
          >
            Sil
          </button>
        </div>
      )}

      <div aria-live="polite">
        {error && (
          <p className="notice notice--hot" role="alert">
            {error}
          </p>
        )}
        {info && <p className="notice notice--ok">{info}</p>}
      </div>
    </article>
  );
}

const BLOCKER_LABELS: Record<keyof AreaDeleteBlockers, string> = {
  tickets: "ticket",
  goals: "hedef",
  roadmaps: "roadmap",
  members: "üye",
  messages: "mesaj",
};

function blockerMessage(b: AreaDeleteBlockers): string {
  const parts = (Object.keys(BLOCKER_LABELS) as (keyof AreaDeleteBlockers)[])
    .filter((k) => (b[k] ?? 0) > 0)
    .map((k) => `${b[k]} ${BLOCKER_LABELS[k]}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} ve ${parts[parts.length - 1]}` : (parts[0] ?? "kayıt");
  return `Bu alan silinemez: ${list} var. Geçmişi korumak için alanı arşivle.`;
}

function ArchivedCard({ area }: { area: AreaRow }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameId = `area-${area.id}`;

  function restore() {
    setError(null);
    startTransition(async () => {
      const res = await unarchiveAreaAction({ areaId: area.id });
      if (!res.ok) setError(res.error);
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const res = await deleteAreaAction({ areaId: area.id });
      if (!res.ok) setError(res.error);
      else if (!res.data.deleted) {
        setConfirmDelete(false);
        setError(blockerMessage(res.data.blockers));
      }
    });
  }

  return (
    <article className={`cut-panel ${styles.card} ${styles.archived}`} aria-labelledby={nameId}>
      <h3 id={nameId} className={`h-wide ${styles.name}`}>
        {area.name}
      </h3>
      {area.description && <p className={styles.desc}>{area.description}</p>}
      {confirmDelete ? (
        <div className="notice notice--hot" role="alert">
          <p>&apos;{area.name}&apos; alanı kalıcı olarak silinecek. Bu geri alınamaz.</p>
          <div className={styles.actions}>
            <button type="button" className="btn-line btn-danger" onClick={remove} disabled={pending}>
              Evet, sil
            </button>
            <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)} disabled={pending}>
              Vazgeç
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.actions}>
          <button type="button" className="btn-line" onClick={restore} disabled={pending}>
            Arşivden çıkar
          </button>
          <button
            type="button"
            className="btn-ghost btn-danger"
            onClick={() => {
              setError(null);
              setConfirmDelete(true);
            }}
            disabled={pending}
          >
            Sil
          </button>
        </div>
      )}
      <div aria-live="polite">
        {error && (
          <p className="notice notice--hot" role="alert">
            {error}
          </p>
        )}
      </div>
    </article>
  );
}
