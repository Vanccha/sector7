"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { StepRow } from "@/lib/contracts/plan";

type Drag = { id: string; dy: number; slot: number };
type Grab = { id: string; order: string[] };

/**
 * Basamak sıralama: Pointer Events ile sürükle-bırak (fare + dokunma; tutamaçta touch-action:none)
 * ve klavye (Boşluk al, ok taşı, Boşluk/Enter bırak, Esc iptal). Bırakınca `save(ids, onFail)` tek kez çağrılır;
 * iyimser sıra sunucudan yeni liste gelince ya da hata olunca bırakılır.
 */
export function useStepReorder({
  steps,
  enabled,
  save,
}: {
  steps: StepRow[];
  enabled: boolean;
  save: (ids: string[], onFail: () => void) => void;
}) {
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const [seen, setSeen] = useState(steps);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [grab, setGrab] = useState<Grab | null>(null);
  const [announce, setAnnounce] = useState("");
  const items = useRef(new Map<string, HTMLElement>());
  const handles = useRef(new Map<string, HTMLElement>());
  const origin = useRef({ y: 0, scroll: 0, lastY: 0 });
  const dragRef = useRef<Drag | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  if (seen !== steps) {
    setSeen(steps);
    setOptimistic(null);
  }

  const byId = new Map(steps.map((s) => [s.id, s]));
  const validOpt = optimistic && optimistic.length === steps.length && optimistic.every((id) => byId.has(id));
  const baseIds = validOpt ? optimistic : steps.map((s) => s.id);
  const shownIds = grab?.order ?? baseIds;
  const ordered = shownIds.map((id) => byId.get(id)).filter((s): s is StepRow => !!s);

  useLayoutEffect(() => {
    if (grab) handles.current.get(grab.id)?.focus();
  }, [grab]);
  useEffect(() => {
    const t = timer;
    return () => {
      if (t.current) clearInterval(t.current);
    };
  }, []);

  const titleOf = (id: string) => byId.get(id)?.title ?? "Basamak";

  function commit(ids: string[], movedId: string) {
    if (ids.every((id, i) => id === baseIds[i])) return;
    setOptimistic(ids);
    setAnnounce(`${titleOf(movedId)}, ${ids.indexOf(movedId) + 1}. sıraya taşındı.`);
    save(ids, () => {
      setOptimistic(null);
      setAnnounce("Sıralama kaydedilemedi; önceki sıraya dönüldü.");
    });
  }

  function slotFor(draggedId: string, clientY: number) {
    let slot = 0;
    for (const id of baseIds) {
      if (id === draggedId) continue;
      const r = items.current.get(id)?.getBoundingClientRect();
      if (r && clientY > r.top + r.height / 2) slot++;
    }
    return slot;
  }
  function update(id: string, clientY: number) {
    const dy = clientY - origin.current.y + (window.scrollY - origin.current.scroll);
    const next = { id, dy, slot: slotFor(id, clientY) };
    dragRef.current = next;
    setDrag(next);
  }
  function stopTimer() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }
  function end(id: string, apply: boolean) {
    stopTimer();
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!apply || !d) return;
    const others = baseIds.filter((x) => x !== id);
    commit([...others.slice(0, d.slot), id, ...others.slice(d.slot)], id);
  }

  function handleKey(e: React.KeyboardEvent, id: string) {
    if (!grab) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setGrab({ id, order: baseIds });
        setAnnounce(
          `${titleOf(id)} alındı, ${baseIds.indexOf(id) + 1}. sırada. Ok tuşlarıyla taşı, Boşluk ile bırak, Esc ile vazgeç.`,
        );
      }
      return;
    }
    if (grab.id !== id) return;
    const i = grab.order.indexOf(id);
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const t = i + (e.key === "ArrowUp" ? -1 : 1);
      if (t < 0 || t >= grab.order.length) return;
      const order = [...grab.order];
      order.splice(i, 1);
      order.splice(t, 0, id);
      setGrab({ id, order });
      setAnnounce(`${t + 1}. sıraya taşındı.`);
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const order = grab.order;
      setGrab(null);
      commit(order, id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setGrab(null);
      setAnnounce("Taşıma iptal edildi.");
    }
  }

  function handleProps(id: string) {
    return {
      grabbed: drag?.id === id || grab?.id === id,
      attach: (el: HTMLButtonElement | null) => {
        if (el) handles.current.set(id, el);
        else handles.current.delete(id);
      },
      onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = { y: e.clientY, scroll: window.scrollY, lastY: e.clientY };
        setAnnounce("");
        update(id, e.clientY);
        // Kenara yaklaşınca sayfayı kaydır.
        timer.current = setInterval(() => {
          const d = dragRef.current;
          if (!d) return;
          const y = origin.current.lastY;
          if (y < 70) window.scrollBy(0, -14);
          else if (y > window.innerHeight - 70) window.scrollBy(0, 14);
          else return;
          update(d.id, y);
        }, 16);
      },
      onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
        if (dragRef.current?.id !== id) return;
        origin.current.lastY = e.clientY;
        update(id, e.clientY);
      },
      onPointerUp: () => end(id, true),
      onPointerCancel: () => end(id, false),
      onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => handleKey(e, id),
      onBlur: () => {
        if (grab?.id === id) {
          setGrab(null);
          setAnnounce("Taşıma iptal edildi.");
        }
      },
    };
  }

  const others = drag ? baseIds.filter((x) => x !== drag.id) : [];
  const dropBeforeId = drag ? (others[drag.slot] ?? null) : null;
  const dropEndId = drag && dropBeforeId === null ? (others[others.length - 1] ?? null) : null;

  return {
    ordered,
    announce,
    drag,
    grabId: grab?.id ?? null,
    dropBeforeId,
    dropEndId,
    /** Sürükleme/klavye taşıması sürüyor mu (canlı yenileme ertelensin). */
    isBusy: () => dragRef.current !== null || grab !== null,
    registerItem: (id: string) => (el: HTMLElement | null) => {
      if (el) items.current.set(id, el);
      else items.current.delete(id);
    },
    handleProps: enabled ? handleProps : null,
  };
}
