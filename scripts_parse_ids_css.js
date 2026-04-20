const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = process.cwd();
const SAMPLE_CSS_DIR = path.join(ROOT_DIR, 'sample_css');
const FOUNDATION_DIR = path.join(ROOT_DIR, 'foundation');
const OUTPUT_DIR = path.join(ROOT_DIR, 'ids_css');
const OUTPUT_BASE_FILE = path.join(OUTPUT_DIR, 'base', 'base.css');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function mirrorStructure(sourceDir, targetDir) {
    if (!fs.existsSync(sourceDir)) {
        return;
    }

    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

    ensureDir(targetDir);

    for (const entry of entries) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);

        if (entry.isDirectory()) {
            mirrorStructure(sourcePath, targetPath);
        }
    }
}

function sanitizeTokenKey(tokenKey) {
    return String(tokenKey).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function toCssVarFromReference(referencePath) {
    const normalized = referencePath
        .split('.')
        .map(sanitizeTokenKey)
        .filter(Boolean)
        .join('-');

    return `var(--ids-${normalized})`;
}

function normalizeTokenValue(value) {
    if (typeof value !== 'string') {
        return String(value);
    }

    const referenceMatch = value.match(/^\{([^}]+)\}$/);

    if (referenceMatch) {
        return toCssVarFromReference(referenceMatch[1]);
    }

    return value;
}

function flattenTokenObject(node, segments = [], output = []) {
    if (node === null || node === undefined) {
        return output;
    }

    if (typeof node !== 'object') {
        output.push({
            tokenPath: segments,
            value: normalizeTokenValue(node)
        });
        return output;
    }

    if (!Array.isArray(node) && Object.hasOwn(node, 'value')) {
        output.push({
            tokenPath: segments,
            value: normalizeTokenValue(node.value)
        });
        return output;
    }

    for (const [key, value] of Object.entries(node)) {
        flattenTokenObject(value, [...segments, sanitizeTokenKey(key)], output);
    }

    return output;
}

function findBaseJsonPath() {
    const directBase = path.join(FOUNDATION_DIR, 'base.json');

    if (fs.existsSync(directBase)) {
        return directBase;
    }

    if (!fs.existsSync(FOUNDATION_DIR)) {
        return null;
    }

    const candidates = fs
        .readdirSync(FOUNDATION_DIR)
        .filter((fileName) => fileName.endsWith('.json') && fileName.toLowerCase().includes('base'))
        .sort();

    if (candidates.length === 0) {
        return null;
    }

    return path.join(FOUNDATION_DIR, candidates[0]);
}

function generateBaseCss() {
    const baseJsonPath = findBaseJsonPath();

    if (!baseJsonPath) {
        throw new Error('Nem található base JSON a foundation mappában (várt fájl: foundation/base.json).');
    }

    const parsed = JSON.parse(fs.readFileSync(baseJsonPath, 'utf-8'));
    const flattened = flattenTokenObject(parsed)
        .filter((entry) => entry.tokenPath.length > 0)
        .map((entry) => ({
            cssVariable: `--ids-base-${entry.tokenPath.join('-')}`,
            value: entry.value
        }))
        .sort((a, b) => a.cssVariable.localeCompare(b.cssVariable));

    const lines = [':root {'];

    for (const token of flattened) {
        lines.push(`  ${token.cssVariable}: ${token.value};`);
    }

    lines.push('}', '');

    ensureDir(path.dirname(OUTPUT_BASE_FILE));
    fs.writeFileSync(OUTPUT_BASE_FILE, lines.join('\n'), 'utf-8');

    return { baseJsonPath, tokenCount: flattened.length };
}

function main() {
    mirrorStructure(SAMPLE_CSS_DIR, OUTPUT_DIR);
    const result = generateBaseCss();

    console.log(`Base CSS elkészült: ${path.relative(ROOT_DIR, OUTPUT_BASE_FILE)}`);
    console.log(`Forrás: ${path.relative(ROOT_DIR, result.baseJsonPath)} | tokenek: ${result.tokenCount}`);
}

main();
