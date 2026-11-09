// The card query language (docs/JIRA-PARITY.md, phase 7): a small, Jira-like syntax.
//
//   status = "In progress" AND assignee = me AND priority >= high
//   labels in (qa, video) OR NOT epic is empty
//   due < 7d AND text ~ "quiz" ORDER BY priority DESC, rank
//
// This file turns text into a tree, and knows nothing about the database (compile.ts
// does that). Errors carry the character offset they're about, so the query bar can
// point at it. Pure; unit-tested in parse.test.ts.

export class QueryError extends Error {
  constructor(
    message: string,
    readonly pos: number,
    readonly end: number = pos + 1,
  ) {
    super(message);
  }
}

export type Op = "=" | "!=" | ">" | ">=" | "<" | "<=" | "~" | "!~" | "in" | "not in" | "is" | "is not";

export type Value =
  | { kind: "str"; v: string; quoted: boolean; pos: number; end: number }
  | { kind: "list"; items: Extract<Value, { kind: "str" }>[]; pos: number; end: number }
  | { kind: "empty"; pos: number; end: number };

export type Node =
  | { kind: "and"; a: Node; b: Node }
  | { kind: "or"; a: Node; b: Node }
  | { kind: "not"; x: Node }
  | { kind: "cmp"; field: string; fieldPos: number; fieldEnd: number; op: Op; value: Value };

export type Order = { field: string; desc: boolean; pos: number; end: number };
export type Query = { where: Node | null; order: Order[] };

type Tok =
  | { t: "word"; v: string; pos: number; end: number }
  | { t: "str"; v: string; pos: number; end: number }
  | { t: "op"; v: string; pos: number; end: number }
  | { t: "("; pos: number; end: number }
  | { t: ")"; pos: number; end: number }
  | { t: ","; pos: number; end: number }
  | { t: "eof"; pos: number; end: number };

const WORD = /[A-Za-z0-9_\-.:@+/#&]/;

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      out.push({ t: c, pos: i, end: i + 1 });
      i++;
      continue;
    }
    if (c === '"' || c === "“" || c === "”" || c === "'") {
      // "double", “curly” or 'single' quotes, like Jira. A name with an apostrophe
      // goes in double quotes: "O'Brien".
      const start = i++;
      const close = c === "'" ? ["'"] : ['"', "”", "“"];
      let v = "";
      while (i < src.length && !close.includes(src[i])) {
        if (src[i] === "\\" && i + 1 < src.length) i++;
        v += src[i++];
      }
      if (i >= src.length) throw new QueryError("This text has no closing quote.", start, src.length);
      i++;
      out.push({ t: "str", v, pos: start, end: i });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "!=" || two === ">=" || two === "<=" || two === "!~") {
      out.push({ t: "op", v: two, pos: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === "=" || c === ">" || c === "<" || c === "~") {
      out.push({ t: "op", v: c, pos: i, end: i + 1 });
      i++;
      continue;
    }
    if (WORD.test(c)) {
      const start = i;
      while (i < src.length && WORD.test(src[i])) i++;
      out.push({ t: "word", v: src.slice(start, i), pos: start, end: i });
      continue;
    }
    throw new QueryError(`Unexpected “${c}”.`, i);
  }
  out.push({ t: "eof", pos: src.length, end: src.length });
  return out;
}

const kw = (tok: Tok, word: string) => tok.t === "word" && tok.v.toLowerCase() === word;

export function parseQuery(src: string): Query {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];

  function expr(): Node {
    let a = and();
    while (kw(peek(), "or")) {
      next();
      a = { kind: "or", a, b: and() };
    }
    return a;
  }
  function and(): Node {
    let a = not();
    for (;;) {
      if (kw(peek(), "and")) {
        next();
        a = { kind: "and", a, b: not() };
      } else break;
    }
    return a;
  }
  function not(): Node {
    if (kw(peek(), "not")) {
      next();
      return { kind: "not", x: not() };
    }
    return atom();
  }
  function atom(): Node {
    const tok = peek();
    if (tok.t === "(") {
      next();
      const e = expr();
      const close = next();
      if (close.t !== ")") throw new QueryError("Missing a closing bracket.", close.pos, close.end);
      return e;
    }
    if (tok.t !== "word" && tok.t !== "str") throw new QueryError(tok.t === "eof" ? "The query ends where a field was expected." : "Expected a field, like status or assignee.", tok.pos, tok.end);
    next();
    const field = tok.v.toLowerCase();
    const op = operator();
    return { kind: "cmp", field, fieldPos: tok.pos, fieldEnd: tok.end, op, value: value(op) };
  }
  function operator(): Op {
    const tok = next();
    if (tok.t === "op") return tok.v as Op;
    if (kw(tok, "in")) return "in";
    if (kw(tok, "is")) {
      if (kw(peek(), "not")) {
        next();
        return "is not";
      }
      return "is";
    }
    if (kw(tok, "not")) {
      const n = next();
      if (kw(n, "in")) return "not in";
      throw new QueryError("Did you mean “not in”?", n.pos, n.end);
    }
    throw new QueryError(tok.t === "eof" ? "The query ends where an operator (=, !=, ~, in…) was expected." : "Expected an operator: =, !=, >, <, ~, in, is…", tok.pos, tok.end);
  }
  function single(): Extract<Value, { kind: "str" }> {
    const tok = next();
    if (tok.t === "word" || tok.t === "str") return { kind: "str", v: tok.v, quoted: tok.t === "str", pos: tok.pos, end: tok.end };
    throw new QueryError(tok.t === "eof" ? "The query ends where a value was expected." : "Expected a value.", tok.pos, tok.end);
  }
  function value(op: Op): Value {
    const tok = peek();
    if (op === "in" || op === "not in") {
      if (tok.t !== "(") throw new QueryError("A list goes in brackets: in (a, b).", tok.pos, tok.end);
      next();
      const items = [single()];
      while (peek().t === ",") {
        next();
        items.push(single());
      }
      const close = next();
      if (close.t !== ")") throw new QueryError("Missing a closing bracket.", close.pos, close.end);
      return { kind: "list", items, pos: tok.pos, end: close.end };
    }
    if ((kw(tok, "empty") || kw(tok, "null")) && tok.t === "word") {
      next();
      return { kind: "empty", pos: tok.pos, end: tok.end };
    }
    if (op === "is" || op === "is not") throw new QueryError("“is” is followed by empty: assignee is empty.", tok.pos, tok.end);
    return single();
  }

  let where: Node | null = null;
  if (!(peek().t === "eof" || kw(peek(), "order"))) where = expr();
  const order: Order[] = [];
  if (kw(peek(), "order")) {
    next();
    const by = next();
    if (!kw(by, "by")) throw new QueryError("Write “order by”.", by.pos, by.end);
    do {
      if (order.length) next();
      const f = next();
      if (f.t !== "word") throw new QueryError("Expected a field to sort by.", f.pos, f.end);
      let desc = false;
      if (kw(peek(), "asc")) next();
      else if (kw(peek(), "desc")) {
        next();
        desc = true;
      }
      order.push({ field: f.v.toLowerCase(), desc, pos: f.pos, end: f.end });
    } while (peek().t === ",");
  }
  const rest = peek();
  if (rest.t !== "eof") throw new QueryError(kw(rest, "and") || kw(rest, "or") ? "Something is missing before this." : "Join conditions with AND or OR.", rest.pos, rest.end);
  return { where, order };
}
