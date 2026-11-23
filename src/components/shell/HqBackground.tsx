"use client";

import { useEffect, useRef } from "react";
import "@/styles/hq-background.css";

/**
 * Karargah arka planı: kullanıcının AllSpark küpü hangarı döngü videosu (ping-pong, kesintisiz),
 * hafif bulanık ve karartılmış. Poster (hq-hangar.jpg) ilk kareye kadar ve hata/azaltılmış hareket
 * durumunda gösterilir. Fare ile yalnız transform tabanlı hafif parallax.
 */

const MAX_SHIFT = 0.015; // parallax, görüntü genişliğinin oranı

export function HqBackground() {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const posterRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const video = videoRef.current;
    const poster = posterRef.current;
    if (!stage || !video || !poster) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let vw = window.innerWidth;
    let vh = window.innerHeight;
    let raf = 0;
    let last = 0;
    const tgt = { x: 0, y: 0, on: 0 };
    const cur = { x: 0, y: 0 };
    const par = { x: 0, y: 0 };

    const tryPlay = () => {
      if (reduced.matches || document.hidden) return;
      video.play().catch(() => {});
    };
    const onReady = () => video.classList.add("is-ready");
    const onError = () => video.classList.remove("is-ready");
    if (video.readyState >= 2) onReady();
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("playing", onReady);
    video.addEventListener("error", onError, true); // <source> hataları da yakalanır

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const k = 1 - Math.pow(0.001, dt);
      const nx = tgt.on ? ((cur.x - vw / 2) / vw) * 2 : 0;
      const ny = tgt.on ? ((cur.y - vh / 2) / vh) * 2 : 0;
      cur.x += (tgt.x - cur.x) * k * 0.5;
      cur.y += (tgt.y - cur.y) * k * 0.5;
      par.x += (-nx * vw * MAX_SHIFT - par.x) * k * 0.4;
      par.y += (-ny * vw * MAX_SHIFT - par.y) * k * 0.4;
      stage.style.transform = `translate(-50%, -50%) translate(${par.x.toFixed(2)}px, ${par.y.toFixed(2)}px)`;
      if (!tgt.on && Math.abs(par.x) < 0.05 && Math.abs(par.y) < 0.05) {
        // parallax yerleşti: döngüyü durdur (imleç tekrar oynayınca yeniden başlar)
        stop();
      }
    };
    const startLoop = () => {
      if (raf || reduced.matches || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || reduced.matches) return;
      if (document.documentElement.dataset.intro === "play") return; // açılış sürerken parallax durağan; sonra dinlenmeden başlar
      if (!tgt.on) {
        cur.x = e.clientX;
        cur.y = e.clientY;
      }
      tgt.x = e.clientX;
      tgt.y = e.clientY;
      tgt.on = 1;
      startLoop();
    };
    const onLeave = () => {
      tgt.on = 0;
      startLoop();
    };
    const onResize = () => {
      vw = window.innerWidth;
      vh = window.innerHeight;
    };
    const onVis = () => {
      if (document.hidden) {
        video.pause();
        stop();
      } else {
        tryPlay();
        startLoop();
      }
    };
    const onMotion = () => {
      if (reduced.matches) {
        video.pause();
        stop();
        stage.style.transform = "";
      } else tryPlay();
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    document.addEventListener("visibilitychange", onVis);
    reduced.addEventListener("change", onMotion);
    tryPlay();

    return () => {
      stop();
      video.pause();
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("playing", onReady);
      video.removeEventListener("error", onError, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("visibilitychange", onVis);
      reduced.removeEventListener("change", onMotion);
    };
  }, []);

  return (
    <div className="hq-bg" aria-hidden="true">
      {/* Dış sarmalayıcı: açılış sahnesi (HangarIntro) küp yakın planı / geri çekilmeyi yalnız bunun üzerinden yapar. */}
      <div className="hq-bg__cam">
        <div ref={stageRef} className="hq-bg__stage">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={posterRef}
            className="hq-bg__img"
            src="/hq-hangar.jpg"
            alt=""
            decoding="async"
            draggable={false}
          />
          <video
            ref={videoRef}
            className="hq-bg__video"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            poster="/hq-hangar.jpg"
            aria-hidden="true"
          >
            <source src="/hq-hangar-loop.webm" type="video/webm" />
            <source src="/hq-hangar-loop.mp4" type="video/mp4" />
          </video>
        </div>
      </div>
      <div className="hq-bg__dim" />
      <div className="hq-bg__vignette" />
    </div>
  );
}
