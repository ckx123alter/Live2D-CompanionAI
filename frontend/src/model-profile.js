// Pick the atlas before loading it: resizing after decode still exhausts phone memory.
export function modelProfile({coarsePointer = false, mobileUA = false, maxTextureSize = 8192, dpr = 1} = {}) {
  const lightweight = coarsePointer || mobileUA || maxTextureSize < 8192;
  return {
    lightweight,
    url: lightweight ? '/model/大肥鱼.mobile.model3.json' : '/model/大肥鱼.model3.json',
    resolution: Math.min(dpr, lightweight ? 1.5 : 2),
    antialias: !lightweight,
    // Safari uploads HTML images reliably; avoid worker ImageBitmap copies on phones.
    textureOptions: lightweight ? {lod: false, preferCreateImageBitmap: false} : {lod: 'full'},
  };
}
