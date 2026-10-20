// usage: node scripts/bench/ab-stats.cjs <out-dir>   (the directory ab-procs.sh wrote abp-A-*.json / abp-B-*.json into)
// Per workload: the median of each side's per-process best time, their ratio B/A (B = the working tree, A = the baseline), and a bootstrap 90% interval
// of that ratio. A ratio above 1 is B slower. See ab-procs.sh for why the comparison is across processes.
const fs = require('fs');
const dir = process.argv[2];
const load = (side) => fs.readdirSync(dir).filter((f) => f.startsWith(`abp-${side}-`) && f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')).results);
const A = load('A');
const B = load('B');
const med = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
console.log(`processes per side: A=${A.length} B=${B.length}`);
console.log('workload'.padEnd(52), 'A med-min', 'B med-min', 'ratio', ' 90% interval        | ratio of best');
let worstLo = 1e9;
let worstHi = 0;
for (const k of Object.keys(A[0])) {
  const a = A.map((r) => r[k].min);
  const b = B.map((r) => r[k].min);
  const boots = [];
  for (let i = 0; i < 2000; i++) boots.push(med(b.map(() => b[Math.floor(rnd() * b.length)])) / med(a.map(() => a[Math.floor(rnd() * a.length)])));
  boots.sort((x, y) => x - y);
  const lo = boots[Math.floor(boots.length * 0.05)];
  const hi = boots[Math.floor(boots.length * 0.95)];
  worstLo = Math.min(worstLo, lo);
  worstHi = Math.max(worstHi, hi);
  console.log(k.padEnd(52), med(a).toFixed(2).padStart(9), med(b).toFixed(2).padStart(9), (med(b) / med(a)).toFixed(3).padStart(6), ` ${lo.toFixed(3)}..${hi.toFixed(3)}`.padEnd(20), ' |', (Math.min(...b) / Math.min(...a)).toFixed(3));
}
console.log(`widest 90% interval over all workloads: ${worstLo.toFixed(3)}..${worstHi.toFixed(3)}`);
