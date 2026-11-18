"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SETTING_META } from "@/lib/contracts/admin";
import { settingsSchema, type SettingKey, type Settings } from "@/lib/contracts/settings";
import { updateSettingsAction } from "./actions";

const KEYS = Object.keys(SETTING_META) as SettingKey[];

function bounds(key: SettingKey): { min: number; max: number } {
  const f = settingsSchema.shape[key];
  return { min: f.minValue ?? 0, max: f.maxValue ?? 9999 };
}

export function SettingsForm({ values, defaults }: { values: Settings; defaults: Settings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<SettingKey, string>>(
    () => Object.fromEntries(KEYS.map((k) => [k, String(values[k])])) as Record<SettingKey, string>,
  );
  const [errors, setErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function parse(k: SettingKey): { n: number | null; err: string | null } {
    const raw = draft[k].trim();
    const { min, max } = bounds(k);
    if (raw === "" || !/^\d+$/.test(raw)) return { n: null, err: "Tam sayı gir." };
    const n = Number(raw);
    if (n < min || n > max) return { n, err: `${min} ile ${max} arasında olmalı.` };
    return { n, err: null };
  }

  const changes = KEYS.filter((k) => {
    const { n, err } = parse(k);
    return !err && n !== values[k];
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Partial<Record<SettingKey, string>> = {};
    const next = { ...values } as Settings;
    for (const k of KEYS) {
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
      const r = await updateSettingsAction(next);
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
        const { min, max } = bounds(k);
        const id = `ayar-${k}`;
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
                {SETTING_META[k].label}: {values[k]} → {parse(k).n} {SETTING_META[k].unit}
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
