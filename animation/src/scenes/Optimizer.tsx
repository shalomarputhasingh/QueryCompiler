import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, MONO } from "../theme";
import { Backdrop, Pill, SceneHeader, prog } from "../ui";

const Line: React.FC<{ children: React.ReactNode; opacity: number }> = ({ children, opacity }) => (
  <div style={{ position: "absolute", left: 0, right: 0, textAlign: "center", opacity, whiteSpace: "nowrap" }}>{children}</div>
);

const hl = (c: string): React.CSSProperties => ({ color: c, background: `${c}26`, borderRadius: 12, padding: "0 12px" });

const RULES: { name: string; text: string; color: string; at: number }[] = [
  { name: "Constant folding", text: "10 * 8 → 80   ·   1 = 1 → TRUE", color: C.amber, at: 52 },
  { name: "Boolean simplification", text: "p AND TRUE → p", color: C.green, at: 100 },
];

export const Optimizer: React.FC = () => {
  const frame = useCurrentFrame();
  const a = 1 - prog(frame, 52, 14); // original predicate
  const b = prog(frame, 52, 14) * (1 - prog(frame, 100, 14)); // folded predicate
  const c = prog(frame, 100, 14); // simplified predicate
  return (
    <Backdrop>
      <SceneHeader step={5} title="Optimization" subtitle="Provably equivalent rewrites, each one explained" />
      <div style={{ position: "absolute", left: 150, right: 150, top: 380, height: 120, fontFamily: MONO, fontSize: 74, fontWeight: 700, opacity: prog(frame, 14, 18) }}>
        <Line opacity={a}>
          <span style={{ color: C.muted }}>σ </span>marks &gt; <span style={hl(C.amber)}>10 * 8</span> AND <span style={hl(C.amber)}>1 = 1</span>
        </Line>
        <Line opacity={b}>
          <span style={{ color: C.muted }}>σ </span>marks &gt; <span style={hl(C.amber)}>80</span> <span style={hl(C.green)}>AND TRUE</span>
        </Line>
        <Line opacity={c}>
          <span style={{ color: C.muted }}>σ </span>
          <span style={hl(C.green)}>marks &gt; 80</span>
        </Line>
      </div>

      <div style={{ position: "absolute", left: 150, right: 150, top: 570, display: "flex", flexDirection: "column", gap: 26 }}>
        {RULES.map((r, i) => {
          const k = prog(frame, r.at, 16);
          return (
            <div
              key={r.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 28,
                padding: "24px 36px",
                borderRadius: 26,
                background: C.card,
                border: `3px solid ${r.color}`,
                opacity: k,
                translate: `${interpolate(k, [0, 1], [-70, 0])}px 0px`,
              }}
            >
              <span style={{ width: 62, height: 62, borderRadius: 999, background: r.color, color: C.bg, fontSize: 40, fontWeight: 800, display: "grid", placeItems: "center" }}>{i + 1}</span>
              <span style={{ fontSize: 44, fontWeight: 800, minWidth: 560 }}>{r.name}</span>
              <span style={{ fontFamily: MONO, fontSize: 38, color: C.muted }}>{r.text}</span>
            </div>
          );
        })}
      </div>

      <div style={{ position: "absolute", left: 150, right: 150, bottom: 96, display: "flex", alignItems: "center", gap: 24, opacity: prog(frame, 128, 18) }}>
        <Pill color={C.green} size={36}>
          same rows
        </Pill>
        <span style={{ fontSize: 38, color: C.muted }}>Equivalent plan — structure changes, never a speed-up claim</span>
      </div>
    </Backdrop>
  );
};
