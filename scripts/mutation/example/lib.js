// A tiny module for the example mutation config (example.config.cjs). The check next to it pins every behaviour, so each mutant of this file is killed.
function clamp(value, low, high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

const LIMIT = 7;

function isOverLimit(count) {
  return count > LIMIT;
}

module.exports = { clamp, isOverLimit, LIMIT };
