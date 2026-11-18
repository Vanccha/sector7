"use client";
import { useSyncExternalStore } from "react";
import type { TicketRef, TicketRow } from "@/lib/contracts/plan";
import { DependencyEditor } from "./DependencyEditor";
import styles from "./Dependency.module.css";
import { DependencyList } from "./DependencyList";

const QUERY = "(min-width: 900px)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export type DependencyProps = {
  tickets: TicketRow[];
  externalPrerequisites: TicketRef[];
  canEdit: boolean;
};

/** Geniş ekranda görsel düzenleyici, dar ekranda liste. Sunucu ve ilk istemci çıktısı liste (uyumsuzluk yok). */
export function DependencyWorkspace(props: DependencyProps) {
  const wide = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
  return (
    <>
      <p className={`notice ${styles.banner}`} role="note">
        Bağlantı yok = paralel: yayınlanınca hemen havuza çıkar. Sıralı iş, ön koşulu teslim edilince kendiliğinden
        alınabilir olur.
      </p>
      {wide ? <DependencyEditor {...props} /> : <DependencyList {...props} />}
    </>
  );
}
