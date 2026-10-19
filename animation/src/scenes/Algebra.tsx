import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, MONO } from "../theme";
import { Backdrop, SceneHeader, prog } from "../ui";

const OPS: { sym: string; name: string; desc: string; color: string; at: number }[] = [
  { sym: "R", name: "Table scan", desc: "read students", color: C.green, at: 52 },
  { sym: "σ", name: "Selection", desc: "keep matching rows", color: C.pink, at: 66 },
  { sym: "π", name: "Projection", desc: "keep column name", color: C.violet, at: 80 },
];

export const Algebra: React.FC = () => {
  const frame = useCurrentFrame();
  const piece = (at: number): React.CSSProperties => ({
    opacity: prog(frame, at, 16),
    display: "inline-block",
    translate: `0px ${interpolate(prog(frame, at, 16), [0, 1], [24, 0])}px`,
  });
  return (
    <Backdrop>
      <SceneHeader step={4} title="Relational algebra" subtitle="The validated tree becomes a query plan — read it inside-out" />
      <div style={{ position: "absolute", left: 0, right: 0, top: 400, textAlign: "center", fontFamily: MONO, fontSize: 68, fontWeight: 700, whiteSpace: "nowrap" }}>
        <span style={{ ...piece(30), color: C.violet }}>π</span>
        <span style={{ ...piece(30), color: C.violet, fontSize: 46 }}>{"{name}"}</span>
        <span style={{ ...piece(30), color: C.muted }}>(</span>
        <span style={{ ...piece(20), color: C.pink }}>σ</span>
        <span style={{ ...piece(20), color: C.pink, fontSize: 46 }}>{"{marks > 10 * 8 AND 1 = 1}"}</span>
        <span style={{ ...piece(20), color: C.muted }}>(</span>
        <span style={{ ...piece(8), color: C.green }}>students</span>
        <span style={{ ...piece(20), color: C.muted }}>)</span>
        <span style={{ ...piece(30), color: C.muted }}>)</span>
      </div>
      <div style={{ position: "absolute", left: 150, right: 150, top: 640, display: "flex", justifyContent: "center", alignItems: "center", gap: 36 }}>
        {OPS.map((o, i) => {
          const k = prog(frame, o.at + 18, 16);
          return (
            <React.Fragment key={o.sym}>
              {i > 0 ? <span style={{ fontSize: 56, color: C.muted, opacity: k }}>→</span> : null}
              <div style={{ opacity: k, translate: `0px ${interpolate(k, [0, 1], [40, 0])}px`, width: 440, borderRadius: 28, padding: "28px 32px", background: C.card, border: `3px solid ${o.color}`, boxShadow: `0 0 50px ${o.color}22` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                  <span style={{ fontFamily: MONO, fontSize: 80, fontWeight: 800, color: o.color }}>{o.sym}</span>
                  <span style={{ fontSize: 42, fontWeight: 800 }}>{o.name}</span>
                </div>
                <div style={{ fontSize: 34, color: C.muted, marginTop: 8 }}>{o.desc}</div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </Backdrop>
  );
};
