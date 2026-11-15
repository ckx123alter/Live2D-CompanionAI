// Work in canvas CSS pixels, independent of device pixel ratio.
export function gazeTarget(pointer, eyes) {
  if (!pointer || !eyes || eyes.span <= 0) return { x: 0, y: 0 };
  const axis = (distance, range) => {
    const deadZone = eyes.span * .08;
    const magnitude = Math.max(0, Math.abs(distance) - deadZone);
    return Math.sign(distance) * Math.min(1, magnitude / range);
  };
  return {
    x: axis(pointer.x - eyes.x, eyes.span * 1.5) * .16,
    // Canvas Y points down; Cubism eye/head Y points up.
    y: -axis(pointer.y - eyes.y, eyes.span * 1.25) * .10,
  };
}

export function createEyeLocator(model, displayInfo) {
  const internal = model.internalModel;
  const core = internal.coreModel;
  const raw = core.getModel();
  const eyeParts = new Set(displayInfo.Parts.filter(p => p.Name === '眼白').map(p => p.Id));
  const parents = core.getPartParentPartIndices();
  const candidates = [];
  for (let drawable = 0; drawable < core.getDrawableCount(); drawable++) {
    let part = core.getDrawableParentPartIndex(drawable);
    while (part >= 0) {
      if (eyeParts.has(raw.parts.ids[part])) { candidates.push(drawable); break; }
      part = parents[part];
    }
  }
  let lastEyes;
  return () => {
    const visible = candidates.filter(index => core.getDrawableOpacity(index) > .45);
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for (const index of visible) {
      const vertices = internal.getDrawableVertices(index);
      for(let n=0;n<vertices.length;n+=2) {
        minX=Math.min(minX,vertices[n]);maxX=Math.max(maxX,vertices[n]);
        minY=Math.min(minY,vertices[n+1]);maxY=Math.max(maxY,vertices[n+1]);
      }
    }
    // Keep the previous stable center during a blink or a body transition.
    if (!Number.isFinite(minX) || maxX-minX < 1 || maxY-minY < 1) return lastEyes;
    const center=model.toGlobal(internal.localTransform.apply({x:(minX+maxX)/2,y:(minY+maxY)/2}));
    const left=model.toGlobal(internal.localTransform.apply({x:minX,y:(minY+maxY)/2}));
    const right=model.toGlobal(internal.localTransform.apply({x:maxX,y:(minY+maxY)/2}));
    lastEyes={x:center.x,y:center.y,span:Math.hypot(right.x-left.x,right.y-left.y)};
    return lastEyes;
  };
}
