const IDLE_DELAY = 5_000;
const LOOK_DURATION = 12_000;
const BODY_BOB_STRENGTH = 2.5;
// Turn, pause to look, then look the other way. Finish at rest before repeating.
const frames = [
  [0, 0, 0, 0, 0, 0],
  [1.1, -32, 5, 5, -.75, .15],
  [2.6, -32, 5, 5, -.75, .15],
  [4.2, 32, 8, -5, .75, .25],
  [5.8, 32, 8, -5, .75, .25],
  [7.1, -22, -5, 3, -.5, -.15],
  [8.1, -22, -5, 3, -.5, -.15],
  [9.4, 0, 0, 0, 0, 0],
  [12, 0, 0, 0, 0, 0],
];
// Weight shifts lag behind the gaze. Position inputs also drive the rig's
// shoulders, hips, arms, skirt and ribbons through its existing physics.
const bodyFrames = [
  [0, 0, 0, 0],
  [.45, -.025, -2, .015],
  [1.6, -.30, 5, .14],
  [2.9, -.25, 3, .10],
  [3.5, -.08, -2, .025],
  [4.8, .32, 7, -.16],
  [6.1, .27, 4, -.11],
  [7.7, -.20, -3, .10],
  [8.5, -.16, -1, .07],
  [10, 0, 0, 0],
  [12, 0, 0, 0],
];

function interpolate(track, phase, keys) {
  const end = track.findIndex(frame => frame[0] > phase);
  const from = track[end - 1], to = track[end];
  const progress = (phase - from[0]) / (to[0] - from[0]);
  const blend = progress * progress * (3 - 2 * progress);
  return Object.fromEntries(keys.map((key, index) =>
    [key, from[index + 1] + (to[index + 1] - from[index + 1]) * blend]));
}

export function createIdleLook(now = performance.now()) {
  let lastActivity = now;
  return {
    reset(time = performance.now()) { lastActivity = time; },
    sample(time, blocked = false) {
      // Dialogue, selected actions and hidden pages get a fresh idle countdown.
      if (blocked) { lastActivity = time; return null; }
      if (time - lastActivity < IDLE_DELAY) return null;
      const elapsed = time - lastActivity - IDLE_DELAY;
      // After three uninterrupted looks, lean in and wait for the user instead
      // of beginning another cycle. This pose is idle-owned, not a held action.
      if(elapsed >= LOOK_DURATION * 3 + IDLE_DELAY * 2) {
        return {round:3,surprise:true,lean:true,holding:true,
          x:0,y:0,z:0,eyeX:0,eyeY:0,bodyX:0,bodyY:0,bodyZ:0};
      }
      const cycleDuration = LOOK_DURATION + IDLE_DELAY;
      const cycle = Math.floor(elapsed / cycleDuration);
      const cycleTime = elapsed % cycleDuration;
      // Each complete gesture is followed by a full idle interval at rest.
      if (cycleTime >= LOOK_DURATION) return null;
      const phase = cycleTime / 1000;
      const direction = cycle % 2 ? -1 : 1;
      const strength = cycle % 3 === 1 ? .90 : 1;
      const pose = {
        round: cycle + 1,
        surprise: cycle === 2,
        lean: false,
        ...interpolate(frames, phase, ['x', 'y', 'z', 'eyeX', 'eyeY']),
        ...interpolate(bodyFrames, phase, ['bodyX', 'bodyY', 'bodyZ']),
      };
      // Amplify only vertical motion, preserving timing and smooth endpoints.
      const envelope = Math.sin(Math.PI * phase / 12) ** 2;
      pose.bodyY += 1.5 * Math.sin(phase * Math.PI * 2 / 3.7) * envelope;
      pose.bodyY *= BODY_BOB_STRENGTH;
      pose.y += .8 * Math.sin(phase * Math.PI * 2 / 4.1) * envelope;
      for (const key of ['x', 'z', 'eyeX', 'bodyX', 'bodyZ']) pose[key] *= direction * strength;
      return pose;
    },
  };
}
