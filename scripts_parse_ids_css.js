// @ts-check
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// ─── Paths ────────────────────────────────────────────────────────────────────

const ROOT_DIR = process.cwd();
const FOUNDATION_DIR = path.join(ROOT_DIR, 'foundation');
const COMPONENTS_DIR = path.join(ROOT_DIR, 'components');
const OUTPUT_DIR = path.join(ROOT_DIR, 'ids_css');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function sanitize(s) {
    return String(s)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// ─── Foundation CSS var naming (old Figma format) ────────────────────────────

function nameToCssVar(name, modeSuffix) {
    const segments = name.split('/').map(sanitize).filter(Boolean);
    let parts;

    if (segments[0] === 'comp') {
        if (segments[1] === 'comp') {
            parts = ['ids', 'comp', ...segments.slice(3)];
        } else {
            parts = ['ids', 'comp', ...segments.slice(2)];
        }
    } else {
        parts = ['ids', ...segments];
    }

    if (modeSuffix) parts.push(sanitize(modeSuffix));
    return '--' + parts.join('-');
}

function rgbaToHex(r, g, b, a) {
    const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
    if (a < 1) {
        return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${parseFloat(a.toFixed(4))})`;
    }
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function extractAliasKey(id) {
    const m = id.match(/^VariableID:([0-9a-f]{40})\//i);
    return m ? m[1] : null;
}

// ─── Global registry: variableKey → cssVarName ───────────────────────────────

const globalRegistry = new Map();

function registerTokenFile(data, modeSuffixes) {
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

function resolveValue(modeValue) {
    if (modeValue === null || modeValue === undefined) return null;

    if (typeof modeValue === 'object' && modeValue.type === 'VARIABLE_ALIAS') {
        const targetKey = extractAliasKey(modeValue.id);
        if (targetKey) {
            const targetCssVar = globalRegistry.get(targetKey);
            if (targetCssVar) return `var(${targetCssVar})`;
        }
        return null;
    }

    if (typeof modeValue === 'object' && 'r' in modeValue) {
        return rgbaToHex(modeValue.r, modeValue.g, modeValue.b, modeValue.a);
    }

    if (typeof modeValue === 'number') return String(modeValue);
    if (typeof modeValue === 'string') return modeValue;

    return null;
}

// ─── Style Dictionary helpers (new component format) ─────────────────────────

/**
 * Returns true if the JSON data is in the new Style Dictionary format
 * (nested object with { value, type } leaf nodes) and NOT the old
 * Figma Variables format ({ variables: [...] }).
 */
function isStyleDictFormat(data) {
    return (
        typeof data === 'object' &&
        data !== null &&
        !('variables' in data) &&
        !('collections' in data)
    );
}

/**
 * Recursively flattens a Style Dictionary object into an array of
 * { path: string[], value: string } entries.
 */
function flattenStyleDict(node, currentPath = []) {
    if (typeof node !== 'object' || node === null) return [];

    // Leaf node: has a 'value' property
    if ('value' in node && (typeof node.value === 'string' || typeof node.value === 'number')) {
        return [{ path: currentPath, value: String(node.value) }];
    }

    const result = [];
    for (const [key, child] of Object.entries(node)) {
        if (key === 'type' || key === 'description' || key === '$type' || key === '$description') continue;
        result.push(...flattenStyleDict(child, [...currentPath, sanitize(key)]));
    }
    return result;
}

/**
 * Converts {smc.reference.container.gap.8} → var(--ids-smc-reference-container-gap-8)
 */
function resolveStyleDictRef(value) {
    const m = value.match(/^\{([^}]+)\}$/);
    if (m) {
        const cssVar = '--ids-' + m[1].split('.').map(sanitize).filter(Boolean).join('-');
        return `var(${cssVar})`;
    }
    return value;
}

// ─── CSS block generation ─────────────────────────────────────────────────────

function buildCssBlock(selector, entries, includeUnresolved = false) {
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

// ─── Find JSON files recursively ─────────────────────────────────────────────

function findJsonFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    const result = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            result.push(...findJsonFiles(p));
        } else if (entry.name.endsWith('.json')) {
            result.push(p);
        }
    }
    return result;
}

function isTokenFile(data) {
    return typeof data === 'object' && data !== null && 'variables' in data && Array.isArray(data.variables);
}

function isBundledFile(data) {
    return typeof data === 'object' && data !== null && 'collections' in data && Array.isArray(data.collections);
}

// ─── Pass 1: Build global registry (foundation files only) ───────────────────

function buildRegistry() {
    for (const fp of findJsonFiles(FOUNDATION_DIR)) {
        try {
            const raw = readJson(fp);
            if (!isTokenFile(raw)) continue;
            if (raw.collectionName === 'smc-layout') {
                registerTokenFile(raw, ['small', 'medium', 'large', 'xlarge']);
            } else {
                registerTokenFile(raw);
            }
        } catch { /* skip */ }
    }

    // Root bundled files (cross-reference)
    for (const f of fs.readdirSync(ROOT_DIR)) {
        const full = path.join(ROOT_DIR, f);
        try {
            if (!fs.statSync(full).isFile()) continue;
            if (f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.css')) continue;
            const raw = readJson(full);
            if (!isBundledFile(raw)) continue;
            for (const coll of raw.collections) {
                if (!isTokenFile(coll)) continue;
                if (coll.collectionName === 'smc-layout') {
                    registerTokenFile(coll, ['small', 'medium', 'large', 'xlarge']);
                } else if (coll.collectionName === 'comp-size') {
                    registerTokenFile(coll, ['comfortable', 'compact', 'dense', 'spacious']);
                } else {
                    registerTokenFile(coll);
                }
            }
        } catch { /* skip */ }
    }
}

// ─── base.css ─────────────────────────────────────────────────────────────────

function generateBaseCss() {
    const basePath = path.join(FOUNDATION_DIR, 'base', 'base.json');
    if (!fs.existsSync(basePath)) { console.warn('base.json not found'); return; }

    const data = readJson(basePath);
    const modeId = Object.keys(data.variables[0]?.valuesByMode ?? {})[0];

    const entries = [];
    for (const v of data.variables) {
        const val = resolveValue(v.valuesByMode[modeId]);
        entries.push({ cssVar: nameToCssVar(v.name), value: val ?? '', resolved: val !== null });
    }

    const outPath = path.join(OUTPUT_DIR, 'base', 'base.css');
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, buildCssBlock(':root', entries), 'utf-8');
    console.log(`✓ base/base.css (${entries.filter(e => e.resolved).length}/${entries.length} tokens resolved)`);
}

// ─── smc-colors.css ───────────────────────────────────────────────────────────

function generateSmcColorsCss() {
    const darkPath = path.join(FOUNDATION_DIR, 'smc-colors', 'dark.json');
    if (!fs.existsSync(darkPath)) { console.warn('smc-colors/dark.json not found'); return; }

    const data = readJson(darkPath);
    const allModeIds = Object.keys(data.variables[0]?.valuesByMode ?? {});
    if (allModeIds.length < 2) { console.warn('smc-colors: expected at least 2 modes'); return; }

    const [lightModeId, darkModeId] = allModeIds;
    const darkEntries = [];
    const lightEntries = [];

    for (const v of data.variables) {
        const cssVar = nameToCssVar(v.name);
        const dv = resolveValue(v.valuesByMode[darkModeId]);
        darkEntries.push({ cssVar, value: dv ?? '', resolved: dv !== null });
        const lv = resolveValue(v.valuesByMode[lightModeId]);
        lightEntries.push({ cssVar, value: lv ?? '', resolved: lv !== null });
    }

    const outPath = path.join(OUTPUT_DIR, 'smc', 'smc-colors.css');
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, [
        buildCssBlock('.ids-theme-dark', darkEntries),
        buildCssBlock('.ids-theme-light', lightEntries),
    ].join('\n'), 'utf-8');
    console.log(`✓ smc/smc-colors.css (dark: ${darkEntries.filter(e => e.resolved).length}/${darkEntries.length}, light: ${lightEntries.filter(e => e.resolved).length}/${lightEntries.length} resolved)`);
}

// ─── smc-layout.css ───────────────────────────────────────────────────────────

const LAYOUT_MODE_ORDER = ['small', 'medium', 'large', 'xlarge'];

function generateSmcLayoutCss() {
    const layoutDir = path.join(FOUNDATION_DIR, 'smc-layout');
    if (!fs.existsSync(layoutDir)) { console.warn('smc-layout directory not found'); return; }

    const layoutFiles = fs.readdirSync(layoutDir).filter(f => f.endsWith('.json')).sort();
    if (layoutFiles.length === 0) return;

    const data = readJson(path.join(layoutDir, layoutFiles[0]));
    const modeIds = Object.keys(data.variables[0]?.valuesByMode ?? {}).sort();
    const modeToName = {};
    for (let i = 0; i < modeIds.length && i < LAYOUT_MODE_ORDER.length; i++) {
        modeToName[modeIds[i]] = LAYOUT_MODE_ORDER[i];
    }

    const entries = [];
    for (const v of data.variables) {
        for (const [modeId, modeName] of Object.entries(modeToName)) {
            const val = resolveValue(v.valuesByMode[modeId]);
            entries.push({ cssVar: nameToCssVar(v.name, modeName), value: val ?? '', resolved: val !== null });
        }
    }

    const outPath = path.join(OUTPUT_DIR, 'smc', 'smc-layout.css');
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, buildCssBlock(':root', entries), 'utf-8');
    console.log(`✓ smc/smc-layout.css (${entries.filter(e => e.resolved).length}/${entries.length} tokens resolved)`);
}

// ─── smc-reference.css ────────────────────────────────────────────────────────

function generateSmcReferenceCss() {
    const refPath = path.join(FOUNDATION_DIR, 'smc-reference', 'smc-reference.json');
    if (!fs.existsSync(refPath)) { console.warn('smc-reference.json not found'); return; }

    const data = readJson(refPath);
    const modeId = Object.keys(data.variables[0]?.valuesByMode ?? {})[0];

    const entries = [];
    for (const v of data.variables) {
        const val = resolveValue(v.valuesByMode[modeId]);
        entries.push({ cssVar: nameToCssVar(v.name), value: val ?? '', resolved: val !== null });
    }

    const outPath = path.join(OUTPUT_DIR, 'smc', 'smc-reference.css');
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, buildCssBlock(':root', entries), 'utf-8');
    console.log(`✓ smc/smc-reference.css (${entries.filter(e => e.resolved).length}/${entries.length} tokens resolved)`);
}

// ─── component.css (new Style Dictionary format) ─────────────────────────────

function generateComponentCss() {
    const allEntries = [];
    const processedDirs = new Set();

    if (!fs.existsSync(COMPONENTS_DIR)) { console.warn('components directory not found'); return; }

    const compDirs = fs.readdirSync(COMPONENTS_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name !== 'foundation')
        .map(e => ({ name: e.name, fullPath: path.join(COMPONENTS_DIR, e.name) }));

    for (const { name: compName, fullPath: compDir } of compDirs) {
        const sanitizedCompName = sanitize(compName);

        // ── comp-color ──────────────────────────────────────────────────────
        const colorDir = path.join(compDir, 'comp-color');
        if (fs.existsSync(colorDir) && !processedDirs.has(colorDir)) {
            processedDirs.add(colorDir);
            for (const cf of fs.readdirSync(colorDir).filter(f => f.endsWith('.json'))) {
                let raw;
                try { raw = readJson(path.join(colorDir, cf)); } catch { continue; }
                if (!isStyleDictFormat(raw)) continue;

                for (const token of flattenStyleDict(raw)) {
                    allEntries.push({
                        cssVar: `--ids-comp-${sanitizedCompName}-${token.path.join('-')}`,
                        value: resolveStyleDictRef(token.value),
                        resolved: true,
                    });
                }
            }
        }

        // ── comp-size ───────────────────────────────────────────────────────
        const sizeDir = path.join(compDir, 'comp-size');
        if (fs.existsSync(sizeDir) && !processedDirs.has(sizeDir)) {
            processedDirs.add(sizeDir);
            for (const sf of fs.readdirSync(sizeDir).filter(f => f.endsWith('.json')).sort()) {
                let raw;
                try { raw = readJson(path.join(sizeDir, sf)); } catch { continue; }
                if (!isStyleDictFormat(raw)) continue; // skip Mode.json / old-format files

                const sizeName = sanitize(path.basename(sf, '.json'));
                for (const token of flattenStyleDict(raw)) {
                    allEntries.push({
                        cssVar: `--ids-comp-${sanitizedCompName}-${token.path.join('-')}-${sizeName}`,
                        value: resolveStyleDictRef(token.value),
                        resolved: true,
                    });
                }
            }
        }
    }

    // Deduplicate by cssVar (keep first occurrence)
    const seen = new Set();
    const deduped = allEntries.filter(e => {
        if (seen.has(e.cssVar)) return false;
        seen.add(e.cssVar);
        return true;
    });

    const outPath = path.join(OUTPUT_DIR, 'component', 'component.css');
    ensureDir(path.dirname(outPath));
    fs.writeFileSync(outPath, buildCssBlock(':root', deduped), 'utf-8');
    console.log(`✓ component/component.css (${deduped.length} tokens)`);
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
    console.log('Building global variable registry (foundation)…');
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

    console.log('\n✅ Done! Output in:', path.relative(ROOT_DIR, OUTPUT_DIR));
}

main();
