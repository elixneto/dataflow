import {SCRIPT_IMPORT_PREFIX} from './script-path';

/*
 * The shape of a type a project script exports (an interface or a type alias), read from its code: what the Start's
 * typed input builds its form from. A small reader of the type syntax, not the TypeScript compiler. It reads text,
 * numbers, yes/no, unions of literals and enums (a choice), arrays, tuples, objects (nested, `extends`), records and
 * index signatures (keys and values), unions of objects told apart by a literal field (a discriminated union),
 * Pick/Omit/Partial/Required/Readonly and generic types (their parameters replaced), in the same script or imported from
 * another one (`@myproject/scripts/<path>`). Anything else (any, unknown, functions, intersections...) is `json`: the
 * form edits it as JSON.
 */

export type TypeShape =
  | {kind: 'string'}
  | {kind: 'number'}
  | {kind: 'boolean'}
  | {kind: 'enum'; options: (string | number)[]}
  | {kind: 'array'; of: TypeShape}
  | {kind: 'tuple'; items: TypeShape[]}
  | {kind: 'object'; fields: TypeField[]}
  | {kind: 'record'; of: TypeShape}
  | {kind: 'union'; tag: string; variants: TypeVariant[]}
  | {kind: 'json'};

export type TypeField = {name: string; optional: boolean; shape: TypeShape};

/** one object of a discriminated union: the value of its tag and its other fields */
export type TypeVariant = {value: string | number; fields: TypeField[]};

type Declaration =
  | {kind: 'interface'; params: TypeParam[]; extends: string[]; text: string}
  | {kind: 'alias'; params: TypeParam[]; text: string}
  | {kind: 'enum'; options: (string | number)[]};

type TypeParam = {name: string; fallback?: string};

/** what a type parameter stands for, where its type is read */
type Env = Map<string, TypeShape>;

const JSON_SHAPE: TypeShape = {kind: 'json'};
const NO_ENV: Env = new Map();
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** the code without comments (strings kept) */
function withoutComments(code: string): string {
  return code.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (_all, text: string | undefined) => text ?? ' ');
}

/** from `open` (a `{`, `<`, `(` or `[`), the index of the matching close */
function closing(code: string, open: number): number {
  const pairs: Record<string, string> = {'{': '}', '<': '>', '(': ')', '[': ']'};
  const stack: string[] = [];
  for (let i = open; i < code.length; i++) {
    const c = code[i]!;
    if (c === '"' || c === "'" || c === '`') {
      i = code.indexOf(c, i + 1);
      if (i < 0) return code.length;
      continue;
    }
    // an arrow's `>` is not a generic's close
    if (c === '>' && code[i - 1] === '=') continue;
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack.at(-1)) {
      stack.pop();
      if (stack.length === 0) return i;
    }
  }
  return code.length;
}

/** splits at the top-level `sep` (outside brackets and strings) */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"' || c === "'" || c === '`') i = text.indexOf(c, i + 1) < 0 ? text.length : text.indexOf(c, i + 1);
    else if ('{<(['.includes(c) && !(c === '<' && text[i + 1] === '=')) i = closing(text, i);
    else if (text.startsWith(sep, i) && !(sep === '|' && text[i + 1] === '|')) {
      parts.push(text.slice(from, i));
      from = i + sep.length;
    }
  }
  parts.push(text.slice(from));
  return parts.map(p => p.trim()).filter(p => p !== '');
}

/**
 * An object type's members, one per `;`, `,` or line (a line that goes on, with `|` or after `:`, stays with its
 * member).
 */
function splitMembers(body: string): string[] {
  const members: string[] = [];
  let current = '';
  const push = () => {
    if (current.trim()) members.push(current.trim());
    current = '';
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === '"' || c === "'" || c === '`') {
      const end = body.indexOf(c, i + 1) < 0 ? body.length : body.indexOf(c, i + 1);
      current += body.slice(i, end + 1);
      i = end;
    } else if ('{<(['.includes(c)) {
      const end = closing(body, i);
      current += body.slice(i, end + 1);
      i = end;
    } else if (c === ';' || c === ',') push();
    else if (c === '\n') {
      const next = body.slice(i + 1).trimStart();
      const open = /[:|&=]\s*$/.test(current) || /^[|&]/.test(next);
      if (open) current += ' ';
      else push();
    } else current += c;
  }
  push();
  return members;
}

/** `<T, U = X>` as its parameters */
function typeParams(text: string | undefined): TypeParam[] {
  if (!text) return [];
  return splitTop(text.slice(1, -1), ',').map(p => {
    const [head, fallback] = splitTop(p, '=');
    return {name: head!.split(/\s+extends\s+/)[0]!.trim(), ...(fallback ? {fallback} : {})};
  });
}

/** an enum's values: its strings, its numbers (counting on from the last one) */
function enumOptions(body: string): (string | number)[] {
  let next = 0;
  return splitTop(body, ',').map(member => {
    const [, value] = member.split('=').map(s => s.trim());
    const text = value ? /^(['"])(.*)\1$/.exec(value)?.[2] : undefined;
    if (text !== undefined) return text;
    if (value !== undefined && /^-?\d+(\.\d+)?$/.test(value)) next = Number(value);
    return next++;
  });
}

/** the types a script declares (exported or not: an exported one may use the others) */
function declarations(code: string): Map<string, Declaration> {
  const found = new Map<string, Declaration>();
  const head = /\b(interface|type|enum)\s+([A-Za-z_$][\w$]*)\s*/g;
  for (let m = head.exec(code); m; m = head.exec(code)) {
    const [, kind, name] = m;
    let i = m.index + m[0].length;
    let params: string | undefined;
    if (code[i] === '<') {
      const end = closing(code, i);
      params = code.slice(i, end + 1);
      i = end + 1;
    }
    if (kind === 'enum') {
      const open = code.indexOf('{', i);
      if (open < 0) continue;
      const end = closing(code, open);
      found.set(name!, {kind: 'enum', options: enumOptions(code.slice(open + 1, end))});
      head.lastIndex = end;
    } else if (kind === 'interface') {
      const open = code.indexOf('{', i);
      if (open < 0) continue;
      const parents = code.slice(i, open).trim().replace(/^extends\s+/, '');
      const end = closing(code, open);
      found.set(name!, {kind: 'interface', params: typeParams(params), extends: parents ? splitTop(parents, ',') : [], text: code.slice(open + 1, end)});
      head.lastIndex = end;
    } else {
      const eq = code.indexOf('=', i);
      if (eq < 0 || code.slice(i, eq).trim() !== '') continue;
      // the alias runs to its `;` (or the next declaration), outside brackets
      let j = eq + 1;
      for (; j < code.length; j++) {
        const c = code[j]!;
        if ('{<(['.includes(c)) j = closing(code, j);
        else if (c === ';' || /^\n\s*(export\s+)?(interface|type|enum|function|const|let|class|declare)\b/.test(code.slice(j, j + 40))) break;
      }
      found.set(name!, {kind: 'alias', params: typeParams(params), text: code.slice(eq + 1, j).trim()});
      head.lastIndex = j;
    }
  }
  return found;
}

/** the names a script imports from other project scripts: name → its path */
function importedNames(code: string): Map<string, string> {
  const names = new Map<string, string>();
  const line = /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g;
  for (let m = line.exec(code); m; m = line.exec(code)) {
    if (!m[2]!.startsWith(SCRIPT_IMPORT_PREFIX)) continue;
    for (const part of m[1]!.split(',')) {
      const [original, local] = part.replace(/^\s*type\s+/, '').split(/\s+as\s+/).map(s => s.trim());
      if (original) names.set(local || original, m[2]!.slice(SCRIPT_IMPORT_PREFIX.length));
    }
  }
  return names;
}

/** a literal type's value (`'a'`, `"a"`, `1`), or undefined */
function literalOf(text: string): string | number | undefined {
  const quoted = /^(['"])(.*)\1$/.exec(text);
  if (quoted) return quoted[2]!;
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : undefined;
}

/** the names a utility type takes (`'a' | 'b'`) */
const keyNames = (text: string) => splitTop(text, '|').map(literalOf).filter((k): k is string => typeof k === 'string');

/** an object's fields, through a utility type (Pick, Omit, Partial, Required, Readonly); other shapes as they are */
function applyUtility(name: string, target: TypeShape, keys: string[]): TypeShape {
  if (target.kind !== 'object') return name === 'Readonly' ? target : JSON_SHAPE;
  switch (name) {
    case 'Pick': return {kind: 'object', fields: target.fields.filter(f => keys.includes(f.name))};
    case 'Omit': return {kind: 'object', fields: target.fields.filter(f => !keys.includes(f.name))};
    case 'Partial': return {kind: 'object', fields: target.fields.map(f => ({...f, optional: true}))};
    case 'Required': return {kind: 'object', fields: target.fields.map(f => ({...f, optional: false}))};
    default: return target;
  }
}

/** a union of objects that one literal field tells apart, or null */
function discriminated(objects: Extract<TypeShape, {kind: 'object'}>[]): TypeShape | null {
  const first = objects[0];
  if (!first) return null;
  for (const candidate of first.fields) {
    const values = objects.map(o => {
      const field = o.fields.find(f => f.name === candidate.name);
      return field && !field.optional && field.shape.kind === 'enum' && field.shape.options.length === 1 ? field.shape.options[0]! : undefined;
    });
    if (values.some(v => v === undefined) || new Set(values).size !== values.length) continue;
    return {
      kind: 'union',
      tag: candidate.name,
      variants: objects.map((o, i) => ({value: values[i]!, fields: o.fields.filter(f => f.name !== candidate.name)})),
    };
  }
  return null;
}

/** reads types across the project's scripts (`sources`: path → code; a script not loaded yet reads as json) */
class TypeReader {
  private readonly parsed = new Map<string, {declared: Map<string, Declaration>; imports: Map<string, string>}>();
  private depth = 0;

  constructor(private readonly sources: Record<string, string>) {}

  private script(path: string) {
    let known = this.parsed.get(path);
    if (!known && path in this.sources) {
      const code = withoutComments(this.sources[path]!);
      known = {declared: declarations(code), imports: importedNames(code)};
      this.parsed.set(path, known);
    }
    return known;
  }

  /** whether a script declares or imports the name */
  has(path: string, name: string): boolean {
    const script = this.script(path);
    return !!script && (script.declared.has(name) || script.imports.has(name));
  }

  /** a type named in a script (its own or the one it imports), with its type arguments */
  named(path: string, name: string, args: TypeShape[] = []): TypeShape {
    const script = this.script(path);
    if (!script || this.depth > 16) return JSON_SHAPE;
    const own = script.declared.get(name);
    if (!own) {
      const from = script.imports.get(name);
      return from ? this.named(from, name, args) : JSON_SHAPE;
    }
    if (own.kind === 'enum') return {kind: 'enum', options: own.options};
    this.depth += 1;
    try {
      const env: Env = new Map();
      own.params.forEach((p, i) => env.set(p.name, args[i] ?? (p.fallback ? this.type(path, p.fallback, env) : JSON_SHAPE)));
      if (own.kind === 'alias') return this.type(path, own.text, env);
      const fields = own.extends.flatMap(parent => {
        const shape = this.type(path, parent, env);
        return shape.kind === 'object' ? shape.fields : [];
      });
      const body = this.members(path, own.text, env);
      if (body.kind === 'record') return fields.length ? {kind: 'object', fields} : body;
      for (const field of body.fields) {
        const at = fields.findIndex(f => f.name === field.name);
        if (at >= 0) fields[at] = field;
        else fields.push(field);
      }
      return {kind: 'object', fields};
    } finally {
      this.depth -= 1;
    }
  }

  /**
   * An object type's members (`name?: type`); methods are left out. With only an index signature (`[key: string]: T`),
   * a record of T.
   */
  private members(path: string, body: string, env: Env): Extract<TypeShape, {kind: 'object' | 'record'}> {
    const fields: TypeField[] = [];
    let index: TypeShape | undefined;
    for (const member of splitMembers(body)) {
      const signature = /^(?:readonly\s+)?\[\s*[A-Za-z_$][\w$]*\s*:\s*(string|number)\s*\]\s*:\s*([\s\S]+)$/.exec(member);
      if (signature) {
        index = this.type(path, signature[2]!, env);
        continue;
      }
      const m = /^(?:readonly\s+)?(?:(['"])(.+?)\1|([A-Za-z_$][\w$]*))\s*(\?)?\s*:\s*([\s\S]+)$/.exec(member);
      if (!m) continue;
      fields.push({name: m[2] ?? m[3]!, optional: m[4] === '?', shape: this.type(path, m[5]!, env)});
    }
    return index && fields.length === 0 ? {kind: 'record', of: index} : {kind: 'object', fields};
  }

  /** a type expression, its type parameters from `env` */
  type(path: string, text: string, env: Env = NO_ENV): TypeShape {
    const t = text.trim().replace(/^readonly\s+/, '');
    const union = splitTop(t.replace(/^\|/, ''), '|');
    if (union.length > 1) {
      // `T | null` / `T | undefined`: T (left empty, it is not sent)
      const real = union.filter(u => u !== 'null' && u !== 'undefined');
      if (real.length === 1) return this.type(path, real[0]!, env);
      const literals = real.map(literalOf);
      if (literals.every(l => l !== undefined)) return {kind: 'enum', options: literals as (string | number)[]};
      const members = real.map(u => this.type(path, u, env));
      // enums and literals together: one choice
      if (members.every(m => m.kind === 'enum')) return {kind: 'enum', options: members.flatMap(m => (m.kind === 'enum' ? m.options : []))};
      if (members.every(m => m.kind === 'object')) return discriminated(members as Extract<TypeShape, {kind: 'object'}>[]) ?? JSON_SHAPE;
      return JSON_SHAPE;
    }
    if (t.endsWith('[]') && closing(t, t.length - 2) === t.length - 1) return {kind: 'array', of: this.type(path, t.slice(0, -2), env)};
    if (t.startsWith('(') && closing(t, 0) === t.length - 1) return this.type(path, t.slice(1, -1), env);
    if (t.startsWith('[') && closing(t, 0) === t.length - 1) {
      const items = splitTop(t.slice(1, -1), ',');
      return items.some(i => i.startsWith('...') || i.endsWith('?')) ? JSON_SHAPE : {kind: 'tuple', items: items.map(i => this.type(path, i.replace(/^[A-Za-z_$][\w$]*\s*:\s*/, ''), env))};
    }
    if (t.startsWith('{') && closing(t, 0) === t.length - 1) {
      this.depth += 1;
      try {
        return this.members(path, t.slice(1, -1), env);
      } finally {
        this.depth -= 1;
      }
    }
    if (t === 'string' || t === 'Date') return {kind: 'string'};
    if (t === 'number' || t === 'bigint') return {kind: 'number'};
    if (t === 'boolean') return {kind: 'boolean'};
    const literal = literalOf(t);
    if (literal !== undefined) return {kind: 'enum', options: [literal]};
    if (t === 'true' || t === 'false') return {kind: 'enum', options: [t]};
    // a name with type arguments: Array<T>, Record<K, T>, a utility type, a generic of the scripts
    const generic = /^([A-Za-z_$][\w$.]*)\s*<([\s\S]*)>$/.exec(t);
    if (generic && closing(t, t.indexOf('<')) === t.length - 1) {
      const [, name, inner] = generic;
      const args = splitTop(inner!, ',');
      if (name === 'Array' || name === 'ReadonlyArray') return {kind: 'array', of: this.type(path, args[0] ?? '', env)};
      if (name === 'Record') return /^(string|number)$/.test(args[0] ?? '') ? {kind: 'record', of: this.type(path, args[1] ?? '', env)} : JSON_SHAPE;
      if (name === 'Pick' || name === 'Omit') return applyUtility(name, this.type(path, args[0] ?? '', env), keyNames(args[1] ?? ''));
      if (name === 'Partial' || name === 'Required' || name === 'Readonly') return applyUtility(name, this.type(path, args[0] ?? '', env), []);
      if (!env.has(name!) && IDENTIFIER.test(name!)) return this.named(path, name!, args.map(a => this.type(path, a, env)));
      return JSON_SHAPE;
    }
    if (IDENTIFIER.test(t)) return env.get(t) ?? this.named(path, t);
    // an enum's member (`Priority.High`): that value
    const member = /^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/.exec(t);
    if (member) return this.named(path, member[1]!);
    return JSON_SHAPE;
  }
}

/**
 * The shape of the type `name` that the script at `path` declares (or imports), reading the scripts in `sources`
 * (path → code). Null when the script does not declare it.
 */
export function scriptTypeShape(sources: Record<string, string>, path: string, name: string): TypeShape | null {
  if (!(path in sources)) return null;
  const reader = new TypeReader(sources);
  return reader.has(path, name) ? reader.named(path, name) : null;
}

/** a value of the shape to start from: empty text, 0, false, the first option, no items, each required field's own */
export function emptyOfShape(shape: TypeShape): unknown {
  switch (shape.kind) {
    case 'string': return '';
    case 'number': return 0;
    case 'boolean': return false;
    case 'enum': return shape.options[0] ?? null;
    case 'array': return [];
    case 'tuple': return shape.items.map(emptyOfShape);
    case 'object': return Object.fromEntries(shape.fields.filter(f => !f.optional).map(f => [f.name, emptyOfShape(f.shape)]));
    case 'record': return {};
    case 'union': return shape.variants[0] ? unionValue(shape, shape.variants[0].value) : null;
    case 'json': return null;
  }
}

/** a discriminated union's value for one of its variants: its tag and that variant's empty fields */
export function unionValue(shape: Extract<TypeShape, {kind: 'union'}>, value: string | number): Record<string, unknown> {
  const variant = shape.variants.find(v => v.value === value);
  return {[shape.tag]: value, ...(variant ? (emptyOfShape({kind: 'object', fields: variant.fields}) as Record<string, unknown>) : {})};
}

/** a Start's input type: the script and the type, from the setting's `path#Name` */
export function inputTypeRef(value: unknown): {path: string; name: string} | null {
  if (typeof value !== 'string') return null;
  const at = value.lastIndexOf('#');
  return at > 0 && at < value.length - 1 ? {path: value.slice(0, at), name: value.slice(at + 1)} : null;
}
