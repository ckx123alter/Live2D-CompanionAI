export const headActions = new Set(['Tilt', 'Nod', 'Shake']);

// Repeat with a quiet interval while manually selected; automatic replies
// use only the first gesture. The renderer eases into and out of these poses.
export function headActionPose(action, seconds) {
  const pose = { x: 0, y: 0, z: 0 };
  const time = Math.max(0, seconds);
  if (action === 'Tilt') return { x: 0, y: -2, z: 16 };
  if (action === 'Nod') {
    const phase = time % 3.4;
    if (phase < 1.6) pose.y = -15 * Math.sin(Math.PI * phase / .8) ** 2;
  }
  if (action === 'Shake') {
    const phase = time % 3.6;
    if (phase < 1.8) pose.x = 22 * Math.sin(2 * Math.PI * phase / .9) * Math.sin(Math.PI * phase / 1.8);
  }
  return pose;
}
