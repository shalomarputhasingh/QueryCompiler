import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, MONO } from "../theme";
import { Backdrop, SceneHeader, prog } from "../ui";

interface N {
  id: string;
  label: string;
  cap: string;
  color: string;
  x: number;
  y: number;
  parent?: string;
  d: number; // depth, drives the reveal order
}

const NODES: N[] = [
  { id: "sel", label: "SELECT", cap: "statement", color: C.violet, x: 810, y: 10, d: 0 },
  { id: "item", label: "name", cap: "select item", color: C.sky, x: 230, y: 150, parent: "sel", d: 1 },
  { id: "from", label: "students", cap: "from", color: C.sky, x: 700, y: 150, parent: "sel", d: 1 },
  { id: "and", label: "AND", cap: "where", color: C.pink, x: 1240, y: 150, parent: "sel", d: 1 },
  { id: "gt", label: ">", color: C.pink, cap: "left", x: 980, y: 290, parent: "and", d: 2 },
  { id: "eq", label: "=", color: C.pink, cap: "right", x: 1480, y: 290, parent: "and", d: 2 },
  { id: "marks", label: "marks", color: C.sky, cap: "column", x: 830, y: 430, parent: "gt", d: 3 },
  { id: "mul", label: "*", color: C.pink, cap: "right", x: 1130, y: 430, parent: "gt", d: 3 },
  { id: "one1", label: "1", color: C.amber, cap: "number", x: 1400, y: 430, parent: "eq", d: 3 },
  { id: "one2", label: "1", color: C.amber, cap: "number", x: 1560, y: 430, parent: "eq", d: 3 },
  { id: "ten", label: "10", color: C.amber, cap: "number", x: 1050, y: 570, parent: "mul", d: 4 },
  { id: "eight", label: "8", color: C.amber, cap: "number", x: 1210, y: 570, parent: "mul", d: 4 },
];

const start = (n: N, i: number): number => 22 + n.d * 13 + (i % 3) * 3;

export const Parser: React.FC = () => {
  const frame = useCurrentFrame();
  const byId = new Map(NODES.map((n) => [n.id, n]));
  return (
    <Backdrop>
      <SceneHeader step={2} title="Syntax analysis" subtitle="Tokens become a typed syntax tree — AND binds looser than comparisons" />
      <div style={{ position: "absolute", left: 150, top: 330, width: 1620, height: 700 }}>
        <svg width={1620} height={700} style={{ position: "absolute", inset: 0 }}>
          {NODES.filter((n) => n.parent).map((n) => {
            const p = byId.get(n.parent as string) as N;
            const k = prog(frame, start(n, NODES.indexOf(n)) - 6, 14);
            const x1 = p.x;
            const y1 = p.y + 44;
            const x2 = n.x;
            const y2 = n.y - 6;
            const len = Math.hypot(x2 - x1, y2 - y1);
            return <line key={n.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.border} strokeWidth={4} strokeLinecap="round" strokeDasharray={len} strokeDashoffset={len * (1 - k)} />;
          })}
        </svg>
        {NODES.map((n, i) => {
          const k = prog(frame, start(n, i), 16);
          return (
            <div
              key={n.id}
              style={{
                position: "absolute",
                left: n.x,
                top: n.y,
                translate: `-50% ${interpolate(k, [0, 1], [20, 0])}px`,
                opacity: k,
                scale: interpolate(k, [0, 1], [0.7, 1]),
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 22, color: C.muted, marginBottom: 4 }}>{n.cap}</div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 44,
                  fontWeight: 700,
                  color: n.color,
                  background: C.card,
                  border: `3px solid ${n.color}`,
                  borderRadius: 18,
                  padding: "6px 24px",
                  boxShadow: `0 0 40px ${n.color}22`,
                  whiteSpace: "nowrap",
                }}
              >
                {n.label}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 150, top: 760, width: 700, fontSize: 38, color: C.muted, opacity: prog(frame, 70, 20), lineHeight: 1.35 }}>
        Every node keeps its source range, so errors can point at the exact line and column.
      </div>
    </Backdrop>
  );
};
