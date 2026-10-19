import React from "react";
import { Interactive, interpolate, useCurrentFrame } from "remotion";
import { C, MONO } from "../theme";
import { Backdrop, Logo, SceneHeader, prog } from "../ui";

const ROWS: [string, number][] = [
  ["Kabir Sharma", 98],
  ["Ananya Menon", 95],
  ["Priya Menon", 95],
  ["Kabir Reddy", 89],
  ["Arjun Reddy", 88],
];

const ANSWER = "It compiled cleanly. The optimizer folded 10 * 8 into 80 and dropped the always-true 1 = 1, so the same 8 rows come back from a simpler plan.";
const WORDS = ["Quera-ing", "Walking the syntax tree", "Folding constants"];

const Orb: React.FC<{ size: number; spin?: number }> = ({ size, spin = 0 }) => (
  <svg viewBox="0 0 40 40" width={size} height={size} style={{ rotate: `${spin}deg` }}>
    <defs>
      <linearGradient id="qg" x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
        <stop stopColor="#8b93ff" />
        <stop offset="0.55" stopColor="#a855f7" />
        <stop offset="1" stopColor="#ec4899" />
      </linearGradient>
    </defs>
    <circle cx="20" cy="20" r="19" fill="url(#qg)" />
    <path d="M20 8.5c.9 5.6 3.9 8.6 9.5 9.5-5.6.9-8.6 3.9-9.5 9.5-.9-5.6-3.9-8.6-9.5-9.5 5.6-.9 8.6-3.9 9.5-9.5Z" fill="#fff" />
    <circle cx="29.5" cy="28.5" r="2.1" fill="#fff" fillOpacity="0.85" />
  </svg>
);

export const Finale: React.FC = () => {
  const frame = useCurrentFrame();
  const thinking = frame >= 34 && frame < 66;
  const typed = Math.floor(interpolate(frame, [66, 124], [0, ANSWER.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const word = WORDS[Math.floor((frame - 34) / 11) % WORDS.length] ?? WORDS[0];
  const outro = prog(frame, 128, 18);
  return (
    <Backdrop>
      <SceneHeader step={6} title="Run it, then ask Quera" subtitle="Read-only SQLite execution and an AI tutor that sees the compiler output" />
      <div style={{ position: "absolute", left: 150, top: 380, width: 760, borderRadius: 28, background: C.card, border: `3px solid ${C.border}`, overflow: "hidden", opacity: prog(frame, 10, 18) }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 32px", background: C.card2, borderBottom: `3px solid ${C.border}` }}>
          <span style={{ fontSize: 40, fontWeight: 800 }}>Results</span>
          <span style={{ fontSize: 34, color: C.green, fontWeight: 700 }}>8 rows</span>
        </div>
        <div style={{ display: "flex", padding: "14px 32px", fontSize: 30, color: C.muted, borderBottom: `2px solid ${C.border}` }}>
          <span style={{ flex: 1 }}>name</span>
          <span>marks</span>
        </div>
        {ROWS.map(([n, m], i) => {
          const k = prog(frame, 18 + i * 6, 14);
          return (
            <div key={n} style={{ display: "flex", padding: "14px 32px", fontFamily: MONO, fontSize: 36, borderBottom: `2px solid ${C.border}`, opacity: k, translate: `${interpolate(k, [0, 1], [-30, 0])}px 0px` }}>
              <span style={{ flex: 1 }}>{n}</span>
              <span style={{ color: C.amber }}>{m}</span>
            </div>
          );
        })}
        <div style={{ padding: "12px 32px", fontSize: 28, color: C.muted }}>… 3 more rows</div>
      </div>

      <Interactive.Div
        name="Quera panel"
        style={{ position: "absolute", left: 980, top: 380, width: 790, borderRadius: 28, background: C.card, border: `3px solid ${C.primary}`, padding: "28px 34px", opacity: prog(frame, 24, 18), boxShadow: "0 0 80px rgba(124,132,255,0.2)", minHeight: 480 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Orb size={70} spin={thinking ? frame * 6 : 0} />
          <div>
            <div style={{ fontSize: 44, fontWeight: 800 }}>Quera</div>
            <div style={{ fontSize: 28, color: C.muted }}>Your SQL &amp; compiler tutor</div>
          </div>
        </div>
        <div style={{ marginTop: 28, fontSize: 38, lineHeight: 1.45, minHeight: 260 }}>
          {thinking ? (
            <span style={{ color: C.violet, fontWeight: 600 }}>{word}…</span>
          ) : (
            <span>
              {ANSWER.slice(0, typed)}
              {typed > 0 && typed < ANSWER.length ? <span style={{ display: "inline-block", width: 12, height: 40, background: C.primary, verticalAlign: "text-bottom", marginLeft: 4 }} /> : null}
            </span>
          )}
        </div>
      </Interactive.Div>

      <div style={{ position: "absolute", inset: 0, opacity: outro, background: "rgba(11,13,20,0.94)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 36 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 36, scale: interpolate(outro, [0, 1], [0.9, 1]) }}>
          <Logo size={150} />
          <div style={{ fontSize: 130, fontWeight: 800, letterSpacing: -4 }}>QueryCompiler</div>
        </div>
        <div style={{ fontSize: 52, color: C.muted }}>See how SQL really compiles</div>
      </div>
    </Backdrop>
  );
};
