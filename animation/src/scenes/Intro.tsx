import React from "react";
import { Interactive, interpolate, useCurrentFrame } from "remotion";
import { C, MONO, QUERY } from "../theme";
import { Backdrop, Logo, prog } from "../ui";

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const typed = Math.floor(interpolate(frame, [38, 92], [0, QUERY.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  return (
    <Backdrop>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 36 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 40,
            opacity: prog(frame, 0, 22),
            scale: interpolate(prog(frame, 0, 26), [0, 1], [0.8, 1]),
          }}
        >
          <Logo size={170} />
          <Interactive.Div name="Title" style={{ fontSize: 150, fontWeight: 800, letterSpacing: -5 }}>
            QueryCompiler
          </Interactive.Div>
        </div>
        <Interactive.Div
          name="Tagline"
          style={{
            fontSize: 52,
            color: C.muted,
            opacity: prog(frame, 14, 22),
            translate: `0px ${interpolate(prog(frame, 14, 22), [0, 1], [24, 0])}px`,
          }}
        >
          Watch a SQL query travel through a real compiler
        </Interactive.Div>
        <div
          style={{
            marginTop: 30,
            width: 1560,
            padding: "40px 56px",
            borderRadius: 32,
            background: C.card,
            border: `2px solid ${C.border}`,
            fontFamily: MONO,
            fontSize: 52,
            opacity: prog(frame, 30, 16),
            translate: `0px ${interpolate(prog(frame, 30, 20), [0, 1], [40, 0])}px`,
            boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
          }}
        >
          <span>{QUERY.slice(0, typed)}</span>
          <span style={{ display: "inline-block", width: 22, height: 56, marginLeft: 4, background: C.primary, verticalAlign: "text-bottom", opacity: frame % 20 < 12 ? 1 : 0 }} />
        </div>
      </div>
    </Backdrop>
  );
};
