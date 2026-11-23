"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { Mark } from "./Brand";
import { DoorArt, HangarDefs, PlateText } from "./HangarDoorArt";
import "@/styles/hangar-intro.css";

/**
 * Hangar kapısı açılış sahnesi (~5 sn). Köke bağlanır; hem açık hem oturumlu sayfaları kapsar.
 *
 * - Sekme oturumu başına bir kez oynar (sessionStorage "s7-intro"). Yeniden oynatmak için `?intro=1`.
 * - HANGAR_INTRO_INIT (hangar-intro-init.ts, layout <head>) boyamadan önce <html data-intro="play|seen"> koyar:
 *   ilk ziyarette uygulama kısa süre bile görünmez, sonraki ziyaretlerde örtü hiç boyanmaz (CSS gizler).
 * - prefers-reduced-motion: animasyon yok, örtü hiç gösterilmez.
 * - Tıkla / dokun / Escape / herhangi bir tuş: hızlı soluşla bitirir. 8 sn güvenlik zamanlayıcısı örtüyü kaldırır.
 * - Bitince örtü DOM'dan çıkar, <html class="intro-done"> eklenir (başlık menüsü sırayla belirir).
 * - Hata ayıklama: `?introT=<ms>` zaman çizelgesini o ana dondurur (örn. 500 kapalı kapı, 1900 açılış,
 *   2800 küp, 4000 yükleme). Zararsızdır; örtüyü otomatik bitirmez, yalnız dondurulmuş karede tutar.
 * - Giriş kapısı: örtü kapalı kapıyla BEKLER ("BAŞLATMAK İÇİN TIKLA"); tıklama/Enter/Boşluk sesi ve kapıyı başlatır
 *   (tarayıcı sesli otomatik oynatmayı hareket olmadan engeller). Esc / ATLA sessiz atlar. Başlayınca atlama sesi 200 ms'de
 *   kısıp durdurur; `?introT=` kapıyı atlar ve sessizdir. Örtü arkasındaki uygulama `inert` tutulur.
 * - Kapı dokusu (HangarDoorArt.tsx) statik SVG'dir; ağır filtreler bir kez çizilir, animasyon yalnız transform/opacity.
 */

const SEGMENTS = 24;
const FAILSAFE_MS = 8000;
const SKIP_MS = 320;
const SND_SRC = "/audio/welcome-the-allspark.mp3";
const SEEK_MS = 700; // tıklamada zaman çizelgesi bu kadar ileri sarılır (kilit öncesi ~0.3 sn kalır)

const STATUS = [
  "Sistem başlatılıyor",
  "Alanlar yükleniyor",
  "Kıvılcım hattı bağlanıyor",
  "Hazır",
];

/** Derzden çıkan buhar: dikeyde dağılmış (y %, boyut px, gecikme sn, yatay sürüklenme px). */
const PUFFS: { y: number; s: number; d: number; dx: number }[] = [
  { y: 14, s: 170, d: 0.0, dx: -70 },
  { y: 24, s: 210, d: 0.12, dx: 80 },
  { y: 36, s: 240, d: 0.05, dx: -100 },
  { y: 46, s: 220, d: 0.3, dx: 90 },
  { y: 58, s: 250, d: 0.1, dx: -80 },
  { y: 68, s: 210, d: 0.22, dx: 70 },
  { y: 78, s: 190, d: 0.4, dx: -60 },
  { y: 88, s: 220, d: 0.15, dx: 90 },
];
/** Kıvılcım (derz boyunca; dikey %, yatay/dikey uçuş px, gecikme sn). */
const SPARKS = [
  { y: 22, dx: -90, dy: 60, d: 0.0 },
  { y: 30, dx: 110, dy: 80, d: 0.2 },
  { y: 62, dx: -120, dy: 70, d: 0.1 },
  { y: 70, dx: 90, dy: 110, d: 0.35 },
  { y: 78, dx: -70, dy: 120, d: 0.5 },
  { y: 84, dx: 130, dy: 90, d: 0.25 },
  { y: 40, dx: 70, dy: 50, d: 0.6 },
  { y: 54, dx: -60, dy: 60, d: 0.45 },
];
const DUST = Array.from({ length: 16 }, (_, i) => ({
  x: 4 + ((i * 37) % 92),
  d: (i % 7) * 0.12,
  s: 2 + (i % 3),
  f: 0.8 + (i % 5) * 0.18,
}));

const noopSubscribe = () => () => {};
const readSeen = () => document.documentElement.dataset.intro === "seen";

function Lockup() {
  return (
    <div className="hi__lockup">
      <PlateText>
        <div className="hi__mark">
          <Mark size={150} />
          <i className="hi__scan" />
        </div>
      </PlateText>
    </div>
  );
}

function Leaf({ side }: { side: "l" | "r" }) {
  return (
    <div className={`hi__leaf hi__leaf--${side}`}>
      <div className="hi__face">
        <DoorArt side={side} />
        <i className="hi__tex" />
        <i className="hi__amb" />
        <i className="hi__haze" />
        <Lockup />
        <i className="hi__rim" />
        <div className="hi__lamps">
          {[0, 1, 2].map((i) => (
            <i
              key={i}
              className="hi__lamp"
              style={{ "--i": i } as CSSProperties}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function HangarIntro() {
  // Sunucuda ve hidrasyonda false (örtü basılır); istemcide "seen" ise örtü hiç oluşmaz.
  const seen = useSyncExternalStore(noopSubscribe, readSeen, () => false);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(false);
  const [gateReady, setGateReady] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const gateRef = useRef<HTMLButtonElement>(null);
  const ctl = useRef<{ start: () => void; skipGate: () => void } | null>(null);

  useEffect(() => {
    const html = document.documentElement;
    const root = rootRef.current;
    if (!root || html.dataset.intro !== "play") return;

    const markSeen = () => {
      try {
        sessionStorage.setItem("s7-intro", "1");
      } catch {
        /* depolama kapalı: yalnız bu sayfa yüklemesinde oynar */
      }
    };

    const debug = new URLSearchParams(location.search).get("introT");
    if (debug !== null && Number.isFinite(Number(debug))) {
      markSeen();
      root.classList.remove("hi--held");
      root.classList.add("hi--debug");
      window.setTimeout(() => setStarted(true), 0); // dondurulmuş karede giriş düğmeleri görünmez
      html.classList.add("intro-run");
      document
        .querySelector(".hq-bg__cam")
        ?.getAnimations()
        .forEach((a) => {
          a.pause();
          a.currentTime = Number(debug);
        });
      // her animasyonu durdurup küresel zaman T'ye (kendi gecikmesi dahil) sarar
      root.getAnimations({ subtree: true }).forEach((a) => {
        a.pause();
        a.currentTime = Number(debug);
      });
      return;
    }

    // gerçek arka plan videosu (HqBackground) kapı açılmadan hazır olsun: hazır ya da en çok ~2 sn beklenir
    let ready = false;
    const video = document.querySelector<HTMLVideoElement>(".hq-bg video");
    const markReady = () => {
      if (ready) return;
      ready = true;
      setGateReady(true);
      requestAnimationFrame(() => gateRef.current?.focus());
    };
    let finished = false;
    let phase: "held" | "run" = "held";
    const timers: number[] = [];

    // örtünün arkasındaki uygulama etkileşimsiz (odak/klavye dahil) kalır
    const behind = Array.from(document.body.children).filter(
      (el) =>
        el !== root &&
        el.tagName !== "SCRIPT" &&
        el.tagName !== "NOSCRIPT" &&
        !el.hasAttribute("inert"),
    );
    behind.forEach((el) => el.setAttribute("inert", ""));

    // --- ses: yalnız tıklama hareketiyle başlar ---
    const audio = new Audio(SND_SRC);
    audio.preload = "auto";
    audio.volume = 0.8;
    audio.load();
    let fade = 0;
    const stopAudio = () => {
      clearInterval(fade);
      audio.pause();
    };
    const fadeOut = () => {
      if (audio.paused) return;
      const v0 = audio.volume;
      let n = 0;
      clearInterval(fade);
      fade = window.setInterval(() => {
        n++;
        audio.volume = Math.max(0, v0 * (1 - n / 5));
        if (n >= 5) stopAudio();
      }, 40);
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      timers.forEach(clearTimeout);
      stopAudio();
      behind.forEach((el) => el.removeAttribute("inert"));
      html.dataset.intro = "done";
      html.classList.remove("intro-run");
      html.classList.add("intro-done");
      window.setTimeout(() => html.classList.remove("intro-done"), 2200);
      setDone(true);
    };
    const skipNow = () => {
      if (finished || root.classList.contains("is-skip")) return;
      markSeen();
      root.classList.remove("hi--held");
      root.classList.add("is-skip");
      fadeOut();
      timers.push(window.setTimeout(finish, SKIP_MS + 30));
    };
    const onEnd = (e: AnimationEvent) => {
      if (e.target === root && e.animationName === "hi-out") finish();
    };

    const start = () => {
      if (phase !== "held" || finished || !ready) return;
      phase = "run";
      markSeen();
      // ses: hareketin içinde, eşzamanlı başlatılır (otomatik oynatma izni için)
      audio.play().catch(() => {});
      root.classList.remove("hi--held");
      html.classList.add("intro-run"); // gerçek arka planın kamera animasyonu da başlar
      document
        .querySelector(".hq-bg__cam")
        ?.getAnimations()
        .forEach((a) => (a.currentTime = SEEK_MS));
      // kapı zaman çizelgesi: kilit/takılma öncesini kısaltmak için ileri sar
      root.getAnimations({ subtree: true }).forEach((a) => {
        if (a.effect?.getComputedTiming().iterations !== Infinity)
          a.currentTime = SEEK_MS;
      });
      setStarted(true);
      root.addEventListener("animationend", onEnd);
      timers.push(
        window.setTimeout(() => {
          window.addEventListener("pointerdown", skipNow, true);
          window.addEventListener("keydown", skipNow, true);
        }, 0),
      );
      timers.push(window.setTimeout(finish, FAILSAFE_MS));
    };
    ctl.current = { start, skipGate: skipNow };
    if (!video || video.readyState >= 3)
      timers.push(window.setTimeout(markReady, 0));
    else {
      video.addEventListener("canplay", markReady, { once: true });
      timers.push(window.setTimeout(markReady, 2000));
    }

    const onKey = (e: KeyboardEvent) => {
      if (phase !== "held") return;
      if (e.key === "Escape") {
        e.preventDefault();
        skipNow();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", skipNow, true);
      window.removeEventListener("keydown", skipNow, true);
      root.removeEventListener("animationend", onEnd);
      timers.forEach(clearTimeout);
      ctl.current = null;
      stopAudio();
      behind.forEach((el) => el.removeAttribute("inert"));
    };
  }, []);

  if (seen || done) return null;

  return (
    <>
      <noscript>
        <style>{".hi{display:none}"}</style>
      </noscript>
      <div
        ref={rootRef}
        className="hi hi--held"
        aria-hidden={started ? true : undefined}
        onClick={() => ctl.current?.start()}
      >
        <HangarDefs />
        <i className="hi__spill" />
        <i className="hi__glow" />
        <Leaf side="l" />
        <Leaf side="r" />
        <div className="hi__steam">
          {PUFFS.map((p, i) => (
            <i
              key={i}
              className="hi__puff"
              style={
                {
                  "--y": `${p.y}%`,
                  "--s": `${p.s}px`,
                  "--d": `${p.d}s`,
                  "--dx": `${p.dx}px`,
                } as CSSProperties
              }
            />
          ))}
          {SPARKS.map((p, i) => (
            <i
              key={`s${i}`}
              className="hi__spark"
              style={
                {
                  "--y": `${p.y}%`,
                  "--dx": `${p.dx}px`,
                  "--dy": `${p.dy}px`,
                  "--d": `${p.d}s`,
                } as CSSProperties
              }
            />
          ))}
        </div>
        {/* üst ray gövdesi (sabit): işaret ışıkları, çalışma lambaları, düşen toz */}
        <div className="hi__track">
          {[9, 27, 44, 56, 73, 91].map((x, i) => (
            <i
              key={x}
              className="hi__led-t"
              style={{ "--x": `${x}%`, "--d": `${-i * 0.8}s` } as CSSProperties}
            />
          ))}
          <div className="hi__dust">
            {DUST.map((p, i) => (
              <i
                key={i}
                style={
                  {
                    "--x": `${p.x}%`,
                    "--d": `${p.d}s`,
                    "--s": `${p.s}px`,
                    "--f": `${p.f}`,
                  } as CSSProperties
                }
              />
            ))}
          </div>
        </div>
        <i className="hi__jamb hi__jamb--l" />
        <i className="hi__jamb hi__jamb--r" />
        <div className="hi__sill" />
        {!started && (
          <>
            <button
              type="button"
              ref={gateRef}
              className={`hi__gate${gateReady ? "" : " is-wait"}`}
              onClick={(e) => {
                e.stopPropagation();
                ctl.current?.start();
              }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M3 9v6h4l5 4V5L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" />
              </svg>
              BAŞLATMAK İÇİN TIKLA
              <i className="hi__gate-line" />
            </button>
            <button
              type="button"
              className="hi__skip"
              onClick={(e) => {
                e.stopPropagation();
                ctl.current?.skipGate();
              }}
            >
              ATLA
            </button>
          </>
        )}
        <div className="hi__hud">
          <div className="hi__hud-top">
            <span>
              <i className="hi__tick" />
              MENÜ YÜKLENİYOR
            </span>
            <span className="hi__pct" />
          </div>
          <div className="hi__bar">
            {Array.from({ length: SEGMENTS }, (_, i) => (
              <i
                key={i}
                className="hi__seg"
                style={{ "--i": i } as CSSProperties}
              />
            ))}
          </div>
          <div className="hi__status">
            {STATUS.map((s, k) => (
              <span key={s} style={{ "--k": k } as CSSProperties}>
                {"> "}
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
