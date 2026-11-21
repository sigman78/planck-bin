// Optimized highlight.js configuration
// Only imports commonly used languages instead of all 200+ languages
// This reduces bundle size significantly compared to importing all languages

import hljs from 'highlight.js/lib/core';
import type { HLJSOptions } from 'highlight.js';
import { RangeEmitter, runsFromResult, viewerText } from './syntax-highlights';

// Import only commonly used languages
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';
import scala from 'highlight.js/lib/languages/scala';
import sql from 'highlight.js/lib/languages/sql';
import shell from 'highlight.js/lib/languages/shell';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import markdown from 'highlight.js/lib/languages/markdown';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import nginx from 'highlight.js/lib/languages/nginx';
import perl from 'highlight.js/lib/languages/perl';
import lua from 'highlight.js/lib/languages/lua';
import delphi from 'highlight.js/lib/languages/delphi';
import objectivec from 'highlight.js/lib/languages/objectivec';
import vbscript from 'highlight.js/lib/languages/vbscript';
import vala from 'highlight.js/lib/languages/vala';
import smalltalk from 'highlight.js/lib/languages/smalltalk';
import lisp from 'highlight.js/lib/languages/lisp';
import ini from 'highlight.js/lib/languages/ini';
import diff from 'highlight.js/lib/languages/diff';
import latex from 'highlight.js/lib/languages/latex';
import erlang from 'highlight.js/lib/languages/erlang';
import haskell from 'highlight.js/lib/languages/haskell';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('java', java);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('c', cpp); // C uses same as C++
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('cs', csharp);
hljs.registerLanguage('php', php);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('scala', scala);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('nginx', nginx);
hljs.registerLanguage('perl', perl);
hljs.registerLanguage('pl', perl);
hljs.registerLanguage('lua', lua);
hljs.registerLanguage('delphi', delphi);
hljs.registerLanguage('pas', delphi);
hljs.registerLanguage('objectivec', objectivec);
hljs.registerLanguage('objc', objectivec);
hljs.registerLanguage('m', objectivec);
hljs.registerLanguage('vbscript', vbscript);
hljs.registerLanguage('vbs', vbscript);
hljs.registerLanguage('vala', vala);
hljs.registerLanguage('smalltalk', smalltalk);
hljs.registerLanguage('sm', smalltalk);
hljs.registerLanguage('lisp', lisp);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('latex', latex);
hljs.registerLanguage('tex', latex);
hljs.registerLanguage('erlang', erlang);
hljs.registerLanguage('erl', erlang);
hljs.registerLanguage('haskell', haskell);
hljs.registerLanguage('hs', haskell);

// Record token ranges instead of building a tree and HTML (syntax-highlights.ts).
hljs.configure({ __emitter: RangeEmitter as unknown as HLJSOptions['__emitter'] });

// Additional aliases for common file extensions
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('py', python);
hljs.registerLanguage('rb', ruby);
hljs.registerLanguage('rs', rust);
hljs.registerLanguage('kt', kotlin);
hljs.registerLanguage('htm', xml);
hljs.registerLanguage('cc', cpp);
hljs.registerLanguage('h', cpp);

// Extension to language mapping
export const extensionMap: Record<string, string> = {
  // Scripting languages
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  pl: 'perl',
  php: 'php',
  lua: 'lua',
  vbs: 'vbscript',
  bash: 'bash',
  sh: 'bash',
  // Compiled languages
  java: 'java',
  cpp: 'cpp',
  cc: 'cpp',
  c: 'c',
  h: 'cpp',
  cs: 'cs',
  go: 'go',
  rs: 'rust',
  rust: 'rust',
  swift: 'swift',
  kt: 'kotlin',
  kotlin: 'kotlin',
  scala: 'scala',
  pas: 'delphi',
  m: 'objectivec',
  vala: 'vala',
  // Functional languages
  erl: 'erlang',
  hs: 'haskell',
  lisp: 'lisp',
  sm: 'smalltalk',
  // Markup and data formats
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  tex: 'latex',
  // Database
  sql: 'sql',
  // Configuration and other
  ini: 'ini',
  diff: 'diff',
  dockerfile: 'dockerfile',
  nginx: 'nginx',
  txt: '',
};

export const MAX_AUTO_HIGHLIGHT_LENGTH = 10_000;
export const MAX_EXPLICIT_HIGHLIGHT_LENGTH = 50_000;

/**
 * Language Utilities
 */

/**
 * Get language for file extension
 */
export function getLanguageForExtension(ext: string): string | undefined {
  const normalized = ext.toLowerCase();
  return Object.hasOwn(extensionMap, normalized) ? extensionMap[normalized] : undefined;
}

/**
 * Get extension for language
 */
export function getExtensionForLanguage(language: string): string {
  for (const [ext, lang] of Object.entries(extensionMap)) {
    if (lang === language) return ext;
  }
  return language;
}

/**
 * Resolve a URL extension to a language id: the extension map first, then
 * any registered hljs language name. '' means plain text.
 */
export function resolveLanguage(ext: string): string | undefined {
  const mapped = getLanguageForExtension(ext);
  if (mapped !== undefined) return mapped;
  const normalized = ext.toLowerCase();
  return hljs.getLanguage(normalized) ? normalized : undefined;
}

export interface LanguageOption {
  id: string;
  name: string;
  ext: string;
}

/**
 * Languages offered by the palette: plain text, then each registered hljs
 * language once (aliases collapse by display name), sorted by name.
 * Ids that appear in the extension map are preferred so URLs stay short.
 */
export function listLanguages(): LanguageOption[] {
  const mapped = new Set(Object.values(extensionMap));
  const byName = new Map<string, string>();
  for (const id of hljs.listLanguages()) {
    const name = hljs.getLanguage(id)?.name ?? id;
    const existing = byName.get(name);
    if (existing === undefined || (!mapped.has(existing) && mapped.has(id))) {
      byName.set(name, id);
    }
  }
  const languages = [...byName].map(([name, id]) => ({
    id,
    name,
    ext: getExtensionForLanguage(id),
  }));
  languages.sort((a, b) => a.name.localeCompare(b.name));
  return [{ id: '', name: 'Plain text', ext: 'txt' }, ...languages];
}

/**
 * Highlighted paste: the token runs, resolved against the theme when painted
 * (highlight-theme.ts). Offsets refer to viewerText(content). Null for plain
 * text and for results whose runs could not be mapped.
 */
export interface Highlighted {
  runs: RangeEmitter | null;
}

/**
 * Result of highlighting operation
 */
export interface HighlightResult {
  highlighted: Highlighted;
  language: string | undefined;
}

const plain = (): Highlighted => ({ runs: null });

/**
 * Highlight content with optional language hint
 * Returns both highlighted content and detected/used language
 * This performs highlighting in a single pass to avoid duplicate work
 */
export function highlightContent(content: string, language?: string): HighlightResult {
  // Tokenize what the viewer shows, so run offsets match its text node.
  const text = viewerText(content);

  // Plain text - no highlighting needed
  if (language === 'txt' || language === '') {
    return { highlighted: plain(), language: undefined };
  }

  const canUseLanguage = language && hljs.getLanguage(language);

  // Highlighting is synchronous. Bound attacker-controlled work so opening a
  // large paste cannot freeze the viewer tab.
  if (text.length > (canUseLanguage ? MAX_EXPLICIT_HIGHLIGHT_LENGTH : MAX_AUTO_HIGHLIGHT_LENGTH)) {
    return { highlighted: plain(), language: canUseLanguage ? language : undefined };
  }

  // Language specified - use it directly; otherwise auto-detect
  const result = canUseLanguage ? hljs.highlight(text, { language }) : hljs.highlightAuto(text);
  return {
    highlighted: { runs: runsFromResult(result._emitter, text) },
    language: result.language,
  };
}

export default hljs;
