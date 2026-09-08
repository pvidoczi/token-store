#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const IDS_STYLES_REPOSITORY =
  'https://github.com/i-Cell-Mobilsoft-Open-Source/ids-styles.git';
const COMPONENT_TOKEN_PREFIX = '--ids-comp-';
const USE_COLOR =
  !Object.hasOwn(process.env, 'NO_COLOR') &&
  (process.stdout.isTTY || (process.env.CI !== undefined && process.env.CI !== 'false'));
const ANSI = {
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
};

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

export function findCssFiles(rootDirectory) {
  if (!existsSync(rootDirectory)) return [];

  const cssFiles = [];
  const entries = readdirSync(rootDirectory, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name),
  );

  for (const entry of entries) {
    const entryPath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      cssFiles.push(...findCssFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      cssFiles.push(entryPath);
    }
  }

  return cssFiles;
}

export function collectCustomPropertyDefinitions(cssRootDirectory) {
  const definitions = new Set();

  for (const cssFile of findCssFiles(cssRootDirectory)) {
    const css = stripCssComments(readFileSync(cssFile, 'utf8'));
    for (const match of css.matchAll(/(?:^|[;{])\s*(--[-_a-zA-Z0-9]+)\s*:/gm)) {
      definitions.add(match[1]);
    }
  }

  return definitions;
}

export function collectCustomPropertyReferences(cssRootDirectory) {
  const references = new Set();

  for (const cssFile of findCssFiles(cssRootDirectory)) {
    const css = stripCssComments(readFileSync(cssFile, 'utf8'));
    for (const match of css.matchAll(/var\(\s*(--[-_a-zA-Z0-9]+)/g)) {
      references.add(match[1]);
    }
  }

  return references;
}

export function filterComponentTokens(tokens) {
  return new Set([...tokens].filter((token) => token.startsWith(COMPONENT_TOKEN_PREFIX)));
}

export function compareTokenSets(generatedDefinitions, idsStylesReferences) {
  return {
    missingFromGenerated: [...idsStylesReferences]
      .filter((token) => !generatedDefinitions.has(token))
      .sort(),
    notDirectlyReferencedByStyles: [...generatedDefinitions]
      .filter((token) => !idsStylesReferences.has(token))
      .sort(),
  };
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`);
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function checkoutIdsStyles(checkoutDirectory, idsStylesRef) {
  try {
    runCommand('git', ['init', '--quiet', checkoutDirectory], process.cwd());
    runCommand(
      'git',
      ['remote', 'add', 'origin', IDS_STYLES_REPOSITORY],
      checkoutDirectory,
    );
    runCommand(
      'git',
      ['fetch', '--quiet', '--depth=1', 'origin', idsStylesRef],
      checkoutDirectory,
    );
    runCommand(
      'git',
      ['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', 'FETCH_HEAD'],
      checkoutDirectory,
    );
  } catch (error) {
    throw new Error(
      `Unable to check out ids-styles ref "${idsStylesRef}": ${errorMessage(error)}`,
    );
  }
}

function installIdsStylesDependencies(checkoutDirectory) {
  try {
    if (existsSync(path.join(checkoutDirectory, 'pnpm-lock.yaml'))) {
      runCommand('corepack', ['pnpm', 'install', '--frozen-lockfile'], checkoutDirectory);
    } else if (existsSync(path.join(checkoutDirectory, 'package-lock.json'))) {
      runCommand('npm', ['ci', '--no-audit', '--no-fund'], checkoutDirectory);
    } else {
      runCommand('npm', ['install', '--no-audit', '--no-fund'], checkoutDirectory);
    }
  } catch (error) {
    throw new Error(`Failed to install ids-styles dependencies: ${errorMessage(error)}`);
  }
}

function buildIdsStyles(checkoutDirectory, idsStylesRef) {
  try {
    if (existsSync(path.join(checkoutDirectory, 'pnpm-lock.yaml'))) {
      runCommand('corepack', ['pnpm', 'run', 'build'], checkoutDirectory);
    } else {
      runCommand('npm', ['run', 'build'], checkoutDirectory);
    }
  } catch (error) {
    throw new Error(
      `ids-styles build failed for ref "${idsStylesRef}": ${errorMessage(error)}`,
    );
  }
}

function writeReport(reportPath, report) {
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function colorize(text, color, bold = false) {
  if (!USE_COLOR) return text;
  return `${bold ? ANSI.bold : ''}${color}${text}${ANSI.reset}`;
}

function printDifferenceList(title, values, emptyMessage, color) {
  console.log(colorize(`${title}: ${values.length}`, color, true));
  if (values.length === 0) {
    console.log(colorize(emptyMessage, ANSI.green));
  } else {
    console.log(values.map((value) => colorize(value, color)).join('\n'));
  }
  console.log('');
}

function printReport(report) {
  console.log('');
  console.log(`IDS Styles ref: ${report.idsStylesRef}`);
  console.log(`Token scope: ${report.tokenPrefix}*`);
  console.log('');
  console.log(`Generated token definitions: ${report.generatedTokenCount}`);
  console.log(`Token references used by ids-styles: ${report.referencedTokenCount}`);
  console.log('');

  printDifferenceList(
    'Referenced by ids-styles but missing from generated CSS',
    report.missingFromGenerated,
    'No differences found: every token referenced by ids-styles is defined in generated CSS.',
    ANSI.red,
  );

  console.log(
    colorize(
      'Informational only: these generated component tokens are not directly referenced by the selected ids-styles ref. This does not by itself prove that they are unused.',
      ANSI.cyan,
    ),
  );
  printDifferenceList(
    'Defined in generated CSS but not directly referenced by ids-styles',
    report.notDirectlyReferencedByStyles,
    'No differences found: every generated token definition is directly referenced by ids-styles.',
    ANSI.cyan,
  );
}

function emptyReport(idsStylesRef) {
  return {
    idsStylesRef,
    tokenPrefix: COMPONENT_TOKEN_PREFIX,
    generatedTokenCount: 0,
    referencedTokenCount: 0,
    missingFromGenerated: [],
    notDirectlyReferencedByStyles: [],
  };
}

export function main() {
  const repositoryRoot = process.cwd();
  const idsStylesRef = (process.env.IDS_STYLES_REF ?? '').trim();
  const generatedCssDirectory = path.resolve(
    repositoryRoot,
    process.env.CSS_OUTPUT_DIR ?? 'ids_css',
  );
  const reportPath = path.resolve(
    repositoryRoot,
    process.env.TOKEN_DIFF_REPORT_PATH ?? 'token-diff-report.json',
  );
  const report = emptyReport(idsStylesRef);
  let checkoutDirectory;

  try {
    if (!idsStylesRef) {
      throw new Error(
        'IDS_STYLES_REF must be set to an ids-styles branch, tag, or commit SHA.',
      );
    }
    if (idsStylesRef.startsWith('-') || /\s/.test(idsStylesRef)) {
      throw new Error(`IDS_STYLES_REF is not a valid Git ref: "${idsStylesRef}".`);
    }

    const generatedCssFiles = findCssFiles(generatedCssDirectory);
    if (generatedCssFiles.length === 0) {
      throw new Error(`No generated CSS files found under ${generatedCssDirectory}.`);
    }

    const generatedDefinitions = filterComponentTokens(
      collectCustomPropertyDefinitions(generatedCssDirectory),
    );
    report.generatedTokenCount = generatedDefinitions.size;
    if (generatedDefinitions.size === 0) {
      throw new Error(
        `No component custom property definitions found in generated CSS under ${generatedCssDirectory}.`,
      );
    }

    checkoutDirectory = mkdtempSync(path.join(tmpdir(), 'ids-styles-token-validation-'));
    checkoutIdsStyles(checkoutDirectory, idsStylesRef);
    installIdsStylesDependencies(checkoutDirectory);
    buildIdsStyles(checkoutDirectory, idsStylesRef);

    const compiledCssDirectory = path.join(checkoutDirectory, 'dist');
    const compiledCssFiles = findCssFiles(compiledCssDirectory);
    if (compiledCssFiles.length === 0) {
      throw new Error(
        `ids-styles build produced no compiled CSS files under ${compiledCssDirectory}.`,
      );
    }

    const idsStylesReferences = filterComponentTokens(
      collectCustomPropertyReferences(compiledCssDirectory),
    );
    report.referencedTokenCount = idsStylesReferences.size;

    const differences = compareTokenSets(generatedDefinitions, idsStylesReferences);
    report.missingFromGenerated = differences.missingFromGenerated;
    report.notDirectlyReferencedByStyles = differences.notDirectlyReferencedByStyles;

    printReport(report);
    writeReport(reportPath, report);
    console.log(`Machine-readable report: ${path.relative(repositoryRoot, reportPath)}`);

    if (report.missingFromGenerated.length > 0) {
      console.error(
        `Validation failed: ${report.missingFromGenerated.length} ids-styles token reference(s) are missing from generated CSS.`,
      );
      return 1;
    }

    console.log('Validation passed: all ids-styles token references have generated definitions.');
    return 0;
  } catch (error) {
    const message = errorMessage(error);
    report.error = message;

    try {
      writeReport(reportPath, report);
      console.error(`Machine-readable error report: ${path.relative(repositoryRoot, reportPath)}`);
    } catch (reportError) {
      console.error(`Could not write the machine-readable report: ${errorMessage(reportError)}`);
    }

    console.error(`Validation error: ${message}`);
    return 1;
  } finally {
    if (checkoutDirectory) {
      rmSync(checkoutDirectory, { recursive: true, force: true });
    }
  }
}

const isMainModule =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMainModule) {
  process.exitCode = main();
}
