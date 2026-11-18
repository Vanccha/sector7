"use client";
import { useState, useTransition } from "react";
import { setNotificationPrefsAction } from "@/app/(app)/bildirimler/actions";
import type { NotificationPref } from "@/lib/contracts/notifications";

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        minWidth: 44,
        minHeight: 44,
        background: "none",
        border: 0,
        padding: 0,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 40,
          height: 22,
          border: "1px solid var(--btn-line)",
          background: checked ? "var(--ac)" : "var(--panel)",
          position: "relative",
          display: "block",
          clipPath: "polygon(0 0, calc(100% - 5px) 0, 100% 5px, 100% 100%, 5px 100%, 0 calc(100% - 5px))",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 14,
            height: 14,
            background: checked ? "var(--on-ac)" : "var(--mut)",
            transition: "left 0.15s",
          }}
        />
      </span>
    </button>
  );
}

export function PrefsForm({ prefs: initial }: { prefs: NotificationPref[] }) {
  const [prefs, setPrefs] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function set(type: string, key: "inApp" | "push", v: boolean) {
    setPrefs((cur) => cur.map((p) => (p.type === type ? { ...p, [key]: v } : p)));
    setDirty(true);
    setMsg(null);
  }

  function save() {
    start(async () => {
      const r = await setNotificationPrefsAction({ prefs: prefs.map(({ type, inApp, push }) => ({ type, inApp, push })) });
      if (r.ok) {
        setDirty(false);
        setMsg({ ok: true, text: "Tercihlerin kaydedildi." });
      } else setMsg({ ok: false, text: r.error });
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {prefs.map((p) => (
          <li
            key={p.type}
            className="cut-panel"
            style={{
              padding: "10px 14px",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
            }}
          >
            <span style={{ flex: "1 1 220px", fontWeight: 600 }}>{p.label}</span>
            <span style={{ display: "flex", gap: 16 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                <span className="muted" style={{ fontSize: 13 }} aria-hidden="true">
                  Uygulama içi
                </span>
                <Switch checked={p.inApp} onChange={(v) => set(p.type, "inApp", v)} label={`${p.label}: uygulama içi`} />
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                <span className="muted" style={{ fontSize: 13 }} aria-hidden="true">
                  Push
                </span>
                <Switch checked={p.push} onChange={(v) => set(p.type, "push", v)} label={`${p.label}: push`} />
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="btn-solid" disabled={pending || !dirty}>
          Kaydet
        </button>
        <div aria-live="polite" role="status">
          {msg && <span className={msg.ok ? "" : "field-error"}>{msg.text}</span>}
        </div>
      </div>
    </form>
  );
}
