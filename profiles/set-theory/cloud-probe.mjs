import { platform, arch, totalmem, freemem } from 'node:os';
import { appendFile, readFile } from 'node:fs/promises';
const [command = 'snapshot', path, durationArg] = process.argv.slice(2);
if (command === 'snapshot') {
  console.log(JSON.stringify({ platform: platform(), arch: arch(), node: process.version, totalMemory: totalmem(), freeMemory: freemem(), liveServicesChecked: false }));
} else if (command === 'record') {
  const duration = Number(durationArg);
  if (!path || !Number.isInteger(duration) || duration < 1 || duration > 86400) throw new Error('Specify path and duration seconds (1..86400)');
  const start = Date.now();
  do {
    await appendFile(path, JSON.stringify({ time: new Date().toISOString(), pid: process.pid }) + '\n', { mode: 0o600 });
    if (Date.now() - start >= duration * 1000) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(30000, duration * 1000 - (Date.now() - start))));
  } while (true);
} else if (command === 'inspect') {
  const rows = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const times = rows.map(row => Date.parse(row.time));
  const gaps = times.slice(1).map((time, i) => time - times[i]);
  console.log(JSON.stringify({ samples: rows.length, first: rows[0].time, last: rows.at(-1).time,
    maxGapMs: Math.max(0, ...gaps), processIds: [...new Set(rows.map(r => r.pid))], proves24x7: false }));
} else throw new Error('Use snapshot, record or inspect');
