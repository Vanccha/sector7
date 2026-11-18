"use client";
import { useState, useTransition } from "react";
import type { AnnounceAccessRow } from "@/server/announce-access";
import { setCanAnnounceAction } from "./actions";

export function AnnounceAccessList({ rows: initial }: { rows: AnnounceAccessRow[] }) {
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const needle = q.trim().toLocaleLowerCase("tr-TR");
  const shown = needle
    ? rows.filter((r) => `${r.name} ${r.username}`.toLocaleLowerCase("tr-TR").includes(needle))
    : rows;

  function toggle(r: AnnounceAccessRow, value: boolean) {
    start(async () => {
      const res = await setCanAnnounceAction({ userId: r.id, value });
      if (res.ok) {
        setRows((cur) => cur.map((x) => (x.id === r.id ? { ...x, canAnnounce: value } : x)));
        setMsg({ ok: true, text: `${r.name}: duyuru yetkisi ${value ? "verildi" : "kaldırıldı"}.` });
      } else setMsg({ ok: false, text: res.error });
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="field">
        <label className="label" htmlFor="ara">
          Kişi ara
        </label>
        <input id="ara" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad ya da kullanıcı adı" />
      </div>
      <div aria-live="polite" role="status">
        {msg && <span className={msg.ok ? "" : "field-error"}>{msg.text}</span>}
      </div>
      {shown.length === 0 ? (
        <p className="cut-panel" style={{ padding: 20, margin: 0 }}>
          Eşleşen kişi yok.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {shown.map((r) => {
            const on = r.isMainAdmin || r.canAnnounce;
            const label = `${r.name}: duyuru yetkisi`;
            return (
              <li
                key={r.id}
                className="cut-panel"
                style={{ padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
              >
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{r.name}</span>
                  <span className="muted" style={{ fontSize: 13 }}>
                    @{r.username}
                    {r.isMainAdmin ? " · her zaman yazabilir" : ""}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={label}
                  disabled={r.isMainAdmin || pending}
                  onClick={() => toggle(r, !r.canAnnounce)}
                  style={{
                    minWidth: 44,
                    minHeight: 44,
                    background: "none",
                    border: 0,
                    padding: 0,
                    cursor: r.isMainAdmin ? "not-allowed" : "pointer",
                    opacity: r.isMainAdmin ? 0.5 : 1,
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
                      background: on ? "var(--ac)" : "var(--panel)",
                      position: "relative",
                      display: "block",
                      clipPath: "polygon(0 0, calc(100% - 5px) 0, 100% 5px, 100% 100%, 5px 100%, 0 calc(100% - 5px))",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 3,
                        left: on ? 21 : 3,
                        width: 14,
                        height: 14,
                        background: on ? "var(--on-ac)" : "var(--mut)",
                        transition: "left 0.15s",
                      }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
