import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { C, FONT } from "./theme";

export const EASE = Easing.bezier(0.16, 1, 0.3, 1);

/** 0 → 1 progress for something that starts at `start` and takes `dur` frames. */
export const prog = (frame: number, start: number, dur = 18): number =>
  interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: EASE });

export const Backdrop: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: FONT, color: C.text, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${C.border} 2px, transparent 2px)`,
          backgroundSize: "64px 64px",
          opacity: 0.45,
          translate: `${interpolate(frame, [0, 300], [0, -64])}px ${interpolate(frame, [0, 300], [0, -32])}px`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${interpolate(frame, [0, 300], [25, 40])}% 18%, rgba(124,132,255,0.22), transparent 45%), radial-gradient(circle at 85% 90%, rgba(168,85,247,0.16), transparent 40%)`,
        }}
      />
      {children}
    </AbsoluteFill>
  );
};

/** Step badge + title + subtitle shown at the top of every phase scene. */
export const SceneHeader: React.FC<{ step: number; title: string; subtitle: string }> = ({ step, title, subtitle }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: 150, top: 96, right: 150 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 28,
          opacity: prog(frame, 0, 20),
          translate: `0px ${interpolate(prog(frame, 0, 20), [0, 1], [30, 0])}px`,
        }}
      >
        <div
          style={{
            width: 84,
            height: 84,
            borderRadius: 24,
            background: C.primary,
            color: C.bg,
            fontSize: 52,
            fontWeight: 800,
            display: "grid",
            placeItems: "center",
          }}
        >
          {step}
        </div>
        <div>
          <div style={{ fontSize: 84, fontWeight: 800, letterSpacing: -2, lineHeight: 1 }}>{title}</div>
          <div
            style={{
              fontSize: 40,
              color: C.muted,
              marginTop: 12,
              opacity: prog(frame, 8, 20),
            }}
          >
            {subtitle}
          </div>
        </div>
      </div>
    </div>
  );
};

export const Pill: React.FC<{ color: string; children: React.ReactNode; size?: number }> = ({ color, children, size = 30 }) => (
  <span
    style={{
      display: "inline-block",
      padding: "6px 18px",
      borderRadius: 999,
      border: `2px solid ${color}`,
      color,
      fontSize: size,
      fontWeight: 700,
      background: `${color}22`,
    }}
  >
    {children}
  </span>
);

export const Logo: React.FC<{ size: number }> = ({ size }) => (
  <Interactive.Div
    name="Logo"
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.28,
      background: `linear-gradient(135deg, ${C.primary}, #a855f7 60%, #ec4899)`,
      display: "grid",
      placeItems: "center",
    }}
  >
    <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 32 32">
      <path d="M12 9 6 16l6 7M20 9l6 7-6 7" fill="none" stroke="#fff" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </Interactive.Div>
);
