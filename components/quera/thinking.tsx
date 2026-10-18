"use client";

import { useEffect, useState } from "react";
import { QueraAvatar } from "./quera-avatar";

/** Playful, compiler-flavoured status words — shown for any wait, including quota recovery. */
const WORDS = [
  "Quera-ing",
  "Tokenizing your question",
  "Walking the syntax tree",
  "Resolving symbols",
  "Folding constants",
  "Pushing predicates down",
  "Compiling thoughts",
  "Optimizing the answer",
  "Parsing the details",
  "Planning the explanation",
];

export function Thinking() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((n) => (n + 1) % WORDS.length), 2600);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="quera-rise flex items-center gap-2.5" role="status" aria-live="polite" aria-label="Quera is thinking" data-testid="quera-thinking">
      <QueraAvatar size={28} thinking />
      <span key={i} className="quera-word quera-shimmer text-[13.5px] font-medium">
        {WORDS[i]}…
      </span>
    </div>
  );
}
