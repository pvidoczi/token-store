import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectCustomPropertyDefinitions,
  collectCustomPropertyReferences,
  compareTokenSets,
} from './validate-ids-styles-tokens.mjs';

function withCssFixture(files, callback) {
  const fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'token-css-fixture-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(fixtureDirectory, relativePath);
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf8');
    }
    callback(fixtureDirectory);
  } finally {
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
}

test('collects unique custom property definitions from nested generated CSS', () => {
  withCssFixture(
    {
      'base/base.css': `
        :root {
          --ids-alpha: red;
          --ids-beta: var(--ids-foundation, blue);
        }
        /* --ids-commented-out: black; */
      `,
      'component/component.css': `
        .ids-theme { --ids-alpha: green; --ids-gamma_2: 2px }
      `,
      'tokens.css': '@import "./base/base.css";',
    },
    (fixtureDirectory) => {
      assert.deepEqual(
        [...collectCustomPropertyDefinitions(fixtureDirectory)].sort(),
        ['--ids-alpha', '--ids-beta', '--ids-gamma_2'],
      );
    },
  );
});

test('collects every var reference, including multiple calls and fallbacks', () => {
  withCssFixture(
    {
      'dist/component.css': `
        .example {
          color: var(--ids-alpha, var(--ids-fallback));
          box-shadow: var(--ids-beta) 0 0 var( --ids-gamma, 2px);
        }
        /* color: var(--ids-commented-out); */
      `,
      'dist/component.min.css':
        '.example{color:var(--ids-alpha);border-color:var(--ids-beta)}',
    },
    (fixtureDirectory) => {
      assert.deepEqual(
        [...collectCustomPropertyReferences(fixtureDirectory)].sort(),
        ['--ids-alpha', '--ids-beta', '--ids-fallback', '--ids-gamma'],
      );
    },
  );
});

test('compares Sets and returns alphabetically sorted differences', () => {
  const differences = compareTokenSets(
    new Set(['--ids-zulu', '--ids-shared', '--ids-alpha']),
    new Set(['--ids-missing-zulu', '--ids-shared', '--ids-missing-alpha']),
  );

  assert.deepEqual(differences, {
    missingFromGenerated: ['--ids-missing-alpha', '--ids-missing-zulu'],
    notDirectlyReferencedByStyles: ['--ids-alpha', '--ids-zulu'],
  });
});
