import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { walkDirs } from '../src/walkDirs.js';
import { walkDirsRecursive } from '../src/walkDirsRecursive.js';

async function createRandomTree(baseDir, opts) {
  const { layers = 8, maxDirsPerLayer = 80, maxFilesPerDir = 5 } = opts;
  let currentDirs = [baseDir];
  for (let depth = 0; depth < layers; depth++) {
    const nextDirs = [];
    for (const dir of currentDirs) {
      const dirsHere = Math.floor(Math.random() * maxDirsPerLayer);
      const filesHere = Math.floor(Math.random() * maxFilesPerDir);
      for (let i = 0; i < filesHere; i++) {
        const f = path.join(dir, `file_${depth}_${i}.txt`);
        await writeFile(f, `depth=${depth},i=${i}`);
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

async function run() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'walk-bench-'));
  try {
    await createRandomTree(tmp, { layers: 10, maxDirsPerLayer: 100, maxFilesPerDir: 3 });

    let files1 = 0;
    const t1s = performance.now();
    await walkDirs(tmp, { onFile: async () => { files1++; }, concurrency: 16 });
    const t1e = performance.now();

    let files2 = 0;
    const t2s = performance.now();
    await walkDirsRecursive(tmp, { onFile: async () => { files2++; } });
    const t2e = performance.now();

    const report = {
      root: tmp,
      nonRecursive: { ms: t1e - t1s, files: files1 },
      recursive: { ms: t2e - t2s, files: files2 }
    };

    const outDir = path.resolve('reports');
    await mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, `bench-${Date.now()}.json`);
    await writeFile(outFile, JSON.stringify(report, null, 2));
    console.log(`Wrote report to ${outFile}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});


