import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { walkDirs } from '../src/walkDirs.js';
import { walkDirsRecursive } from '../src/walkDirsRecursive.js';
import { performance } from 'node:perf_hooks';

async function createRandomTree(baseDir, opts) {
  const { maxLayers = 10, maxDirsPerLayer = 100, maxFilesPerDir = 5, seed } = opts;
  const rng = crypto.createHash('sha256').update(String(seed ?? Date.now())).digest();
  let idx = 0;
  const rand = () => {
    const v = rng[idx % rng.length];
    idx++;
    return v / 255;
  };

  const layers = Math.max(1, Math.floor(rand() * maxLayers));
  let currentDirs = [baseDir];
  for (let depth = 0; depth < layers; depth++) {
    const nextDirs = [];
    for (const dir of currentDirs) {
      const dirsHere = Math.floor(rand() * maxDirsPerLayer);
      const filesHere = Math.floor(rand() * maxFilesPerDir);

      for (let i = 0; i < filesHere; i++) {
        const f = path.join(dir, `file_${depth}_${i}.txt`);
        await writeFile(f, `depth=${depth},i=${i},rand=${rand()}`);
      }

      for (let j = 0; j < dirsHere; j++) {
        const d = path.join(dir, `dir_${depth}_${j}`);
        await mkdir(d, { recursive: true });
        nextDirs.push(d);
      }
    }
    currentDirs = nextDirs;
  }
}

async function countWithFs(base) {
  let files = 0;
  let dirs = 0;
  async function visit(d) {
    const ents = await readdir(d, { withFileTypes: true });
    for (const ent of ents) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) { dirs++; await visit(full); }
      else if (ent.isFile()) { files++; }
      else if (ent.isSymbolicLink()) {
        try { const s = await stat(full); if (s.isDirectory()) { dirs++; await visit(full); } else if (s.isFile()) { files++; } } catch {}
      }
    }
  }
  await visit(base);
  return { files, dirs };
}

describe('random tree traversal parity', () => {
  let tmp;
  beforeAll(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'walk-nr-'));
    await createRandomTree(tmp, { maxLayers: 10, maxDirsPerLayer: 100, maxFilesPerDir: 3 });
  }, 120000);

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('non-recursive matches recursive on count', async () => {
    let nrFiles = 0;
    const t1s = performance.now();
    await walkDirs(tmp, { onFile: async () => { nrFiles++; }, concurrency: 16 });
    const t1e = performance.now();

    let rFiles = 0;
    const t2s = performance.now();
    await walkDirsRecursive(tmp, { onFile: async () => { rFiles++; } });
    const t2e = performance.now();

    const baseline = await countWithFs(tmp);

    expect(nrFiles).toBe(baseline.files);
    expect(rFiles).toBe(baseline.files);

    // write a simple test report
    const outDir = path.resolve('reports');
    await mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, `test-report-${Date.now()}.json`);
    const report = {
      root: tmp,
      baseline,
      nonRecursive: { files: nrFiles, ms: t1e - t1s },
      recursive: { files: rFiles, ms: t2e - t2s }
    };
    await writeFile(outFile, JSON.stringify(report, null, 2));
  }, 120000);
});


