// File => src/utils/metrics.js 
/**
 * اسکلت متریک‌ها (ساده)
 */
const counters = new Map();

function inc(name, value = 1) {
  const prev = counters.get(name) || 0;
  counters.set(name, prev + value);
}

function get(name) { return counters.get(name) || 0; }

function snapshot() {
  const obj = {};
  for (const [k, v] of counters.entries()) obj[k] = v;
  return obj;
}

export { inc, get, snapshot };
