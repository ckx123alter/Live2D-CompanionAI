export function createAccessoryState(keys) {
  const allowed = new Set(keys);
  const manual = new Set();
  const automatic = new Set();
  const enabled = new Set();
  const otherGlasses = key => key === 'glasses' ? 'monocle' : key === 'monocle' ? 'glasses' : null;
  function sync() {
    enabled.clear();
    for (const key of manual) enabled.add(key);
    for (const key of automatic) {
      if (!enabled.has(otherGlasses(key))) enabled.add(key);
    }
  }
  return {
    enabled,
    applyReply(props) {
      automatic.clear();
      if (Array.isArray(props)) for (const key of props) {
        if (allowed.has(key) && !automatic.has(otherGlasses(key))) automatic.add(key);
      }
      sync();
    },
    toggle(key) {
      if (!allowed.has(key)) return;
      if (enabled.has(key)) {
        manual.delete(key);
        automatic.delete(key);
      } else {
        manual.delete(otherGlasses(key));
        automatic.delete(otherGlasses(key));
        manual.add(key);
      }
      sync();
    },
    clear() {
      manual.clear();
      automatic.clear();
      sync();
    },
  };
}
