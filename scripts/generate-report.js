import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { walkDirs } from '../src/walkDirs.js';
import { walkDirsRecursive } from '../src/walkDirsRecursive.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { runs: 5, allowHuge: false, outDir: 'reports', scenarios: [10, 100, 1000, 10000, 100000, 1000000] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--runs' && args[i + 1]) { out.runs = Number(args[++i]); }
    else if (a === '--out' && args[i + 1]) { out.outDir = args[++i]; }
    else if (a === '--allow-huge') { out.allowHuge = true; }
  }
  return out;
}

async function createTreeToTargetDirs(baseDir, targetDirs, options = {}) {
  const maxDepth = options.maxDepth ?? 10;
  const maxFilesPerDir = options.maxFilesPerDir ?? 2;
  let createdDirs = 0; // count of subdirectories created (excluding base)
  let currentLevelDirs = [baseDir];
  let depth = 0;

  while (createdDirs < targetDirs && depth < maxDepth && currentLevelDirs.length) {
    const nextLevel = [];
    for (const dir of currentLevelDirs) {
      if (createdDirs >= targetDirs) break;
      // Aim to evenly distribute remaining directories over current level
      const remaining = targetDirs - createdDirs;
      const perDirTarget = Math.max(1, Math.ceil(remaining / currentLevelDirs.length));
      const maxPerDir = Math.min(perDirTarget, 1000); // safety cap per directory
      const toCreate = Math.min(maxPerDir, remaining);

      for (let i = 0; i < toCreate; i++) {
        const sub = path.join(dir, `d_${depth}_${i}`);
        await mkdir(sub, { recursive: true });
        createdDirs++;
        nextLevel.push(sub);
        if (createdDirs >= targetDirs) break;
      }

      // Create a few tiny files to make traversal non-trivial
      for (let f = 0; f < maxFilesPerDir; f++) {
        const fp = path.join(dir, `f_${depth}_${f}.txt`);
        await writeFile(fp, `${depth}:${f}`);
      }
    }
    currentLevelDirs = nextLevel;
    depth++;
  }
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((s, v) => s + v, 0) / (samples.length || 1);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const p95 = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
  return { mean, median, p95 };
}

async function runScenario(targetDirs, runs, allowHuge) {
  const results = [];
  if (!allowHuge && targetDirs > 200000) {
    return { skipped: true, reason: 'target too large for default run (use --allow-huge)', runs: [] };
  }

  for (let i = 0; i < runs; i++) {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'walk-report-'));
    try {
      await createTreeToTargetDirs(tmp, targetDirs, { maxDepth: 10, maxFilesPerDir: 2 });

      let filesNR = 0;
      const t1s = performance.now();
      await walkDirs(tmp, { onFile: async () => { filesNR++; }, concurrency: 16 });
      const t1e = performance.now();

      let filesR = 0;
      const t2s = performance.now();
      await walkDirsRecursive(tmp, { onFile: async () => { filesR++; } });
      const t2e = performance.now();

      results.push({
        iteration: i,
        nonRecursive: { ms: t1e - t1s, files: filesNR },
        recursive: { ms: t2e - t2s, files: filesR }
      });
      process.stdout.write(`scenario=${targetDirs} iter=${i + 1}/${runs} done\n`);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
  return { skipped: false, runs: results };
}

function buildHtml(report) {
  const json = JSON.stringify(report);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dir Traversal Report</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 20px; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 24px; }
      @media (min-width: 900px) { .grid { grid-template-columns: 1fr 1fr; } }
      canvas { width: 100%; height: 360px; }
      table { border-collapse: collapse; width: 100%; }
      th, td { padding: 8px 10px; border-bottom: 1px solid #ddd; text-align: right; }
      th:first-child, td:first-child { text-align: left; }
      code { background: #f5f5f5; padding: 2px 4px; border-radius: 4px; }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  </head>
  <body>
    <h2>Directory Traversal Report</h2>
    <p>Generated at <code>${report.generatedAt}</code>, runs per scenario: <code>${report.runsPerScenario}</code></p>
    <div class="grid">
      <div>
        <h3>Mean duration (ms) by scenario</h3>
        <canvas id="meanChart"></canvas>
      </div>
      <div>
        <h3>Median duration (ms) by scenario</h3>
        <canvas id="medianChart"></canvas>
      </div>
    </div>
    <h3>Summary</h3>
    <table id="summaryTable">
      <thead>
        <tr><th>Target Dirs</th><th>NR mean</th><th>NR median</th><th>NR p95</th><th>R mean</th><th>R median</th><th>R p95</th></tr>
      </thead>
      <tbody></tbody>
    </table>
    <script>
      const REPORT = ${json};
      const scenarios = REPORT.scenarios.filter(s => !s.skipped);
      const labels = scenarios.map(s => s.targetDirs.toLocaleString());
      const nrMean = scenarios.map(s => s.summary.nonRecursive.mean);
      const rMean = scenarios.map(s => s.summary.recursive.mean);
      const nrMed = scenarios.map(s => s.summary.nonRecursive.median);
      const rMed = scenarios.map(s => s.summary.recursive.median);

      const ctx1 = document.getElementById('meanChart');
      new Chart(ctx1, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Non-Recursive (mean)', backgroundColor: '#4CAF50', data: nrMean },
            { label: 'Recursive (mean)', backgroundColor: '#2196F3', data: rMean }
          ]
        },
        options: { responsive: true, scales: { y: { beginAtZero: true } } }
      });

      const ctx2 = document.getElementById('medianChart');
      new Chart(ctx2, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Non-Recursive (median)', borderColor: '#4CAF50', data: nrMed },
            { label: 'Recursive (median)', borderColor: '#2196F3', data: rMed }
          ]
        },
        options: { responsive: true, scales: { y: { beginAtZero: true } } }
      });

      const tbody = document.querySelector('#summaryTable tbody');
      for (const s of scenarios) {
        const tr = document.createElement('tr');
        const c = s.summary;
        tr.innerHTML = '<td>' + s.targetDirs.toLocaleString() + '</td>' +
          '<td>' + c.nonRecursive.mean.toFixed(2) + '</td>' +
          '<td>' + c.nonRecursive.median.toFixed(2) + '</td>' +
          '<td>' + c.nonRecursive.p95.toFixed(2) + '</td>' +
          '<td>' + c.recursive.mean.toFixed(2) + '</td>' +
          '<td>' + c.recursive.median.toFixed(2) + '</td>' +
          '<td>' + c.recursive.p95.toFixed(2) + '</td>';
        tbody.appendChild(tr);
      }
    </script>
  </body>
</html>`;
}

async function main() {
  const { runs, allowHuge, outDir, scenarios } = parseArgs();
  const results = [];
  for (const target of scenarios) {
    console.log(`Running scenario targetDirs=${target} over ${runs} runs...`);
    const res = await runScenario(target, runs, allowHuge);
    results.push({ targetDirs: target, ...res });
  }

  // Build summaries
  for (const s of results) {
    if (s.skipped) { s.summary = null; continue; }
    const nr = s.runs.map(r => r.nonRecursive.ms);
    const rr = s.runs.map(r => r.recursive.ms);
    s.summary = {
      nonRecursive: summarize(nr),
      recursive: summarize(rr)
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    runsPerScenario: runs,
    scenarios: results
  };

  const outAbs = path.resolve(outDir);
  await mkdir(outAbs, { recursive: true });
  const base = `report-${Date.now()}`;
  const jsonPath = path.join(outAbs, `${base}.json`);
  const htmlPath = path.join(outAbs, `${base}.html`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2));
  await writeFile(htmlPath, buildHtml(report));
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${htmlPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });


