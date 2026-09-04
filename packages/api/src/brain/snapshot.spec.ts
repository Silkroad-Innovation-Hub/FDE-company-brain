import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { TodoLean } from '@librechat/data-schemas';
import {
  BRAIN_PLACEHOLDER,
  buildBrainSnapshot,
  hasBrainPlaceholder,
  injectBrainSnapshot,
} from './snapshot';

const todo = (text: string, done = false) => ({ text, done }) as unknown as TodoLean;

describe('brain snapshot', () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-vault-'));
    await fs.writeFile(
      path.join(vaultPath, 'Anduril.md'),
      '---\ntype: company\n---\n# Anduril\n\nA **$61B** company building **software-defined weapons**.\n',
    );
    await fs.writeFile(
      path.join(vaultPath, 'Henderson Invoice.md'),
      '---\ntype: invoice\namount: $12,400\ndue: 2026-09-10\n---\nOverdue invoice.\n',
    );
  });

  afterEach(async () => {
    await fs.rm(vaultPath, { recursive: true, force: true });
  });

  it('lists open to-dos in order and every note with its headline facts', async () => {
    const snapshot = await buildBrainSnapshot(vaultPath, [
      todo('Chase Henderson', true),
      todo('Review Q3 pricing with accountant'),
    ]);
    expect(snapshot).toContain(
      "Open to-dos (owner's dashboard, priority order):\n1. Review Q3 pricing",
    );
    expect(snapshot).not.toContain('Chase Henderson');
    expect(snapshot).toContain('Company brain (2 notes');
    expect(snapshot).toContain('- Anduril (company): ');
    expect(snapshot).toContain('$61B');
    expect(snapshot).toContain('- Henderson Invoice (invoice): amount: $12,400; due: 2026-09-10');
  });

  it('never claims there are no to-dos', async () => {
    const snapshot = await buildBrainSnapshot(vaultPath, []);
    expect(snapshot).toMatch(/never say there are none/);
  });

  it('fills the placeholder and leaves other prompts alone', () => {
    expect(hasBrainPlaceholder(`Hello ${BRAIN_PLACEHOLDER}`)).toBe(true);
    expect(hasBrainPlaceholder('Hello')).toBe(false);
    expect(hasBrainPlaceholder(undefined)).toBe(false);
    expect(injectBrainSnapshot(`A ${BRAIN_PLACEHOLDER} B`, 'X')).toBe('A X B');
  });
});
