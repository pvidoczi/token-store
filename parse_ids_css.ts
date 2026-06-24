import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RgbaValue {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface AliasValue {
  type: 'VARIABLE_ALIAS';
  id: string; // "VariableID:<key>/<nodeId>" OR "VariableID:<nodeId>"
}

type ModeValue = RgbaValue | AliasValue | number | string;

interface Variable {
  key: string;
  name: string;
  resolvedType: string;
  valuesByMode: Record<string, ModeValue>;
}

interface TokenFile {
  libraryName?: string;
  collectionName: string;
  variables: Variable[];
}

// Bundled format (e.g. button-json)
interface BundledFile {
  exportedAt?: string;
  fileName?: string;
  collections: TokenFile[];
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const FOUNDATION_DIR = path.join(ROOT, 'foundation');
const COMPONENTS_DIR = path.join(ROOT, 'components');
const OUTPUT_DIR = path.join(ROOT, 'ids_css');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function readJson<T = unknown>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function sanitize(s: string): string {
  return String(s)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nameToCssVar(name: string, modeSuffix?: string): string {
  const segments = name.split('/').map(sanitize).filter(Boolean);
  let parts: string[];

  // comp/* variables: drop the collection-type segment (index 1: "color" or "size")
  // Also handles "comp/comp/color/..." format (drop indices 1 and 2)
  if (segments[0] === 'comp') {
    if (segments[1] === 'comp') {
      // Bundled format: comp/comp/color/... → ids-comp-{rest}
      parts = ['ids', 'comp', ...segments.slice(3)];
    } else {
      // Standard format: comp/color/... or comp/size/... → ids-comp-{rest}
      parts = ['ids', 'comp', ...segments.slice(2)];
    }
  } else {
    parts = ['ids', ...segments];
  }

  if (modeSuffix) parts.push(sanitize(modeSuffix));
  return '--' + parts.join('-');
}

function rgbaToHex(r: number, g: number, b: number, a: number): string {
  const toHex = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, '0');
  if (a < 1) {
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${parseFloat(a.toFixed(4))})`;
  }
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function extractAliasKey(id: string): string | null {
  // Format 1: "VariableID:<40-hex-key>/<nodeId>" → key-based
  const m1 = id.match(/^VariableID:([0-9a-f]{40})\//i);
  if (m1) return m1[1];
  return null;
}

// ─── Global registry: variableKey → cssVarName ───────────────────────────────

const globalRegistry = new Map<string, string>();
let registryUnresolved = 0;

function registerTokenFile(data: TokenFile, modeSuffixes?: string[]) {
  for (const v of data.variables) {
    if (modeSuffixes && modeSuffixes.length > 0) {
      for (const suffix of modeSuffixes) {
        if (!globalRegistry.has(v.key)) {
          globalRegistry.set(v.key, nameToCssVar(v.name, suffix));
        }
      }
    } else {
      if (!globalRegistry.has(v.key)) {
        globalRegistry.set(v.key, nameToCssVar(v.name));
      }
    }
  }
}

// ─── Value resolution ─────────────────────────────────────────────────────────

function resolveValue(modeValue: ModeValue): string | null {
  if (modeValue === null || modeValue === undefined) return null;

  // VARIABLE_ALIAS
  if (typeof modeValue === 'object' && 'type' in modeValue && modeValue.type === 'VARIABLE_ALIAS') {
    const targetKey = extractAliasKey(modeValue.id);
    if (targetKey) {
      const targetCssVar = globalRegistry.get(targetKey);
      if (targetCssVar) return `var(${targetCssVar})`;
    }
    return null; // unresolvable
  }

  // RGBA color
  if (typeof modeValue === 'object' && 'r' in modeValue) {
    const { r, g, b, a } = modeValue as RgbaValue;
    return rgbaToHex(r, g, b, a);
  }

  // Number or string
  if (typeof modeValue === 'number') return String(modeValue);
  if (typeof modeValue === 'string') return modeValue;

  return null;
}

// ─── CSS block generation ─────────────────────────────────────────────────────

interface TokenEntry {
  cssVar: string;
  value: string;
  resolved: boolean;
}

function buildCssBlock(selector: string, entries: TokenEntry[], includeUnresolved = false): string {
  const all = includeUnresolved ? entries : entries.filter((e) => e.resolved);
  const sorted = [...all].sort((a, b) => a.cssVar.localeCompare(b.cssVar));
  const lines = [`${selector} {`];
  for (const e of sorted) {
    if (e.resolved) {
      lines.push(`  ${e.cssVar}: ${e.value};`);
    } else if (includeUnresolved) {
      lines.push(`  /* ${e.cssVar}: unresolved; */`);
    }
  }
  lines.push('}', '');
  return lines.join('\n');
}

// ─── Collect all JSON files recursively ──────────────────────────────────────

function findJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const result: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      result.push(...findJsonFiles(p));
    } else if (e.name.endsWith('.json')) {
      result.push(p);
    }
  }
  return result;
}

// Check if file has bundled format
function isBundledFormat(data: unknown): data is BundledFile {
  return typeof data === 'object' && data !== null && 'collections' in data && Array.isArray((data as BundledFile).collections);
}

function isTokenFile(data: unknown): data is TokenFile {
  return typeof data === 'object' && data !== null && 'variables' in data && Array.isArray((data as TokenFile).variables);
}

// ─── Pass 1: Build global registry ───────────────────────────────────────────

function buildRegistry() {
  // Foundation files
  const foundationFiles = findJsonFiles(FOUNDATION_DIR);
  for (const fp of foundationFiles) {
    try {
      const raw = readJson(fp);
      if (!isTokenFile(raw)) continue;
      const data = raw as TokenFile;
      if (data.collectionName === 'smc-layout') {
        registerTokenFile(data, ['small', 'medium', 'large', 'xlarge']);
      } else {
        registerTokenFile(data);
      }
    } catch { /* skip */ }
  }

  // Component files
  const compFiles = findJsonFiles(COMPONENTS_DIR);
  for (const fp of compFiles) {
    try {
      const raw = readJson(fp);
      if (!isTokenFile(raw)) continue;
      const data = raw as TokenFile;
      if (data.collectionName === 'comp-size') {
        const sizeSuffix = path.basename(fp, '.json').toLowerCase();
        registerTokenFile(data, [sizeSuffix]);
      } else {
        registerTokenFile(data);
      }
    } catch { /* skip */ }
  }

  // Also register any bundled files in root (for cross-reference)
  const rootFiles = fs.readdirSync(ROOT).filter((f) => {
    const full = path.join(ROOT, f);
    return fs.statSync(full).isFile() && !f.endsWith('.ts') && !f.endsWith('.js') && !f.endsWith('.css');
  });

  for (const rf of rootFiles) {
    try {
      const full = path.join(ROOT, rf);
      const raw = readJson(full);
      if (isBundledFormat(raw)) {
        for (const coll of (raw as BundledFile).collections) {
          if (!isTokenFile(coll)) continue;
          if (coll.collectionName === 'smc-layout') {
            registerTokenFile(coll, ['small', 'medium', 'large', 'xlarge']);
          } else if (coll.collectionName === 'comp-size') {
            registerTokenFile(coll, ['comfortable', 'compact', 'dense', 'spacious']);
          } else {
            registerTokenFile(coll);
          }
        }
      }
    } catch { /* skip */ }
  }
}

// ─── base.css ─────────────────────────────────────────────────────────────────

function generateBaseCss() {
  const basePath = path.join(FOUNDATION_DIR, 'base', 'base.json');
  if (!fs.existsSync(basePath)) { console.warn('base.json not found'); return; }

  const data = readJson<TokenFile>(basePath);
  const modeId = Object.keys(data.variables[0]?.valuesByMode ?? {})[0];

  const entries: TokenEntry[] = [];
  for (const v of data.variables) {
    const val = resolveValue(v.valuesByMode[modeId]);
    entries.push({ cssVar: nameToCssVar(v.name), value: val ?? '', resolved: val !== null });
  }

  const resolved = entries.filter((e) => e.resolved).length;
  const output = buildCssBlock(':root', entries);
  const outPath = path.join(OUTPUT_DIR, 'base', 'base.css');
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, output, 'utf-8');
  console.log(`✓ base/base.css (${resolved}/${entries.length} tokens resolved)`);
}

// ─── smc-colors.css ───────────────────────────────────────────────────────────

function generateSmcColorsCss() {
  const darkPath = path.join(FOUNDATION_DIR, 'smc-colors', 'dark.json');
  if (!fs.existsSync(darkPath)) { console.warn('smc-colors/dark.json not found'); return; }

  const data = readJson<TokenFile>(darkPath);
  const allModeIds = Object.keys(data.variables[0]?.valuesByMode ?? {});
  if (allModeIds.length < 2) { console.warn('smc-colors: expected at least 2 modes'); return; }

  // First mode (2002:54) = light theme, second mode (2002:55) = dark theme
  const [lightModeId, darkModeId] = allModeIds;
  const darkEntries: TokenEntry[] = [];
  const lightEntries: TokenEntry[] = [];

  for (const v of data.variables) {
    const cssVar = nameToCssVar(v.name);
    const dv = resolveValue(v.valuesByMode[darkModeId]);
    darkEntries.push({ cssVar, value: dv ?? '', resolved: dv !== null });
    const lv = resolveValue(v.valuesByMode[lightModeId]);
    lightEntries.push({ cssVar, value: lv ?? '', resolved: lv !== null });
  }

  const darkResolved = darkEntries.filter((e) => e.resolved).length;
  const lightResolved = lightEntries.filter((e) => e.resolved).length;

  const blocks = [
    buildCssBlock('.ids-theme-dark', darkEntries),
    buildCssBlock('.ids-theme-light', lightEntries),
  ];

  const outPath = path.join(OUTPUT_DIR, 'smc', 'smc-colors.css');
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, blocks.join('\n'), 'utf-8');
  console.log(`✓ smc/smc-colors.css (dark: ${darkResolved}/${darkEntries.length}, light: ${lightResolved}/${lightEntries.length} resolved)`);
}

// ─── smc-layout.css ───────────────────────────────────────────────────────────

const LAYOUT_MODE_ORDER = ['small', 'medium', 'large', 'xlarge'];

function generateSmcLayoutCss() {
  const layoutDir = path.join(FOUNDATION_DIR, 'smc-layout');
  if (!fs.existsSync(layoutDir)) { console.warn('smc-layout directory not found'); return; }

  const layoutFiles = fs.readdirSync(layoutDir).filter((f) => f.endsWith('.json')).sort();
  if (layoutFiles.length === 0) return;

  const data = readJson<TokenFile>(path.join(layoutDir, layoutFiles[0]));
  const modeIds = Object.keys(data.variables[0]?.valuesByMode ?? {}).sort();
  const modeToName: Record<string, string> = {};
  for (let i = 0; i < modeIds.length && i < LAYOUT_MODE_ORDER.length; i++) {
    modeToName[modeIds[i]] = LAYOUT_MODE_ORDER[i];
  }

  const entries: TokenEntry[] = [];
  for (const v of data.variables) {
    for (const [modeId, modeName] of Object.entries(modeToName)) {
      const val = resolveValue(v.valuesByMode[modeId]);
      entries.push({ cssVar: nameToCssVar(v.name, modeName), value: val ?? '', resolved: val !== null });
    }
  }

  const resolved = entries.filter((e) => e.resolved).length;
  const output = buildCssBlock(':root', entries);
  const outPath = path.join(OUTPUT_DIR, 'smc', 'smc-layout.css');
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, output, 'utf-8');
  console.log(`✓ smc/smc-layout.css (${resolved}/${entries.length} tokens resolved)`);
}

// ─── smc-reference.css ────────────────────────────────────────────────────────

function generateSmcReferenceCss() {
  const refPath = path.join(FOUNDATION_DIR, 'smc-reference', 'smc-reference.json');
  if (!fs.existsSync(refPath)) { console.warn('smc-reference.json not found'); return; }

  const data = readJson<TokenFile>(refPath);
  const modeId = Object.keys(data.variables[0]?.valuesByMode ?? {})[0];

  const entries: TokenEntry[] = [];
  for (const v of data.variables) {
    const val = resolveValue(v.valuesByMode[modeId]);
    entries.push({ cssVar: nameToCssVar(v.name), value: val ?? '', resolved: val !== null });
  }

  const resolved = entries.filter((e) => e.resolved).length;
  const output = buildCssBlock(':root', entries);
  const outPath = path.join(OUTPUT_DIR, 'smc', 'smc-reference.css');
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, output, 'utf-8');
  console.log(`✓ smc/smc-reference.css (${resolved}/${entries.length} tokens resolved)`);
}

// ─── component.css ────────────────────────────────────────────────────────────

const COMP_SIZE_ORDER = ['comfortable', 'compact', 'dense', 'spacious'];

function generateComponentCss() {
  const allEntries: TokenEntry[] = [];
  const processedDirs = new Set<string>();

  if (!fs.existsSync(COMPONENTS_DIR)) { console.warn('components directory not found'); return; }

  const compDirs = fs
    .readdirSync(COMPONENTS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'foundation')
    .map((e) => path.join(COMPONENTS_DIR, e.name));

  for (const compDir of compDirs) {
    // ── comp-color ─────────────────────────────────────────────────────────
    const colorDir = path.join(compDir, 'comp-color');
    if (fs.existsSync(colorDir) && !processedDirs.has(colorDir)) {
      processedDirs.add(colorDir);
      const colorFiles = fs.readdirSync(colorDir).filter((f) => f.endsWith('.json'));
      for (const cf of colorFiles) {
        const data = readJson<TokenFile>(path.join(colorDir, cf));
        const modeId = Object.keys(data.variables[0]?.valuesByMode ?? {})[0];
        for (const v of data.variables) {
          const val = resolveValue(v.valuesByMode[modeId]);
          allEntries.push({ cssVar: nameToCssVar(v.name), value: val ?? '', resolved: val !== null });
        }
      }
    }

    // ── comp-size ──────────────────────────────────────────────────────────
    const sizeDir = path.join(compDir, 'comp-size');
    if (fs.existsSync(sizeDir) && !processedDirs.has(sizeDir)) {
      processedDirs.add(sizeDir);
      const sizeFiles = fs.readdirSync(sizeDir).filter((f) => f.endsWith('.json')).sort();
      if (sizeFiles.length === 0) continue;

      // Use one file (all are identical), get all mode IDs
      const firstData = readJson<TokenFile>(path.join(sizeDir, sizeFiles[0]));
      const allModeIds = Object.keys(firstData.variables[0]?.valuesByMode ?? {}).sort();
      const modeToSuffix: Record<string, string> = {};
      for (let i = 0; i < allModeIds.length && i < COMP_SIZE_ORDER.length; i++) {
        modeToSuffix[allModeIds[i]] = COMP_SIZE_ORDER[i];
      }

      for (const v of firstData.variables) {
        for (const [modeId, suffix] of Object.entries(modeToSuffix)) {
          const val = resolveValue(v.valuesByMode[modeId]);
          allEntries.push({ cssVar: nameToCssVar(v.name, suffix), value: val ?? '', resolved: val !== null });
        }
      }
    }
  }

  // Deduplicate by cssVar (keep first occurrence)
  const seen = new Set<string>();
  const deduped = allEntries.filter((e) => {
    if (seen.has(e.cssVar)) return false;
    seen.add(e.cssVar);
    return true;
  });

  const resolved = deduped.filter((e) => e.resolved).length;
  // Output resolved vars; output unresolved as comments
  const output = buildCssBlock(':root', deduped, true);
  const outPath = path.join(OUTPUT_DIR, 'component', 'component.css');
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, output, 'utf-8');
  console.log(`✓ component/component.css (${resolved}/${deduped.length} tokens resolved, ${deduped.length - resolved} commented-out)`);
}

// ─── tokens.css ───────────────────────────────────────────────────────────────

function generateTokensCss() {
  const content = [
    '/* IDS Design Token CSS - Auto-generated */',
    '/* Import order: base → smc-colors → smc-layout → smc-reference → component */',
    '',
    '@import "./base/base.css";',
    '@import "./smc/smc-colors.css";',
    '@import "./smc/smc-layout.css";',
    '@import "./smc/smc-reference.css";',
    '@import "./component/component.css";',
    '',
  ].join('\n');

  const outPath = path.join(OUTPUT_DIR, 'tokens.css');
  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, content, 'utf-8');
  console.log('✓ tokens.css');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log('Building global variable registry…');
  buildRegistry();
  console.log(`Registry: ${globalRegistry.size} variable keys indexed`);

  ensureDir(OUTPUT_DIR);

  console.log('\nGenerating CSS files…');
  generateBaseCss();
  generateSmcColorsCss();
  generateSmcLayoutCss();
  generateSmcReferenceCss();
  generateComponentCss();
  generateTokensCss();

  console.log('\n✅ Done! Output in:', path.relative(ROOT, OUTPUT_DIR));
  console.log('\nNote: "unresolved" tokens reference variables from external Figma libraries');
  console.log('      not included in the local JSON export. They appear as CSS comments.');
}

main();


