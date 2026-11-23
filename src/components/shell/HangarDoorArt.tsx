import type { CSSProperties, ReactNode } from "react";
import { WORDMARK, TAGLINE } from "./logoPaths";

/**
 * Hangar kapısı görselleri: tamamı SATIR İÇİ SVG, çalışma anında hesaplanmaz.
 * Ağır filtreler (feTurbulence, aydınlatma, yer değiştirme) yalnız statik katmanlarda bir kez çizilir;
 * kapı kanadı kompozit katmandır, animasyonda yalnız transform/opacity değişir.
 * Konumlar iç kenardan (derz) uzaklık olarak verilir; sol kanatta iç kenar x=720, sağda x=0.
 */

const W = 720;
const H = 1000;

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F = { filterUnits: "userSpaceOnUse", x: 0, y: 0, width: W, height: H } as const;

/** Ortak tanımlar: kapı, yazı ve filtreler. Örtü içinde bir kez basılır. */
export function HangarDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <defs>
        {/* --- yazı: logo görselinden izlenen şekiller --- */}
        <path id="hi-wm" d={WORDMARK.d} fillRule="evenodd" clipRule="evenodd" />
        <path id="hi-tg" d={TAGLINE.d} fillRule="evenodd" clipRule="evenodd" />
        <linearGradient id="hi-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#aab6d2" />
          <stop offset="0.5" stopColor="#6d7a9b" />
          <stop offset="1" stopColor="#38425e" />
        </linearGradient>

        {/* kazınmış/kabartma metal: bulanık alfa → yükseklik haritası, ışık yukarıdan; çok hafif talaş */}
        <filter id="hi-metal" x="-3%" y="-12%" width="106%" height="124%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceAlpha" stdDeviation="1.1" result="h" />
          <feDiffuseLighting in="h" surfaceScale="4" diffuseConstant="1.15" lightingColor="#ffffff" result="dif">
            <feDistantLight azimuth="250" elevation="55" />
          </feDiffuseLighting>
          <feSpecularLighting in="h" surfaceScale="4" specularConstant="1" specularExponent="24" lightingColor="#cfdcff" result="spec">
            <feDistantLight azimuth="250" elevation="44" />
          </feSpecularLighting>
          <feComposite in="SourceGraphic" in2="dif" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="shaded" />
          <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="4" result="n" />
          <feColorMatrix in="n" type="matrix" values="0.34 0 0 0 0.74  0.34 0 0 0 0.74  0.34 0 0 0 0.74  0 0 0 0 1" result="wear" />
          <feComposite in="shaded" in2="wear" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="worn" />
          <feComposite in="worn" in2="SourceAlpha" operator="in" result="worn2" />
          <feComposite in="spec" in2="SourceAlpha" operator="in" result="spec2" />
          <feComposite in="worn2" in2="spec2" operator="arithmetic" k1="0" k2="1" k3="0.45" k4="0" result="lit" />
          <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed="11" result="c" />
          <feColorMatrix in="c" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  16 0 0 0 -10.4" result="chip" />
          <feComposite in="lit" in2="chip" operator="out" />
        </filter>

        {/* --- kapı yüzeyi: gece mavisi / soğuk çelik --- */}
        <linearGradient id="hi-slab" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d2538" />
          <stop offset="1" stopColor="#0d1220" />
        </linearGradient>
        <linearGradient id="hi-panel" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#0e1424" />
          <stop offset="0.6" stopColor="#131a2d" />
          <stop offset="1" stopColor="#1a2238" />
        </linearGradient>
        <linearGradient id="hi-beam-h" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#51618a" />
          <stop offset="0.12" stopColor="#34405f" />
          <stop offset="0.55" stopColor="#1c2338" />
          <stop offset="1" stopColor="#090c17" />
        </linearGradient>
        <linearGradient id="hi-beam-v" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#070a14" />
          <stop offset="0.1" stopColor="#5f6f98" />
          <stop offset="0.2" stopColor="#252f4a" />
          <stop offset="0.5" stopColor="#161d33" />
          <stop offset="0.8" stopColor="#252f4a" />
          <stop offset="0.9" stopColor="#455377" />
          <stop offset="1" stopColor="#070a14" />
        </linearGradient>
        <linearGradient id="hi-frame-l" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3b4a70" />
          <stop offset="0.35" stopColor="#1b2440" />
          <stop offset="1" stopColor="#0a0e1a" />
        </linearGradient>
        <linearGradient id="hi-frame-r" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#3b4a70" />
          <stop offset="0.35" stopColor="#1b2440" />
          <stop offset="1" stopColor="#0a0e1a" />
        </linearGradient>
        <linearGradient id="hi-gasket" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#05070d" />
          <stop offset="0.5" stopColor="#10131d" />
          <stop offset="1" stopColor="#05070d" />
        </linearGradient>
        <linearGradient id="hi-pipe" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#080b15" />
          <stop offset="0.28" stopColor="#3a4a73" />
          <stop offset="0.5" stopColor="#1b2543" />
          <stop offset="1" stopColor="#060812" />
        </linearGradient>
        <linearGradient id="hi-cyl-v" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#080b15" />
          <stop offset="0.32" stopColor="#4a5a84" />
          <stop offset="0.6" stopColor="#1a2340" />
          <stop offset="1" stopColor="#070a13" />
        </linearGradient>
        <linearGradient id="hi-rod" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#1c2438" />
          <stop offset="0.35" stopColor="#a4b4d8" />
          <stop offset="0.7" stopColor="#4a5778" />
          <stop offset="1" stopColor="#141a2c" />
        </linearGradient>
        <linearGradient id="hi-rod-h" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c2438" />
          <stop offset="0.35" stopColor="#a4b4d8" />
          <stop offset="0.7" stopColor="#4a5778" />
          <stop offset="1" stopColor="#141a2c" />
        </linearGradient>
        <linearGradient id="hi-damp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7f94c8" stopOpacity="0.2" />
          <stop offset="1" stopColor="#7f94c8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hi-soot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.45" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="hi-grime" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#02040a" stopOpacity="0.2" />
          <stop offset="0.5" stopColor="#02040a" stopOpacity="0" />
          <stop offset="0.82" stopColor="#8aa0d0" stopOpacity="0.07" />
          <stop offset="1" stopColor="#8aa0d0" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="hi-edge-l" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.6" />
          <stop offset="0.25" stopColor="#000" stopOpacity="0" />
          <stop offset="0.92" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id="hi-edge-r" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.6" />
          <stop offset="0.25" stopColor="#000" stopOpacity="0" />
          <stop offset="0.92" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </linearGradient>
        <radialGradient id="hi-led" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#e8f0ff" stopOpacity="1" />
          <stop offset="0.3" stopColor="#7b9bff" stopOpacity="0.6" />
          <stop offset="1" stopColor="#5a6dff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hi-comet-v" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a9bfff" stopOpacity="0" />
          <stop offset="1" stopColor="#f0f4ff" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="hi-comet-h" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#a9bfff" stopOpacity="0" />
          <stop offset="1" stopColor="#f0f4ff" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="hi-comet-hr" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#a9bcf0" stopOpacity="0" />
          <stop offset="1" stopColor="#f0f4ff" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="hi-cab" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6f8dff" />
          <stop offset="0.5" stopColor="#8f78ff" />
          <stop offset="1" stopColor="#5f7dff" />
        </linearGradient>
        <pattern id="hi-ribs" width="10" height="10" patternUnits="userSpaceOnUse">
          <rect width="10" height="3" fill="#9db0e0" fillOpacity="0.05" />
          <rect y="6" width="10" height="4" fill="#000" fillOpacity="0.35" />
        </pattern>

        {/* --- filtreler --- */}
        <filter id="hi-ao" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="5" stdDeviation="6" floodColor="#000" floodOpacity="0.8" />
        </filter>
        <filter id="hi-dent" x="-40%" y="-40%" width="180%" height="180%">
          <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="5" result="t" />
          <feDisplacementMap in="SourceGraphic" in2="t" scale="26" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation="2.5" />
        </filter>
        <linearGradient id="hi-dentg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.5" />
          <stop offset="0.5" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#9fb4ea" stopOpacity="0.16" />
        </linearGradient>
        <filter id="hi-streak" x="-80%" y="-5%" width="260%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.09 0.012" numOctaves="2" seed="2" result="t" />
          <feDisplacementMap in="SourceGraphic" in2="t" scale="16" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feGaussianBlur in="d" stdDeviation="1.6" />
        </filter>
        <filter id="hi-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="hi-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
        <filter id="hi-brush-l" {...F}>
          <feTurbulence type="fractalNoise" baseFrequency="0.0025 0.5" numOctaves="3" seed="3" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.7  0 0 0 0 0.78  0 0 0 0 1  2.2 0 0 0 -1" />
        </filter>
        <filter id="hi-brush-d" {...F}>
          <feTurbulence type="fractalNoise" baseFrequency="0.003 0.62" numOctaves="3" seed="21" />
          <feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.4 0 0 0 -1.05" />
        </filter>
        <filter id="hi-grain" {...F}>
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="17" />
          <feColorMatrix type="matrix" values="0 0 0 0 0.75  0 0 0 0 0.82  0 0 0 0 1  1.8 0 0 0 -0.8" />
        </filter>
      </defs>
    </svg>
  );
}

export function DoorArt({ side }: { side: "l" | "r" }) {
  const L = side === "l";
  const rnd = mulberry(L ? 71 : 193);
  const X = (off: number, w = 0) => (L ? W - off - w : off);
  const els: ReactNode[] = [];
  let k = 0;
  const push = (n: ReactNode) => els.push(<g key={k++}>{n}</g>);

  push(<rect width={W} height={H} fill="url(#hi-slab)" />);

  // --- büyük ölçekli yapı: oyuk paneller, yatay kirişler, dikey I-profil kaburgalar ---
  const panelCols = [
    { off: 150, w: 236 },
    { off: 450, w: 232 },
  ];
  const panelRows = [
    { y: 152, h: 78 },
    { y: 276, h: 236 },
    { y: 556, h: 236 },
    { y: 836, h: 118 },
  ];
  const panels: ReactNode[] = [];
  panelRows.forEach((r, ri) =>
    panelCols.forEach((c, ci) => {
      const x = X(c.off, c.w);
      panels.push(<rect key={`p${ri}${ci}`} x={x} y={r.y} width={c.w} height={r.h} rx="2" fill="url(#hi-panel)" />);
      // oyuk: üst/sol iç gölge, alt/sağ soğuk vurgu
      panels.push(<path key={`pa${ri}${ci}`} d={`M${x} ${r.y + r.h}V${r.y}H${x + c.w}`} fill="none" stroke="#000" strokeOpacity="0.85" strokeWidth="5" />);
      panels.push(<path key={`pb${ri}${ci}`} d={`M${x + 1} ${r.y + r.h - 0.5}H${x + c.w - 0.5}V${r.y + 1}`} fill="none" stroke="#7f96d0" strokeOpacity="0.22" strokeWidth="1.6" />);
      if (r.h > 200) {
        const ix = x + 22;
        panels.push(<rect key={`pi${ri}${ci}`} x={ix} y={r.y + 22} width={c.w - 44} height={r.h - 44} rx="2" fill="none" stroke="#000" strokeOpacity="0.45" strokeWidth="2" />);
        panels.push(<rect key={`pj${ri}${ci}`} x={ix + 2} y={r.y + 24} width={c.w - 44} height={r.h - 44} rx="2" fill="none" stroke="#7f96d0" strokeOpacity="0.07" strokeWidth="1.5" />);
      }
    }),
  );
  push(panels);

  const beamYs = [236, 516, 796];
  push(
    <g filter="url(#hi-ao)">
      {beamYs.map((y) => (
        <g key={y}>
          <rect x={X(46, 674)} y={y} width="674" height="34" fill="url(#hi-beam-h)" />
          <rect x={X(46, 674)} y={y} width="674" height="1.6" fill="#a9bcf0" opacity="0.3" />
          <rect x={X(46, 674)} y={y + 33} width="674" height="1" fill="#000" opacity="0.8" />
        </g>
      ))}
    </g>,
  );
  // dikey I-profil kaburgalar (flanşlı)
  const ribs = [90, 392, 690];
  push(
    <g filter="url(#hi-ao)">
      {ribs.map((off) => (
        <g key={off}>
          <rect x={X(off, 54)} y="78" width="54" height="884" fill="url(#hi-beam-v)" />
          <rect x={X(off - 6, 6)} y="78" width="6" height="884" fill="#000" opacity="0.5" />
          <line x1={X(off + 27)} x2={X(off + 27)} y1="78" y2="962" stroke="#000" strokeOpacity="0.35" strokeWidth="2" />
        </g>
      ))}
    </g>,
  );
  // kiriş kesişimlerinde birkaç ağır cıvata (ızgara yok)
  push(
    ribs.slice(0, 2).flatMap((off) =>
      beamYs.map((y) => (
        <g key={`${off}-${y}`}>
          <circle cx={X(off + 27)} cy={y + 17} r="9" fill="#05070d" opacity="0.7" />
          <circle cx={X(off + 27)} cy={y + 17} r="6" fill="#2b3658" />
          <circle cx={X(off + 25)} cy={y + 15} r="2.2" fill="#9fb4ea" opacity="0.45" />
        </g>
      )),
    ),
  );

  // --- iç kenar: contalı derz + ağır kilit çerçevesi ---
  push(<rect x={X(22, 70)} y="0" width="70" height={H} fill={`url(#hi-frame-${side})`} />);
  push(<line x1={X(92)} x2={X(92)} y1="0" y2={H} stroke="#000" strokeOpacity="0.85" strokeWidth="4" />);
  push(<line x1={X(90)} x2={X(90)} y1="0" y2={H} stroke="#9fb4ea" strokeOpacity="0.12" strokeWidth="1" />);
  push(<rect x={X(0, 22)} y="0" width="22" height={H} fill="url(#hi-gasket)" />);
  push(<rect x={X(0, 22)} y="0" width="22" height={H} fill="url(#hi-ribs)" opacity="0.8" />);
  push(<line x1={X(23)} x2={X(23)} y1="0" y2={H} stroke="#9fb4ea" strokeOpacity="0.16" strokeWidth="1.4" />);
  // ağır kilit çubukları (kirişlerin üzerinde)
  push(
    [250, 810].map((y) => (
      <g key={y}>
        <rect x={X(16, 330)} y={y - 6} width="330" height="38" rx="3" fill="#000" opacity="0.5" />
        <rect x={X(20, 320)} y={y} width="320" height="26" rx="3" fill="url(#hi-pipe)" />
        <rect x={X(20, 320)} y={y} width="320" height="26" rx="3" fill="none" stroke="#000" strokeOpacity="0.7" strokeWidth="1.4" />
        {[60, 160, 300].map((o) => (
          <rect key={o} x={X(o, 14)} y={y - 5} width="14" height="36" rx="2" fill="#222c48" stroke="#000" strokeOpacity="0.7" />
        ))}
        <rect x={X(20, 40)} y={y - 8} width="40" height="42" rx="4" fill="url(#hi-beam-h)" stroke="#000" strokeOpacity="0.7" />
      </g>
    )),
  );

  // --- tepede kalın boru / hava kanalı ---
  push(
    <g>
      <rect x="0" y="82" width={W} height="66" fill="#000" opacity="0.4" />
      <rect x="0" y="78" width={W} height="62" fill="url(#hi-pipe)" />
      {[120, 330, 560].map((o) => (
        <g key={o}>
          <rect x={X(o, 16)} y="72" width="16" height="74" rx="2" fill="#1b2441" />
          <rect x={X(o, 16)} y="72" width="16" height="74" rx="2" fill="none" stroke="#000" strokeOpacity="0.8" />
          <rect x={X(o + 1, 3)} y="74" width="3" height="70" fill="#a9bcf0" opacity="0.25" />
        </g>
      ))}
      <rect x="0" y="79" width={W} height="1.6" fill="#a9bcf0" opacity="0.35" />
    </g>,
  );
  // altta kablo tavası
  push(
    <g>
      <rect x={X(46, 674)} y="872" width="674" height="64" fill="#06080f" />
      <rect x={X(46, 674)} y="872" width="674" height="64" fill="url(#hi-ribs)" opacity="0.5" />
      <rect x={X(46, 674)} y="872" width="674" height="2" fill="#a9bcf0" opacity="0.22" />
      {[
        ["#1a2040", 890],
        ["#241c4a", 904],
        ["#10162c", 918],
      ].map(([c, y]) => (
        <path key={String(c)} d={`M${X(46)} ${y} C ${X(200)} ${Number(y) - 8}, ${X(330)} ${Number(y) + 8}, ${X(480)} ${y} S ${X(640)} ${Number(y) - 6}, ${X(720)} ${y}`} fill="none" stroke={String(c)} strokeWidth="11" strokeLinecap="round" />
      ))}
    </g>,
  );
  push(<rect x="0" y="962" width={W} height="38" fill="#04060c" />);
  push(<rect x="0" y="962" width={W} height="2" fill="#9fb4ea" opacity="0.14" />);

  // hidrolik piston (kaburga kenarında)
  const pcx = X(520, 44);
  push(
    <g>
      <rect x={pcx - 4} y="556" width="52" height="150" rx="4" fill="#000" opacity="0.5" />
      <rect x={pcx} y="560" width="44" height="140" rx="3" fill="url(#hi-cyl-v)" />
      <rect x={pcx} y="560" width="44" height="140" rx="3" fill="url(#hi-ribs)" opacity="0.25" />
      <rect x={pcx + 15} y="700" width="14" height="86" fill="url(#hi-rod)" />
      <rect x={pcx - 6} y="694" width="56" height="10" rx="2" fill="#1b2441" stroke="#000" strokeOpacity="0.7" />
      <rect x={pcx - 4} y="548" width="52" height="14" rx="2" fill="#1b2441" stroke="#000" strokeOpacity="0.7" />
    </g>,
  );

  // --- hasar: yalnız birkaç göçük ---
  const dents = L
    ? [
        [X(300), 400, 70, 40, -20],
        [X(560), 650, 90, 50, 12],
      ]
    : [
        [X(270), 640, 80, 46, 25],
        [X(560), 350, 70, 40, -15],
      ];
  push(dents.map(([x, y, rx, ry, a], i) => <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} transform={`rotate(${a} ${x} ${y})`} fill="url(#hi-dentg)" filter="url(#hi-dent)" />));

  // --- enerji kabloları: mavi/mor ince hatlar + damlayan demetler (küpün altındaki kablolar gibi) ---
  const cablePaths: string[] = [];
  cablePaths.push(`M${X(48)} 80 C ${X(52)} 300, ${X(44)} 640, ${X(48)} 960`);
  cablePaths.push(`M${X(70)} 272 H ${X(720)}`);
  cablePaths.push(`M${X(70)} 552 H ${X(720)}`);
  cablePaths.push(`M${X(70)} 832 H ${X(720)}`);
  cablePaths.push(`M${X(110)} 150 H ${X(720)}`);
  const droops = L ? [180, 300, 470, 590] : [200, 340, 480, 620];
  droops.forEach((o, i) => {
    const len = 70 + ((i * 53) % 90);
    cablePaths.push(`M${X(o)} 552 C ${X(o + 6)} ${552 + len * 0.6}, ${X(o - 22)} ${552 + len * 0.8}, ${X(o - 14)} ${552 + len}`);
    cablePaths.push(`M${X(o + 10)} 552 C ${X(o + 18)} ${552 + len * 0.5}, ${X(o + 34)} ${552 + len * 0.9}, ${X(o + 26)} ${552 + len * 1.15}`);
  });
  push(
    <g>
      <g filter="url(#hi-glow)" opacity="0.7">
        {cablePaths.map((d, i) => (i >= 1 && i <= 4 ? null : <path key={i} d={d} fill="none" stroke="#6f7dff" strokeWidth="5" />))}
      </g>
      {cablePaths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="url(#hi-cab)" strokeWidth={i >= 1 && i <= 4 ? 1 : 1.5} strokeOpacity={i >= 1 && i <= 4 ? 0.28 : 0.9} />
      ))}
    </g>,
  );
  // yavaş sinyal darbeleri (kuyruklu küçük kuyruklu yıldız): yalnız transform/opacity
  const cometsV = [
    { x: X(48), d: 0, dur: 3.6 },
    { x: X(48), d: 1.9, dur: 4.4 },
  ];
  const cometsH = [
    { y: 272, d: 0.6, dur: 5, dir: 1 },
    { y: 552, d: 1.7, dur: 6, dir: -1 },
    { y: 832, d: 0.2, dur: 5.4, dir: 1 },
    { y: 150, d: 2.4, dur: 6.2, dir: -1 },
  ];
  push(
    <g>
      {cometsV.map((c, i) => (
        <g key={`v${i}`} className="hi__cm hi__cm--v" style={{ "--d": `${c.d}s`, "--t": `${c.dur}s` } as CSSProperties}>
          <rect x={c.x - 1.2} y="80" width="2.4" height="34" fill="url(#hi-comet-v)" />
        </g>
      ))}
      {cometsH.map((c, i) => {
        const outer = c.dir === 1; // iç kenardan dışa mı
        const sx = outer === L ? -1 : 1; // x yönü
        const x0 = outer ? X(70) : X(720);
        const rx = sx === 1 ? x0 - 38 : x0;
        return (
          <g key={`h${i}`} className="hi__cm hi__cm--h" style={{ "--d": `${c.d}s`, "--t": `${c.dur}s`, "--dist": `${sx * 650}px` } as CSSProperties}>
            <rect x={rx} y={c.y - 1.2} width="38" height="2.4" fill={sx === 1 ? "url(#hi-comet-h)" : "url(#hi-comet-hr)"} />
          </g>
        );
      })}
    </g>,
  );
  // soğuk durum LED'leri: yavaş nefes alır
  const leds: [number, number][] = [
    [X(60), 130],
    [X(60), 300],
    [X(60), 500],
    [X(60), 700],
    [X(60), 930],
    [X(150), 240 + 17],
    [X(420), 524 + 17],
    [X(150), 804 + 17],
  ];
  push(
    leds.map(([x, y], i) => (
      <g key={i} className="hi__led" style={{ "--d": `${-(i * 0.9)}s`, "--t": `${3.2 + (i % 3) * 0.7}s` } as CSSProperties}>
        <circle cx={x} cy={y} r="9" fill="url(#hi-led)" />
        <circle cx={x} cy={y} r="2.1" fill="#eaf1ff" />
      </g>
    )),
  );

  // --- yüzey aşınması: fırça izi, tane, ince çizikler, nem akıntıları, is, toz ---
  push(<rect width={W} height={H} filter="url(#hi-brush-l)" opacity="0.4" style={{ mixBlendMode: "soft-light" } as CSSProperties} />);
  push(<rect width={W} height={H} filter="url(#hi-brush-d)" opacity="0.5" />);
  push(<rect width={W} height={H} filter="url(#hi-grain)" opacity="0.2" style={{ mixBlendMode: "overlay" } as CSSProperties} />);
  const scratches: ReactNode[] = [];
  for (let i = 0; i < 40; i++) {
    const x = rnd() * W;
    const y = 90 + rnd() * 800;
    const len = 20 + rnd() * 150;
    const a = (rnd() < 0.75 ? (rnd() - 0.5) * 0.2 : (rnd() - 0.5) * 1.4) + (rnd() < 0.1 ? Math.PI / 2 : 0);
    const light = rnd() < 0.7;
    scratches.push(
      <line key={i} x1={x} y1={y} x2={x + Math.cos(a) * len} y2={y + Math.sin(a) * len} stroke={light ? "#a9bcf0" : "#000"} strokeOpacity={light ? 0.06 + rnd() * 0.16 : 0.25 + rnd() * 0.3} strokeWidth={0.5 + rnd() * 0.7} strokeLinecap="round" />,
    );
  }
  push(scratches);
  // kirişlerin ve borunun altından süzülen nem / is izleri
  const streaks: ReactNode[] = [];
  [...beamYs.map((y) => y + 34), 142].forEach((y, bi) => {
    for (let i = 0; i < 6; i++) {
      const x = rnd() * (W - 40) + 10;
      const h = 60 + rnd() * 190;
      const w = 7 + rnd() * 13;
      streaks.push(<rect key={`d${bi}${i}`} x={x} y={y} width={w} height={h} fill="url(#hi-damp)" filter="url(#hi-streak)" opacity={0.5 + rnd() * 0.5} />);
      if (rnd() < 0.5) streaks.push(<rect key={`s${bi}${i}`} x={x + w} y={y} width={w * 0.7} height={h * 0.7} fill="url(#hi-soot)" filter="url(#hi-streak)" opacity="0.5" />);
    }
  });
  push(streaks);
  push(<rect width={W} height={H} fill="url(#hi-grime)" />);
  push(<rect width={W} height={H} fill={`url(#hi-edge-${side})`} />);

  return (
    <svg className="hi__art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio={`${L ? "xMax" : "xMin"}YMid slice`} aria-hidden="true" focusable="false">
      {els}
    </svg>
  );
}

/** Kapının ortasındaki kilit levhası: logo işareti + izlenmiş ALLSPARK + MADNESS TECHNOLOGY. */
export function PlateText({ children }: { children: ReactNode }) {
  return (
    <div className="hi__plate">
      {children}
      <svg className="hi__wm" viewBox={`0 0 ${WORDMARK.w} ${WORDMARK.h}`} aria-hidden="true" focusable="false">
        <use href="#hi-wm" fill="url(#hi-steel)" filter="url(#hi-metal)" />
      </svg>
      <svg className="hi__tg" viewBox={`0 0 ${TAGLINE.w} ${TAGLINE.h}`} aria-hidden="true" focusable="false">
        <use href="#hi-tg" fill="url(#hi-steel)" filter="url(#hi-metal)" />
      </svg>
    </div>
  );
}
