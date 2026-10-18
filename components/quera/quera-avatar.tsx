import { useId } from "react";
import { cn } from "@/lib/utils/cn";

/** Quera's face: a soft gradient orb with a four-point spark. Glows and turns while she is thinking. */
export function QueraAvatar({ size = 32, thinking = false, className }: { size?: number; thinking?: boolean; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center", className)} style={{ width: size, height: size }} aria-hidden>
      {thinking ? <span data-quera-motion className="absolute inset-0 rounded-full bg-violet-500/50 blur-[3px]" style={{ animation: "quera-pulse 1.6s ease-in-out infinite" }} /> : null}
      <svg viewBox="0 0 40 40" width={size} height={size} className="relative" style={thinking ? { animation: "quera-spin 6s linear infinite" } : undefined} data-quera-motion={thinking ? "" : undefined}>
        <defs>
          <linearGradient id={`g${id}`} x1="4" y1="4" x2="36" y2="36" gradientUnits="userSpaceOnUse">
            <stop stopColor="#8b93ff" />
            <stop offset="0.55" stopColor="#a855f7" />
            <stop offset="1" stopColor="#ec4899" />
          </linearGradient>
          <radialGradient id={`h${id}`} cx="0.3" cy="0.25" r="0.8">
            <stop stopColor="#fff" stopOpacity="0.55" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="20" cy="20" r="19" fill={`url(#g${id})`} />
        <circle cx="20" cy="20" r="19" fill={`url(#h${id})`} />
        <path d="M20 8.5c.9 5.6 3.9 8.6 9.5 9.5-5.6.9-8.6 3.9-9.5 9.5-.9-5.6-3.9-8.6-9.5-9.5 5.6-.9 8.6-3.9 9.5-9.5Z" fill="#fff" />
        <circle cx="29.5" cy="28.5" r="2.1" fill="#fff" fillOpacity="0.85" />
      </svg>
    </span>
  );
}
