import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, MONO } from "../theme";
import { Backdrop, SceneHeader, prog } from "../ui";

const COLS: [string, string][] = [
  ["id", "INTEGER PK"],
  ["name", "TEXT"],
  ["age", "INTEGER"],
  ["gpa", "REAL"],
  ["marks", "INTEGER"],
];

const CHECKS: { text: string; type: string; at: number }[] = [
  { text: "name → students.name", type: "TEXT", at: 30 },
  { text: "marks → students.marks", type: "INTEGER", at: 50 },
  { text: "marks > 10 * 8", type: "BOOLEAN", at: 70 },
];

export const Semantic: React.FC = () => {
  const frame = useCurrentFrame();
  const hi = (c: string): number => {
    if (c === "name") return prog(frame, 30, 10) * (1 - prog(frame, 52, 8));
    if (c === "marks") return prog(frame, 50, 10);
    return 0;
  };
  return (
    <Backdrop>
      <SceneHeader step={3} title="Semantic analysis" subtitle="Every name and type is checked against the real schema" />
      <div style={{ position: "absolute", left: 150, top: 360, width: 700, borderRadius: 28, background: C.card, border: `3px solid ${C.border}`, overflow: "hidden", opacity: prog(frame, 8, 18) }}>
        <div style={{ padding: "20px 32px", fontSize: 44, fontWeight: 800, background: C.card2, borderBottom: `3px solid ${C.border}` }}>
          students <span style={{ fontSize: 28, color: C.muted, fontWeight: 500 }}> · 30 rows</span>
        </div>
        {COLS.map(([name, type]) => (
          <div
            key={name}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "10px 32px",
              fontFamily: MONO,
              fontSize: 36,
              background: `rgba(124,132,255,${0.28 * hi(name)})`,
              borderBottom: `2px solid ${C.border}`,
              color: hi(name) > 0.4 ? C.text : C.muted,
            }}
          >
            <span>{name}</span>
            <span style={{ color: C.sky }}>{type}</span>
          </div>
        ))}
      </div>

      <div style={{ position: "absolute", left: 930, top: 360, width: 840, display: "flex", flexDirection: "column", gap: 28 }}>
        {CHECKS.map((c) => {
          const k = prog(frame, c.at, 16);
          return (
            <div
              key={c.text}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 24,
                padding: "22px 30px",
                borderRadius: 24,
                background: C.card,
                border: `3px solid ${C.border}`,
                opacity: k,
                translate: `${interpolate(k, [0, 1], [60, 0])}px 0px`,
              }}
            >
              <svg width={56} height={56} viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="26" fill={`${C.green}33`} stroke={C.green} strokeWidth="3" />
                <path d="M16 29l8 8 16-17" fill="none" stroke={C.green} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={50} strokeDashoffset={50 * (1 - prog(frame, c.at + 6, 12))} />
              </svg>
              <div style={{ flex: 1, fontFamily: MONO, fontSize: 40 }}>{c.text}</div>
              <div style={{ fontSize: 32, fontWeight: 700, color: C.sky }}>{c.type}</div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: "absolute",
          left: 150,
          right: 150,
          bottom: 80,
          padding: "22px 40px",
          borderRadius: 24,
          background: `${C.red}18`,
          border: `3px solid ${C.red}`,
          display: "flex",
          alignItems: "center",
          gap: 32,
          opacity: prog(frame, 92, 16),
          translate: `0px ${interpolate(prog(frame, 92, 16), [0, 1], [30, 0])}px`,
        }}
      >
        <span style={{ fontSize: 48, color: C.red, fontWeight: 800 }}>✗</span>
        <span style={{ fontFamily: MONO, fontSize: 34, whiteSpace: "nowrap" }}>
          SELECT <span style={{ color: C.red, textDecoration: "underline wavy" }}>nam</span> FROM students
        </span>
        <span style={{ fontSize: 34, color: C.muted, flex: 1 }}>Unknown column 'nam' — Did you mean 'name'?</span>
      </div>
    </Backdrop>
  );
};
