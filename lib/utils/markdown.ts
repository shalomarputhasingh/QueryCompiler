/** Tiny, safe Markdown subset for chat answers. Produces data; React renders it (no HTML injection). */
export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "bold"; v: Inline[] }
  | { t: "italic"; v: Inline[] }
  | { t: "link"; href: string; v: string };

export type Block =
  | { t: "heading"; level: 1 | 2 | 3; v: Inline[] }
  | { t: "p"; v: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][]; start: number }
  | { t: "code"; lang: string; v: string; closed: boolean }
  | { t: "quote"; v: Inline[] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "hr" };

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = (): void => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (c === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "bold", v: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((c === "*" || c === "_") && src[i + 1] !== " " && src[i + 1] !== c) {
      const end = src.indexOf(c, i + 1);
      const wordy = c === "_" ? /\w/.test(src[i - 1] ?? " ") : false; // snake_case stays literal
      if (end > i + 1 && !wordy && src[end - 1] !== " " && !(c === "_" && /\w/.test(src[end + 1] ?? " "))) {
        flush();
        out.push({ t: "italic", v: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (c === "[") {
      const m = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(src.slice(i));
      if (m) {
        flush();
        out.push({ t: "link", href: m[2]!, v: m[1]! });
        i += m[0].length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

const splitRow = (line: string): string[] => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const startsBlock = (l: string): boolean => /^(```|#{1,3}\s|\s*[-*+]\s|\s*\d+[.)]\s|>\s?|---+\s*$)/.test(l);

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (/^```\s*$/.test(lines[i]!)) {
          closed = true;
          i++;
          break;
        }
        body.push(lines[i]!);
        i++;
      }
      blocks.push({ t: "code", lang: (fence[1] ?? "").toLowerCase(), v: body.join("\n"), closed });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ t: "heading", level: h[1]!.length as 1 | 2 | 3, v: parseInline(h[2]!.trim()) });
      i++;
      continue;
    }
    if (/^---+\s*$/.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]!)) {
        items.push(parseInline(lines[i]!.replace(/^\s*[-*+]\s+/, "")));
        i++;
      }
      blocks.push({ t: "ul", items });
      continue;
    }
    const ol = /^\s*(\d+)[.)]\s+/.exec(line);
    if (ol) {
      const items: Inline[][] = [];
      const start = Number(ol[1]);
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) {
        items.push(parseInline(lines[i]!.replace(/^\s*\d+[.)]\s+/, "")));
        i++;
      }
      blocks.push({ t: "ol", items, start });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        q.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ t: "quote", v: parseInline(q.join(" ")) });
      continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      const head = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim() !== "") {
        rows.push(splitRow(lines[i]!).map(parseInline));
        i++;
      }
      blocks.push({ t: "table", head, rows });
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() !== "" && !startsBlock(lines[i]!)) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push({ t: "p", v: parseInline(para.join(" ")) });
  }
  return blocks;
}
