import Link from "next/link";
import { Countdown } from "@/components/tickets/Countdown";
import type { DashboardView, StatusCounts } from "@/lib/contracts/admin";
import { ROADMAP_STATUS_LABELS } from "@/lib/contracts/plan";
import { APP_TIMEZONE } from "@/lib/contracts/settings";
import { VERDICT_LABELS, type TrackingRow } from "@/lib/contracts/tickets";
import { RequestList } from "../talepler/RequestList";
import s from "./panel.module.css";

const SEGMENTS: { key: keyof Omit<StatusCounts, "overdue" | "total">; label: string; color: string }[] = [
  { key: "draft", label: "Taslak", color: "var(--line2)" },
  { key: "pool", label: "Havuzda", color: "var(--mut)" },
  { key: "offered", label: "Teklifte", color: "var(--ac-hi)" },
  { key: "inProgress", label: "Sürüyor", color: "var(--ac)" },
  { key: "submitted", label: "Teslim edildi", color: "var(--lamp-y)" },
  { key: "evaluated", label: "Değerlendirildi", color: "var(--ok)" },
  { key: "cancelled", label: "İptal", color: "var(--panel2)" },
];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", {
    timeZone: APP_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBar({ counts, small = false, legend = false }: { counts: StatusCounts; small?: boolean; legend?: boolean }) {
  const total = counts.total;
  const summary = SEGMENTS.filter((g) => counts[g.key] > 0)
    .map((g) => `${g.label} ${counts[g.key]}`)
    .join(", ");
  return (
    <div>
      <div
        className={`${s.bar} ${small ? s.barSm : ""}`}
        role="img"
        aria-label={total === 0 ? "Ticket yok" : `Toplam ${total} ticket: ${summary}`}
      >
        {SEGMENTS.map((g) =>
          counts[g.key] > 0 ? (
            <span key={g.key} className={s.seg} style={{ width: `${(counts[g.key] / total) * 100}%`, background: g.color }} />
          ) : null,
        )}
      </div>
      {legend && (
        <ul className={s.legend}>
          {SEGMENTS.map((g) => (
            <li key={g.key}>
              <span className={s.sw} style={{ background: g.color }} aria-hidden="true" />
              {g.label}: <strong>{counts[g.key]}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AttentionCard({ href, n, label, note, cap }: { href: string; n: number; label: string; note?: string; cap?: number }) {
  const hot = n > 0;
  return (
    <li>
      <Link href={href} className={`${s.card} cut-panel ${hot ? s.cardHot : ""}`}>
        <span className={s.cardNum}>{cap !== undefined && n >= cap ? `${cap}+` : n}</span>
        <span className={s.cardLbl}>{label}</span>
        <span className={s.cardNote}>{hot ? (note ?? "Bakmak için aç") : "Şu an yapılacak bir şey yok"}</span>
      </Link>
    </li>
  );
}

function TicketRows({ rows, hint }: { rows: TrackingRow[]; hint?: string }) {
  return (
    <ul className={s.list}>
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/ticket/${r.id}`} className={`${s.row} chip`}>
            <span className={s.rowTitle}>{r.title}</span>
            <span className={s.rowTop}>
              <span>{r.assignee ? r.assignee.name : "Kimse yok"}</span>
              <span>{r.areaName}</span>
              <Countdown countdown={r.countdown} size="sm" />
            </span>
            {hint && <span className={s.hint}>{hint}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Dashboard({ view, now }: { view: DashboardView; now: number }) {
  const { sprint, totals, areas, closingSprints, requests, overdueTickets, inactiveHeld, evaluations, recentActivity } = view;
  const noManager = areas.filter((a) => a.managerMissing).length;
  const closingUndecided = closingSprints.reduce((n, c) => n + c.undecided, 0);
  const closingHref = closingSprints[0] ? `/sprint/${closingSprints[0].sprint.id}/kapanis` : "/yonetim/sprintler";

  return (
    <div className={s.root}>
      <h1 className="h-wide" style={{ margin: 0, fontSize: 24 }}>
        Yönetim paneli
      </h1>

      <section className={`${s.strip} cut-panel`} aria-label="Aktif sprint">
        {sprint ? (
          <>
            <h2 className={`${s.stripName} h-wide`}>{sprint.name}</h2>
            <span>
              Gün {sprint.day} / {sprint.lengthDays}
            </span>
            <span className="muted">{sprint.daysLeft > 0 ? `${sprint.daysLeft} gün kaldı` : "Son gün"}</span>
          </>
        ) : (
          <>
            <h2 className={`${s.stripName} h-wide`}>Aktif sprint yok</h2>
            <Link href="/yonetim/sprintler" className={s.link}>
              Sprintler
            </Link>
          </>
        )}
      </section>

      <section className={s.sec} aria-labelledby="yapilacaklar">
        <h2 id="yapilacaklar" className={`${s.h2} h-wide`}>
          Yapılacaklar
        </h2>
        <ul className={s.cards}>
          <AttentionCard href="/yonetim/talepler" n={requests.overdue} label="Cevap bekleyen talep" note={`Toplam ${requests.pending} bekleyen talep`} />
          <AttentionCard href="#suresi-dolanlar" n={overdueTickets.length} cap={20} label="Süresi dolan ticket" />
          <AttentionCard href="#pasif-kisi" n={inactiveHeld.length} label="Pasif kişide kalan ticket" />
          <AttentionCard href={closingHref} n={closingSprints.length} label="Kapanış kararı bekleyen sprint" note={`${closingUndecided} ticket için karar bekleniyor`} />
          <AttentionCard href="/yonetim/basvurular" n={view.pendingApplications} label="Bekleyen başvuru" />
          <AttentionCard href="/yonetim/roadmapler" n={view.roadmapsAwaiting} label="Onay bekleyen roadmap" />
          <AttentionCard href="/yonetim/alanlar" n={noManager} label="Yöneticisi olmayan alan" />
        </ul>
      </section>

      <section className={s.sec} aria-labelledby="ilerleme">
        <h2 id="ilerleme" className={`${s.h2} h-wide`}>
          Sprint ilerlemesi
        </h2>
        {sprint ? (
          <div className="cut-panel" style={{ padding: 16 }}>
            <StatusBar counts={totals} legend />
            <p style={{ margin: "12px 0 0", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span>Toplam {totals.total} ticket</span>
              {totals.overdue > 0 ? (
                <span className={s.badge}>Süresi dolan: {totals.overdue}</span>
              ) : (
                <span className={`${s.badge} ${s.badgeMut}`}>Süresi dolan yok</span>
              )}
            </p>
          </div>
        ) : (
          <p className={`${s.empty} cut-panel`}>Aktif sprint olmadığı için gösterilecek ilerleme yok.</p>
        )}
      </section>

      <section className={s.sec} aria-labelledby="alanlar">
        <h2 id="alanlar" className={`${s.h2} h-wide`}>
          Alanlar
        </h2>
        {areas.length === 0 ? (
          <p className={`${s.empty} cut-panel`}>Henüz alan yok.</p>
        ) : (
          <>
            <table className={s.table}>
              <caption style={{ position: "absolute", left: -9999 }}>Alanların durumu</caption>
              <thead>
                <tr>
                  <th scope="col">Alan</th>
                  <th scope="col">Yönetici</th>
                  <th scope="col">Durum</th>
                  <th scope="col">Sürüyor / süresi dolan</th>
                  <th scope="col">Talep (bekleyen / cevapsız)</th>
                  <th scope="col">Değerlendirme bekleyen</th>
                  <th scope="col">Roadmap</th>
                </tr>
              </thead>
              <tbody>
                {areas.map((a) => (
                  <tr key={a.id}>
                    <th scope="row">
                      <Link href={`/alan/${a.id}/takip`} className={s.areaName}>
                        {a.name}
                      </Link>
                    </th>
                    <td>{a.manager && !a.managerMissing ? a.manager.name : <span className={s.warn}>Yönetici yok</span>}</td>
                    <td style={{ minWidth: 140 }}>
                      <StatusBar counts={a.counts} small />
                    </td>
                    <td>
                      {a.counts.inProgress} / {a.counts.overdue}
                    </td>
                    <td>
                      {a.pendingRequests} / {a.overdueRequests}
                    </td>
                    <td>{a.toEvaluate}</td>
                    <td>{a.roadmapStatus ? ROADMAP_STATUS_LABELS[a.roadmapStatus] : "Yok"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className={`${s.list} ${s.areaCards}`}>
              {areas.map((a) => (
                <li key={a.id} className={`${s.areaCard} cut-panel`}>
                  <Link href={`/alan/${a.id}/takip`} className={s.areaName}>
                    {a.name}
                  </Link>
                  {a.manager && !a.managerMissing ? (
                    <span className={s.hint}>Yönetici: {a.manager.name}</span>
                  ) : (
                    <span className={s.warn}>Yönetici yok</span>
                  )}
                  <StatusBar counts={a.counts} small />
                  <div className={s.kv}>
                    <span>Sürüyor: {a.counts.inProgress}</span>
                    <span>Süresi dolan: {a.counts.overdue}</span>
                    <span>Bekleyen talep: {a.pendingRequests}</span>
                    <span>Cevapsız talep: {a.overdueRequests}</span>
                    <span>Değerlendirme bekleyen: {a.toEvaluate}</span>
                    <span>Roadmap: {a.roadmapStatus ? ROADMAP_STATUS_LABELS[a.roadmapStatus] : "Yok"}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className={s.sec} aria-labelledby="talepler">
        <h2 id="talepler" className={`${s.h2} h-wide`}>
          Talepler
        </h2>
        {requests.items.length === 0 ? (
          <p className={`${s.empty} cut-panel`}>Şu an bekleyen talep yok.</p>
        ) : (
          <>
            <RequestList rows={requests.items} now={now} />
            <Link href="/yonetim/talepler" className={s.link}>
              Tüm talepler
            </Link>
          </>
        )}
      </section>

      <div className={s.twoCol}>
        <section className={s.sec} aria-labelledby="suresi-baslik" id="suresi-dolanlar">
          <h2 id="suresi-baslik" className={`${s.h2} h-wide`}>
            Süresi dolan ticket&apos;lar
          </h2>
          {overdueTickets.length === 0 ? <p className={`${s.empty} cut-panel`}>Süresi dolan ticket yok.</p> : <TicketRows rows={overdueTickets} />}
        </section>
        <section className={s.sec} aria-labelledby="pasif-baslik" id="pasif-kisi">
          <h2 id="pasif-baslik" className={`${s.h2} h-wide`}>
            Pasif kişide kalanlar
          </h2>
          {inactiveHeld.length === 0 ? (
            <p className={`${s.empty} cut-panel`}>Pasif kişide kalan ticket yok.</p>
          ) : (
            <TicketRows rows={inactiveHeld} hint="Ticket sayfasından havuza geri alabilirsin." />
          )}
        </section>
      </div>

      <section className={s.sec} aria-labelledby="degerlendirmeler">
        <h2 id="degerlendirmeler" className={`${s.h2} h-wide`}>
          Değerlendirmeler
        </h2>
        <div className="cut-panel" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className={s.stats}>
            <div className={s.stat}>
              <span className={s.statNum}>{evaluations.good}</span>
              <span className="muted">{VERDICT_LABELS.good}</span>
            </div>
            <div className={s.stat}>
              <span className={s.statNum}>{evaluations.bad}</span>
              <span className="muted">{VERDICT_LABELS.bad}</span>
            </div>
          </div>
          <p className={s.hint} style={{ margin: 0 }}>
            Bu sprintin sayıları. Puan yoktur; &quot;kötü oldu&quot; bir ceza değildir, yalnız bir sonraki adım için bilgidir.
          </p>
        </div>
        {evaluations.recent.length > 0 && (
          <ul className={s.list}>
            {evaluations.recent.map((e) => (
              <li key={`${e.ticketId}-${e.createdAt}`}>
                <Link href={`/ticket/${e.ticketId}`} className={`${s.row} chip`}>
                  <span className={s.rowTitle}>{e.ticketTitle}</span>
                  <span className={s.rowTop}>
                    <strong>{VERDICT_LABELS[e.verdict]}</strong>
                    <span>{e.areaName}</span>
                    <span>Üstlenen: {e.assignee ? e.assignee.name : "—"}</span>
                    <span>Değerlendiren: {e.evaluator.name}</span>
                    <span className={s.time}>{fmtTime(e.createdAt)}</span>
                  </span>
                  {e.comment && <span className={s.hint}>{e.comment.length > 140 ? `${e.comment.slice(0, 140)}…` : e.comment}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.sec} aria-labelledby="son-islemler">
        <h2 id="son-islemler" className={`${s.h2} h-wide`}>
          Son işlemler
        </h2>
        {recentActivity.length === 0 ? (
          <p className={`${s.empty} cut-panel`}>Henüz kayıt yok.</p>
        ) : (
          <ul className={s.list}>
            {recentActivity.map((r) => (
              <li key={r.id} className={`${s.row} cut-panel`}>
                <span className={s.rowTop}>
                  <span className={s.time}>{fmtTime(r.createdAt)}</span>
                  <strong>{r.actor ? r.actor.name : "Sistem"}</strong>
                  <span>{r.actionLabel}</span>
                </span>
                <span className={s.rowTop}>
                  {r.ticket && (
                    <Link href={`/ticket/${r.ticket.id}`} className={s.link}>
                      {r.ticket.title}
                    </Link>
                  )}
                  {r.area && (
                    <Link href={`/alan/${r.area.id}/takip`} className={s.link}>
                      {r.area.name}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Link href="/yonetim/denetim" className={s.link}>
          Tüm denetim kaydı
        </Link>
      </section>
    </div>
  );
}
