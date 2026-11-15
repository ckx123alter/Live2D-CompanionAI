// Retarget from the currently displayed pose, including during rapid clicks.
export function createAppearanceTransition(duration = 320) {
  let from = {}, target = {}, started = -Infinity;
  const sample = now => {
    const progress = Math.max(0, Math.min(1, (now - started) / duration));
    const weight = progress * progress * (3 - 2 * progress);
    return Object.fromEntries([...new Set([...Object.keys(from), ...Object.keys(target)])].map(key =>
      [key, (from[key] ?? 0) + ((target[key] ?? 0) - (from[key] ?? 0)) * weight]));
  };
  return {
    sample,
    set(next, now) {
      const keys = new Set([...Object.keys(target), ...Object.keys(next)]);
      if ([...keys].every(key => (target[key] ?? 0) === (next[key] ?? 0))) return false;
      from = sample(now);
      target = { ...next };
      started = now;
      return true;
    },
  };
}
