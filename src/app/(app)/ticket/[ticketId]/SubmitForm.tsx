"use client";
import { useId, useRef, useState, useTransition } from "react";
import { PrState } from "@/components/github/PrState";
import type { TicketGithubView } from "@/lib/contracts/github";
import type { FileRef } from "@/lib/contracts/tickets";
import { submitTicketAction } from "./actions";
import styles from "./Ticket.module.css";

type Upload = { key: string; name: string; state: "uploading" | "done" | "error"; ref?: FileRef; error?: string };

/** Teslim formu: açıklama, bağlantılar, dosyalar (her dosya /api/dosya'ya ayrı yüklenir). */
export function SubmitForm({
  ticketId,
  resubmit,
  limits,
  uploadsEnabled = true,
  pullRequests = [],
}: {
  ticketId: string;
  resubmit: boolean;
  limits: { uploadMaxMb: number; maxLinks: number; maxFiles: number };
  uploadsEnabled?: boolean;
  pullRequests?: TicketGithubView["pullRequests"];
}) {
  const prs = [...pullRequests].sort((a, b) => Number(b.merged) - Number(a.merged));
  const [prId, setPrId] = useState<string>(() => prs.find((p) => p.merged)?.id ?? "");
  const uid = useId();
  const [description, setDescription] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const uploading = uploads.some((u) => u.state === "uploading");
  const linkError = Object.entries(fields).find(([k]) => k === "links" || k.startsWith("links."))?.[1];
  const fileError = Object.entries(fields).find(([k]) => k === "fileIds" || k.startsWith("fileIds."))?.[1];

  async function upload(file: File) {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (file.size > limits.uploadMaxMb * 1024 * 1024) {
      setUploads((u) => [...u, { key, name: file.name, state: "error", error: `En fazla ${limits.uploadMaxMb} MB olabilir.` }]);
      return;
    }
    setUploads((u) => [...u, { key, name: file.name, state: "uploading" }]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/dosya", { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as Partial<FileRef> & { error?: string };
      if (res.ok && json.id) {
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, state: "done", ref: json as FileRef } : x)));
      } else {
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, state: "error", error: json.error ?? "Dosya yüklenemedi." } : x)));
      }
    } catch {
      setUploads((u) => u.map((x) => (x.key === key ? { ...x, state: "error", error: "Bağlantı kurulamadı; tekrar dene." } : x)));
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    const room = limits.maxFiles - uploads.filter((u) => u.state !== "error").length;
    if (picked.length > room) {
      setError(`En fazla ${limits.maxFiles} dosya ekleyebilirsin.`);
    } else setError(null);
    picked.slice(0, Math.max(0, room)).forEach((f) => void upload(f));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFields({});
    setDone(null);
    const fileIds = uploads.filter((u) => u.state === "done" && u.ref).map((u) => u.ref!.id);
    start(async () => {
      const res = await submitTicketAction({
        ticketId,
        description,
        links: links.map((l) => l.trim()).filter(Boolean),
        fileIds: uploadsEnabled ? fileIds : [],
        pullRequestId: prId || null,
      });
      if (res.ok) {
        setDone("Teslimin alındı. Teşekkürler!");
        setDescription("");
        setLinks([]);
        setUploads([]);
      } else {
        setError(res.error);
        setFields(res.fields ?? {});
      }
    });
  }

  const activeCount = uploads.filter((u) => u.state !== "error").length;

  return (
    <form onSubmit={submit} className={styles.col} noValidate>
      <div className="field">
        <label className="label" htmlFor={`${uid}-desc`}>
          Ne yaptığını anlat
        </label>
        <textarea
          id={`${uid}-desc`}
          className="textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
          aria-invalid={fields.description ? true : undefined}
          aria-describedby={fields.description ? `${uid}-desc-err` : undefined}
        />
        <p className="field-error" id={`${uid}-desc-err`} hidden={!fields.description}>
          {fields.description}
        </p>
      </div>

      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Bağlantılar (en fazla {limits.maxLinks})</legend>
        {links.map((l, i) => (
          <div key={i} className={styles.linkRow}>
            <input
              className="input"
              type="url"
              inputMode="url"
              placeholder="https://"
              aria-label={`Bağlantı ${i + 1}`}
              value={l}
              onChange={(e) => setLinks((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button type="button" className="btn-ghost" aria-label={`Bağlantı ${i + 1} kaldır`} onClick={() => setLinks((arr) => arr.filter((_, j) => j !== i))}>
              Kaldır
            </button>
          </div>
        ))}
        <div>
          <button type="button" className="btn-line" disabled={links.length >= limits.maxLinks} onClick={() => setLinks((a) => [...a, ""])}>
            Bağlantı ekle
          </button>
        </div>
        <p className="field-error" hidden={!linkError}>
          {linkError}
        </p>
      </fieldset>

      {prs.length > 0 ? (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Teslim edilen PR</legend>
          <ul className={styles.plain}>
            {prs.map((p) => (
              <li key={p.id}>
                <label className={styles.prOption}>
                  <input type="radio" name={`${uid}-pr`} checked={prId === p.id} onChange={() => setPrId(p.id)} />
                  <span>
                    #{p.number} {p.title}
                  </span>
                  <PrState pr={p} />
                  {p.merged ? <span className={styles.small}>Önerilen</span> : null}
                </label>
              </li>
            ))}
            <li>
              <label className={styles.prOption}>
                <input type="radio" name={`${uid}-pr`} checked={prId === ""} onChange={() => setPrId("")} />
                <span>PR yok</span>
              </label>
            </li>
          </ul>
        </fieldset>
      ) : null}

      {uploadsEnabled ? (
      <div className="field">
        <span className="label" id={`${uid}-files`}>
          Dosyalar (en fazla {limits.maxFiles}, her biri {limits.uploadMaxMb} MB)
        </span>
        {uploads.length > 0 ? (
          <ul className={styles.plain} aria-labelledby={`${uid}-files`}>
            {uploads.map((u) => (
              <li key={u.key} className={styles.fileRow}>
                <span>{u.name}</span>
                <span className="muted" role="status">
                  {u.state === "uploading" ? "Yükleniyor…" : u.state === "done" ? "Hazır" : u.error}
                </span>
                {u.state !== "uploading" ? (
                  <button type="button" className="btn-ghost" aria-label={`${u.name} dosyasını kaldır`} onClick={() => setUploads((arr) => arr.filter((x) => x.key !== u.key))}>
                    Kaldır
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        <input ref={fileInput} type="file" multiple hidden id={`${uid}-picker`} onChange={onPick} />
        <div>
          <button type="button" className="btn-line" disabled={activeCount >= limits.maxFiles} onClick={() => fileInput.current?.click()}>
            Dosya seç
          </button>
        </div>
        <p className="field-error" hidden={!fileError}>
          {fileError}
        </p>
      </div>
      ) : (
        <p className={styles.small}>Dosya yükleme kapalı; PR ya da bağlantı ekle.</p>
      )}

      <div className={styles.row}>
        <button type="submit" className="btn-solid" disabled={pending || uploading}>
          {resubmit ? "Yeniden teslim et" : "Teslim et"}
        </button>
        {resubmit ? <span className={styles.small}>En sonuncusu geçerli sayılır.</span> : null}
      </div>
      <p role="status" aria-live="polite" className={styles.small}>
        {done}
      </p>
      <p role="alert" className="field-error" hidden={!error}>
        {error}
      </p>
    </form>
  );
}
