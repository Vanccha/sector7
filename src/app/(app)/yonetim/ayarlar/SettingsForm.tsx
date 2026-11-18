"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SETTING_META } from "@/lib/contracts/admin";
import { DEFAULT_SETTINGS, settingsSchema, type SettingKey, type Settings } from "@/lib/contracts/settings";
import { updateSettingsAction } from "./actions";

type NumKey = { [K in SettingKey]: Settings[K] extends number ? K : never }[SettingKey];
type BoolKey = Exclude<SettingKey, NumKey>;

const KEYS = Object.keys(SETTING_META) as SettingKey[];
const isBool = (k: SettingKey): k is BoolKey => typeof DEFAULT_SETTINGS[k] === "boolean";

function bounds(key: NumKey): { min: number; max: number } {
  const f = settingsSchema.shape[key];
  return { min: f.minValue ?? 0, max: f.maxValue ?? 9999 };
}

export function SettingsForm({ values, defaults }: { values: Settings; defaults: Settings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<SettingKey, string>>(
    () => Object.fromEntries(KEYS.map((k) => [k, String(values[k])])) as Record<SettingKey, string>,
  );
  const on = (k: SettingKey) => draft[k] === "true";
  const [errors, setErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function parse(k: SettingKey): { n: number | null; err: string | null } {
    if (isBool(k)) return { n: null, err: null };
    const raw = draft[k].trim();
    const { min, max } = bounds(k);
    if (raw === "" || !/^\d+$/.test(raw)) return { n: null, err: "Tam sayı gir." };
    const n = Number(raw);
    if (n < min || n > max) return { n, err: `${min} ile ${max} arasında olmalı.` };
    return { n, err: null };
  }

  const changes = KEYS.filter((k) => {
    const { n, err } = parse(k);
    if (isBool(k)) return on(k) !== values[k];
    return !err && n !== values[k];
  });
  const show = (k: SettingKey) => {
    if (isBool(k)) return values[k] ? "açık" : "kapalı";
    return `${values[k]} ${SETTING_META[k].unit}`;
  };
  const showNew = (k: SettingKey) => (isBool(k) ? (on(k) ? "açık" : "kapalı") : `${parse(k).n} ${SETTING_META[k].unit}`);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Partial<Record<SettingKey, string>> = {};
    const next: Record<string, number | boolean> = { ...values };
    for (const k of KEYS) {
      if (isBool(k)) {
        next[k] = on(k);
        continue;
      }
      const { n, err } = parse(k);
      if (err || n === null) errs[k] = err ?? "Geçersiz değer.";
      else next[k] = n;
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setMessage({ kind: "error", text: "Bazı alanları kontrol et." });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const r = await updateSettingsAction(next as Settings);
      if (r.ok) {
        setMessage({ kind: "ok", text: changes.length === 0 ? "Değişiklik yoktu." : "Ayarlar kaydedildi." });
        router.refresh();
      } else {
        const fe: Partial<Record<SettingKey, string>> = {};
        for (const [k, v] of Object.entries(r.fields ?? {})) if (KEYS.includes(k as SettingKey)) fe[k as SettingKey] = v;
        setErrors(fe);
        setMessage({ kind: "error", text: r.error });
      }
    });
  }

  return (
    <form onSubmit={submit} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {KEYS.map((k) => {
        const meta = SETTING_META[k];
        const id = `ayar-${k}`;
        if (isBool(k)) {
          const checked = on(k);
          return (
            <div key={k} className="cut-panel" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
                <label htmlFor={id} className="label" style={{ margin: 0 }}>
                  {meta.label}
                </label>
                <button
                  id={id}
                  type="button"
                  role="switch"
                  aria-checked={checked}
                  aria-describedby={`${id}-yardim`}
                  onClick={() => setDraft({ ...draft, [k]: String(!checked) })}
                  style={{
                    minWidth: 76,
                    minHeight: 44,
                    padding: "0 14px",
                    font: "inherit",
                    cursor: "pointer",
                    border: "1px solid var(--btn-line)",
                    background: checked ? "var(--ac-tx)" : "transparent",
                    color: checked ? "var(--bg)" : "var(--ac-tx)",
                  }}
                >
                  {checked ? "Açık" : "Kapalı"}
                </button>
              </div>
              <span id={`${id}-yardim`} className="muted" style={{ fontSize: 13 }}>
                {meta.help}
              </span>
              {errors[k] && <span className="field-error">{errors[k]}</span>}
            </div>
          );
        }
        const { min, max } = bounds(k);
        const isDefault = draft[k].trim() === String(defaults[k]);
        return (
          <div key={k} className="cut-panel" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <label htmlFor={id} className="label">
              {meta.label} ({meta.unit})
            </label>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                id={id}
                className="field"
                type="text"
                inputMode="numeric"
                value={draft[k]}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                aria-describedby={`${id}-yardim${errors[k] ? ` ${id}-hata` : ""}`}
                aria-invalid={errors[k] ? true : undefined}
                style={{ width: 120, minHeight: 44 }}
              />
              <span className="muted" style={{ fontSize: 13 }}>
                Varsayılan: {defaults[k]} · {min}–{max}
              </span>
              <button
                type="button"
                className="btn-ghost"
                style={{ minHeight: 44 }}
                disabled={isDefault}
                onClick={() => setDraft({ ...draft, [k]: String(defaults[k]) })}
              >
                Varsayılana dön
              </button>
            </div>
            <span id={`${id}-yardim`} className="muted" style={{ fontSize: 13 }}>
              {meta.help}
            </span>
            {errors[k] && (
              <span id={`${id}-hata`} className="field-error">
                {errors[k]}
              </span>
            )}
          </div>
        );
      })}

      {changes.length > 0 && (
        <div className="cut-panel" style={{ padding: 14 }}>
          <h2 className="h-wide" style={{ margin: "0 0 8px", fontSize: 16 }}>
            Kaydedilecek değişiklikler
          </h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {changes.map((k) => (
              <li key={k}>
                {SETTING_META[k].label}: {show(k)} → {showNew(k)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <button type="submit" className="btn-solid" style={{ minHeight: 44 }} disabled={pending || changes.length === 0}>
          {pending ? "Kaydediliyor…" : "Kaydet"}
        </button>
      </div>
      <div aria-live="polite" role="status" style={{ minHeight: 22 }}>
        {message && <span className={message.kind === "error" ? "field-error" : undefined}>{message.text}</span>}
      </div>
    </form>
  );
}
