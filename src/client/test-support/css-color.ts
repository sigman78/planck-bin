/**
 * Test support: resolve the color tokens of tokens.css / themes.css and
 * measure them. Covers only the syntax those files use: custom properties on
 * :root and html[data-theme="..."], var(), calc() with + - * /, oklch() and
 * relative oklch(from <color> ...). Not part of the bundle.
 */

export interface Oklch {
  l: number;
  c: number;
  h: number;
  alpha: number;
}

export type Declarations = Map<string, string>;

/** Custom properties per block: '' for :root, the theme id for html[data-theme="id"]. */
export function parseTokenBlocks(css: string): Map<string, Declarations> {
  const blocks = new Map<string, Declarations>();
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of text.matchAll(blockRe)) {
    const selector = m[1].trim();
    let id: string | null = null;
    if (selector === ':root') id = '';
    else {
      const t = /^(?::root|html)\[data-theme="([\w-]+)"\]$/.exec(selector);
      if (t) id = t[1];
    }
    if (id === null) continue;
    const decls = blocks.get(id) ?? new Map<string, string>();
    for (const d of m[2].split(';')) {
      const at = d.indexOf(':');
      if (at === -1) continue;
      const name = d.slice(0, at).trim();
      if (name.startsWith('--')) decls.set(name, d.slice(at + 1).trim());
    }
    blocks.set(id, decls);
  }
  return blocks;
}

/** Declarations in effect for a theme: :root, overridden by the theme block. */
export function themeScope(blocks: Map<string, Declarations>, id: string): Declarations {
  return new Map([...(blocks.get('') ?? []), ...(id ? (blocks.get(id) ?? []) : [])]);
}

/** Substitute var() references (no fallbacks needed). */
export function substitute(value: string, scope: Declarations, depth = 0): string {
  if (depth > 32) throw new Error(`var() cycle in ${value}`);
  return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => {
    const v = scope.get(name);
    if (v === undefined) throw new Error(`undefined ${name}`);
    return substitute(v, scope, depth + 1);
  });
}

/** Split on top-level whitespace and '/', keeping parenthesized groups whole. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && (ch === ' ' || ch === '\n' || ch === '\t' || ch === '/')) {
      if (cur) out.push(cur);
      if (ch === '/') out.push('/');
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Evaluate a number, keyword or calc() expression; keywords from `env`. */
function evalNumber(src: string, env: Record<string, number>): number {
  const expr = src.replace(/calc\(/g, '(');
  const tokens = expr.match(/\d*\.?\d+(?:e-?\d+)?|[a-z]+|[-+*/()]/gi) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const atom = (): number => {
    const t = tokens[i++];
    if (t === '(') {
      const v = sum();
      i++; // ')'
      return v;
    }
    if (t === '-') return -atom();
    if (t in env) return env[t];
    const n = Number(t);
    if (Number.isNaN(n)) throw new Error(`bad number ${t} in ${src}`);
    return n;
  };
  const product = (): number => {
    let v = atom();
    while (peek() === '*' || peek() === '/') v = tokens[i++] === '*' ? v * atom() : v / atom();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === '+' || peek() === '-')
      v = tokens[i++] === '+' ? v + product() : v - product();
    return v;
  };
  return sum();
}

/** Parse an (already substituted) oklch() color. */
export function parseOklch(value: string): Oklch {
  const m = /^oklch\(([\s\S]*)\)$/.exec(value.trim());
  if (!m) throw new Error(`not an oklch() color: ${value}`);
  let args = splitArgs(m[1]);
  let env: Record<string, number> = {};
  let base: Oklch = { l: 0, c: 0, h: 0, alpha: 1 };
  if (args[0] === 'from') {
    base = parseOklch(args[1]);
    env = { l: base.l, c: base.c, h: base.h, alpha: base.alpha };
    args = args.slice(2);
  }
  const slash = args.indexOf('/');
  const channels = slash === -1 ? args : args.slice(0, slash);
  const alpha = slash === -1 ? base.alpha : evalNumber(args[slash + 1], env);
  const [l, c, h] = channels.map((a) => evalNumber(a, env));
  return { l, c, h, alpha };
}

export function resolveColor(name: string, scope: Declarations): Oklch {
  return parseOklch(substitute(`var(${name})`, scope));
}

/** Linear sRGB channels; out-of-gamut values fall outside [0, 1]. */
export function toLinearSrgb({ l, c, h }: Oklch): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const GAMUT_EPS = 0.002;

export function inSrgb(color: Oklch): boolean {
  return toLinearSrgb(color).every((v) => v >= -GAMUT_EPS && v <= 1 + GAMUT_EPS);
}

const encode = (v: number) => {
  const x = Math.min(Math.max(v, 0), 1);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};

export function toHex(color: Oklch): string {
  return (
    '#' +
    toLinearSrgb(color)
      .map((v) =>
        Math.round(encode(v) * 255)
          .toString(16)
          .padStart(2, '0')
      )
      .join('')
  );
}

/** Source-over composite of a translucent color on an opaque one, in sRGB. */
function compositeRgb(fg: Oklch, bg: Oklch): [number, number, number] {
  const f = toLinearSrgb(fg).map(encode);
  const b = toLinearSrgb(bg).map(encode);
  return f.map((v, i) => v * fg.alpha + b[i] * (1 - fg.alpha)) as [number, number, number];
}

const luminance = (rgb: [number, number, number]) => {
  const lin = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

/** WCAG 2 contrast ratio of fg (alpha composited) over an opaque bg. */
export function contrast(fg: Oklch, bg: Oklch): number {
  const a = luminance(compositeRgb(fg, bg));
  const b = luminance(compositeRgb(bg, bg));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
