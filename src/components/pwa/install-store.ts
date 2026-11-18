import { useCallback, useSyncExternalStore } from "react";

type DeferredPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallState = "installed" | "native" | "ios" | "unavailable";
export type InstallResult = "accepted" | "dismissed" | "unavailable";

let deferred: DeferredPrompt | null = null;
let installed = false;
let standalone = false;
let ios = false;
let state: InstallState = "unavailable";
const listeners = new Set<() => void>();
let started = false;

function compute(): InstallState {
  if (installed || standalone) return "installed";
  if (deferred) return "native";
  if (ios) return "ios";
  return "unavailable";
}

function update() {
  const next = compute();
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
}

function detectStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
}

function detectIosSafari(): boolean {
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isIos && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  standalone = detectStandalone();
  ios = detectIosSafari();
  state = compute();

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as DeferredPrompt;
    update();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    update();
  });
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", () => {
    standalone = detectStandalone();
    update();
  });
}

// Olay erken yakalansın diye modül ilk yüklendiğinde istemcide kurulur.
start();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
const getSnapshot = (): InstallState => state;
const getServerSnapshot = (): InstallState => "unavailable";

async function install(): Promise<InstallResult> {
  const d = deferred;
  if (!d) return "unavailable";
  let outcome: InstallResult = "dismissed";
  try {
    await d.prompt();
    outcome = (await d.userChoice).outcome;
  } catch {
    /* kullanıcı vazgeçti */
  }
  // Ertelenen olay tek kullanımlık.
  deferred = null;
  if (outcome === "accepted") installed = true;
  update();
  return outcome;
}

export function useInstall(): { state: InstallState; install: () => Promise<InstallResult> } {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const run = useCallback(() => install(), []);
  return { state: s, install: run };
}
