import test from 'node:test';
import assert from 'node:assert/strict';
import { modelProfile } from '../src/model-profile.js';

test('phones, touch tablets, and limited GPUs select small atlases before decode', () => {
  for (const device of [{mobileUA: true}, {coarsePointer: true}, {maxTextureSize: 4096}]) {
    const profile = modelProfile({...device, dpr: 3});
    assert.match(profile.url, /\.mobile\.model3\.json$/);
    assert.equal(profile.textureOptions.lod, false);
    assert.equal(profile.textureOptions.preferCreateImageBitmap, false);
    assert.equal(profile.resolution, 1.5);
    assert.equal(profile.antialias, false);
  }
});

test('desktop keeps the original atlas and high quality rendering', () => {
  const profile = modelProfile({dpr: 3, maxTextureSize: 16384});
  assert.equal(profile.lightweight, false);
  assert.doesNotMatch(profile.url, /mobile/);
  assert.equal(profile.textureOptions.lod, 'full');
  assert.equal(profile.resolution, 2);
});
