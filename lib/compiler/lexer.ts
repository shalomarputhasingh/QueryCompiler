import { type Diagnostic, type Position, type Range, makeDiagnostic } from "./diagnostics";
import { type Comment, KEYWORDS, type Token, type TokenType } from "./tokens";

export interface LexResult {
  /** Significant tokens, always terminated by one EOF token. Whitespace and comments are skipped. */
  tokens: Token[];
  comments: Comment[];
  diagnostics: Diagnostic[];
}

const PUNCTUATION = new Set(["(", ")", ",", ".", ";"]);

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

function isIdentStart(c: string | undefined): boolean {
  return c !== undefined && (/[A-Za-z_]/.test(c) || c.charCodeAt(0) > 127);
}

function isIdentPart(c: string | undefined): boolean {
  return isIdentStart(c) || isDigit(c);
}

/** Hand-written scanner: a single left-to-right pass tracking line, column and offset. */
export function lex(source: string): LexResult {
  const tokens: Token[] = [];
  const comments: Comment[] = [];
  const diagnostics: Diagnostic[] = [];

  let offset = 0;
  let line = 1;
  let column = 1;

  const pos = (): Position => ({ line, column, offset });

  /** Advances over one character, keeping line/column in sync (\r\n counts as one break). */
  const advance = (): string => {
    const c = source.charAt(offset);
    offset++;
    if (c === "\n") {
      line++;
      column = 1;
    } else if (c === "\r") {
      if (source.charAt(offset) === "\n") {
        offset++;
      }
      line++;
      column = 1;
    } else {
      column++;
    }
    return c;
  };

  const peek = (ahead = 0): string | undefined => (offset + ahead < source.length ? source.charAt(offset + ahead) : undefined);

  const push = (type: TokenType, start: Position, value?: string | number): void => {
    const end = pos();
    const lexeme = source.slice(start.offset, end.offset);
    tokens.push({ type, lexeme, value: value ?? lexeme, range: { start, end } });
  };

  const error = (code: string, message: string, range: Range, hint?: string): void => {
    diagnostics.push(makeDiagnostic("error", "lexical", code, message, range, hint));
  };

  while (offset < source.length) {
    const c = peek() as string;

    // Whitespace
    if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f" || c === "\v") {
      advance();
      continue;
    }

    const start = pos();

    // Line comment: -- ... end of line
    if (c === "-" && peek(1) === "-") {
      while (offset < source.length && peek() !== "\n" && peek() !== "\r") advance();
      const end = pos();
      comments.push({ text: source.slice(start.offset, end.offset), block: false, range: { start, end } });
      continue;
    }

    // Block comment: /* ... */
    if (c === "/" && peek(1) === "*") {
      advance();
      advance();
      let closed = false;
      while (offset < source.length) {
        if (peek() === "*" && peek(1) === "/") {
          advance();
          advance();
          closed = true;
          break;
        }
        advance();
      }
      const end = pos();
      comments.push({ text: source.slice(start.offset, end.offset), block: true, range: { start, end } });
      if (!closed) {
        error("QC1003", "Unterminated block comment", { start, end }, "Close the comment with */.");
      }
      continue;
    }

    // Identifiers and keywords
    if (isIdentStart(c)) {
      while (isIdentPart(peek())) advance();
      const text = source.slice(start.offset, offset);
      const upper = text.toUpperCase();
      if (KEYWORDS.has(upper)) push("KEYWORD", start, upper);
      else push("IDENTIFIER", start, text);
      continue;
    }

    // Numbers: 12, 3.14, .5, 1e10, 2.5E-3
    if (isDigit(c) || (c === "." && isDigit(peek(1)))) {
      while (isDigit(peek())) advance();
      if (peek() === "." && isDigit(peek(1))) {
        advance();
        while (isDigit(peek())) advance();
      }
      if ((peek() === "e" || peek() === "E") && (isDigit(peek(1)) || ((peek(1) === "+" || peek(1) === "-") && isDigit(peek(2))))) {
        advance();
        if (peek() === "+" || peek() === "-") advance();
        while (isDigit(peek())) advance();
      }
      if (isIdentPart(peek())) {
        // Something like 12abc: consume the whole run so we report one clear error.
        while (isIdentPart(peek())) advance();
        const bad = source.slice(start.offset, offset);
        error("QC1004", `Invalid number or identifier '${bad}'`, { start, end: pos() }, "Identifiers cannot start with a digit; quote them with double quotes.");
        push("INVALID", start);
        continue;
      }
      const text = source.slice(start.offset, offset);
      push("NUMBER", start, Number(text));
      continue;
    }

    // String literal: 'it''s'
    if (c === "'") {
      advance();
      let value = "";
      let closed = false;
      while (offset < source.length) {
        const ch = peek() as string;
        if (ch === "\n" || ch === "\r") break;
        if (ch === "'") {
          if (peek(1) === "'") {
            value += "'";
            advance();
            advance();
            continue;
          }
          advance();
          closed = true;
          break;
        }
        value += advance();
      }
      if (!closed) {
        error(
          "QC1001",
          "Unterminated string literal",
          { start, end: pos() },
          "Add a closing single quote ('). Use two quotes ('') to put a quote inside a string.",
        );
        push("INVALID", start);
      } else {
        push("STRING", start, value);
      }
      continue;
    }

    // Quoted identifiers: "name" or `name`
    if (c === '"' || c === "`") {
      const quote = c;
      advance();
      let value = "";
      let closed = false;
      while (offset < source.length) {
        const ch = peek() as string;
        if (ch === "\n" || ch === "\r") break;
        if (ch === quote) {
          if (peek(1) === quote) {
            value += quote;
            advance();
            advance();
            continue;
          }
          advance();
          closed = true;
          break;
        }
        value += advance();
      }
      if (!closed) {
        error("QC1002", "Unterminated quoted identifier", { start, end: pos() }, `Add a closing ${quote}.`);
        push("INVALID", start);
      } else if (value.length === 0) {
        error("QC1005", "Empty quoted identifier", { start, end: pos() });
        push("INVALID", start);
      } else {
        push("QUOTED_IDENTIFIER", start, value);
      }
      continue;
    }

    // Operators
    if (c === "<" || c === ">" || c === "!" || c === "=") {
      const two = c + (peek(1) ?? "");
      if (two === "<=" || two === ">=" || two === "<>" || two === "!=") {
        advance();
        advance();
        push("OPERATOR", start);
        continue;
      }
      if (c === "!") {
        advance();
        error("QC1006", "Unexpected character '!'", { start, end: pos() }, "Did you mean '!=' (not equal)?");
        push("INVALID", start);
        continue;
      }
      advance();
      push("OPERATOR", start);
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/" || c === "%") {
      advance();
      push("OPERATOR", start);
      continue;
    }

    if (PUNCTUATION.has(c)) {
      advance();
      push("PUNCTUATION", start);
      continue;
    }

    // Anything else is an invalid character.
    advance();
    const printable = c.charCodeAt(0) < 32 ? `U+${c.charCodeAt(0).toString(16).padStart(4, "0")}` : `'${c}'`;
    error("QC1006", `Invalid character ${printable}`, { start, end: pos() }, "Remove the character or place it inside a string literal.");
    push("INVALID", start);
  }

  const eofPos = pos();
  tokens.push({ type: "EOF", lexeme: "", value: "", range: { start: eofPos, end: eofPos } });
  return { tokens, comments, diagnostics };
}
