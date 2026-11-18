import Link from "next/link";
import type { AuditFilter, AuditFilterOptions } from "@/lib/contracts/admin";
import styles from "./Audit.module.css";

/** GET formu: filtreler URL sorgusuna yazılır; istemci kodu gerekmez. */
export function AuditFilters({
  options,
  filter,
  csvHref,
}: {
  options: AuditFilterOptions;
  filter: AuditFilter;
  csvHref: string;
}) {
  const singles = options.actions.filter((a) => !options.actionGroups.some((g) => g.value === a.value));
  return (
    <form method="get" action="/yonetim/denetim" className={`cut-panel ${styles.filters}`} aria-label="Denetim kaydı süzgeci">
      <div className={styles.filterGrid}>
        <div className="field">
          <label className="label" htmlFor="f-kisi">
            Kişi
          </label>
          <select id="f-kisi" name="kisi" className="select" defaultValue={filter.personId ?? ""}>
            <option value="">Hepsi</option>
            {options.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (@{p.username})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="f-alan">
            Alan
          </label>
          <select id="f-alan" name="alan" className="select" defaultValue={filter.areaId ?? ""}>
            <option value="">Hepsi</option>
            {options.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="f-eylem">
            Eylem
          </label>
          <select id="f-eylem" name="eylem" className="select" defaultValue={filter.action ?? ""}>
            <option value="">Hepsi</option>
            <optgroup label="Gruplar">
              {options.actionGroups.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label} (tümü)
                </option>
              ))}
            </optgroup>
            <optgroup label="Tek tek eylemler">
              {singles.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.label}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="field">
          <label className="label" htmlFor="f-ticket">
            Ticket kimliği
          </label>
          <input
            id="f-ticket"
            name="ticket"
            className="input"
            defaultValue={filter.ticketId ?? ""}
            placeholder="uuid"
            pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
            title="Ticket kimliği (uuid) biçiminde olmalı"
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="f-bas">
            Başlangıç tarihi
          </label>
          <input id="f-bas" name="bas" type="date" className="input" defaultValue={filter.from ?? ""} />
        </div>
        <div className="field">
          <label className="label" htmlFor="f-bit">
            Bitiş tarihi
          </label>
          <input id="f-bit" name="bit" type="date" className="input" defaultValue={filter.to ?? ""} />
        </div>
      </div>
      <div className={styles.filterActions}>
        <button type="submit" className="btn-solid">
          Süz
        </button>
        <Link href="/yonetim/denetim" className="btn-ghost">
          Temizle
        </Link>
        <a href={csvHref} className="btn-line" download>
          CSV indir
        </a>
      </div>
    </form>
  );
}
