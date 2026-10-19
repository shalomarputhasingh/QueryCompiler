import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C, MONO } from "../theme";
import { Backdrop, Pill, SceneHeader, prog } from "../ui";

const TOKENS: { t: string; type: string; color: string }[] = [
  { t: "SELECT", type: "KEYWORD", color: C.violet },
  { t: "name", type: "IDENTIFIER", color: C.sky },
  { t: "FROM", type: "KEYWORD", color: C.violet },
  { t: "students", type: "IDENTIFIER", color: C.sky },
  { t: "WHERE", type: "KEYWORD", color: C.violet },
  { t: "marks", type: "IDENTIFIER", color: C.sky },
  { t: ">", type: "OPERATOR", color: C.pink },
  { t: "10", type: "NUMBER", color: C.amber },
  { t: "*", type: "OPERATOR", color: C.pink },
  { t: "8", type: "NUMBER", color: C.amber },
  { t: "AND", type: "KEYWORD", color: C.violet },
  { t: "1", type: "NUMBER", color: C.amber },
  { t: "=", type: "OPERATOR", color: C.pink },
  { t: "1", type: "NUMBER", color: C.amber },
  { t: ";", type: "PUNCTUATION", color: C.muted },
];

export const Lexer: React.FC = () => {
  const frame = useCurrentFrame();
  const count = Math.min(TOKENS.length, Math.max(0, Math.floor((frame - 22) / 4) + 1));
  return (
    <Backdrop>
      <SceneHeader step={1} title="Lexical analysis" subtitle="Characters become tokens with exact positions" />
      <div style={{ position: "absolute", left: 150, right: 150, top: 350, display: "flex", flexWrap: "wrap", gap: "44px 22px" }}>
        {TOKENS.map((tok, i) => {
          const p = prog(frame, 22 + i * 4, 14);
          return (
            <div key={i} style={{ opacity: p, translate: `0px ${interpolate(p, [0, 1], [40, 0])}px`, scale: interpolate(p, [0, 1], [0.7, 1]), textAlign: "center" }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 46,
                  fontWeight: 700,
                  padding: "14px 22px",
                  borderRadius: 22,
                  color: tok.color,
                  background: `${tok.color}1f`,
                  border: `3px solid ${tok.color}`,
                }}
              >
                {tok.t}
              </div>
              <div style={{ marginTop: 12, fontSize: 26, color: C.muted, letterSpacing: 1 }}>{tok.type}</div>
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 150, bottom: 90, display: "flex", alignItems: "center", gap: 28, opacity: prog(frame, 30, 20) }}>
        <Pill color={C.primary} size={44}>
          {count} tokens
        </Pill>
        <span style={{ fontSize: 40, color: C.muted }}>Unterminated strings and invalid characters are reported with line and column</span>
      </div>
    </Backdrop>
  );
};
