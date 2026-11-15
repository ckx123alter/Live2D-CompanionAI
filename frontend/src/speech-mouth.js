import { createAppearanceTransition } from './appearance-transition.js';

// Some authored expression switches replace/hide the entire normal mouth.
// Evaluate a neutral mouth separately, then composite only its meshes into the
// expression frame. Eyes, brows, props and the selected expression stay intact.
export function installSpeechMouth(core, displayInfo, isSpeaking, {
  now=()=>performance.now(), duration=260, getRestingOpening=()=>0,
}={}) {
  const raw=core.getModel(), parameters=raw.parameters, drawables=raw.drawables;
  const mouthParts=new Set(displayInfo.Parts.filter(part=>['嘴线','嘴皮','口内'].includes(part.Name)).map(part=>part.Id));
  const mouthMeshes=[];
  for(let index=0;index<drawables.count;index++){
    let part=drawables.parentPartIndices[index];
    while(part>=0){
      if(mouthParts.has(raw.parts.ids[part])){mouthMeshes.push(index);break;}
      part=raw.parts.parentIndices[part];
    }
  }
  // The author's static "无语" mouth is outside the normal mouth parts.
  const staticMouth=drawables.ids.indexOf('ArtMesh345');
  const neutralIds=[...Array.from({length:9},(_,index)=>`key${index+1}`),
    'ParamMouthForm','TongueOut','CheeckPuff','Mouthpucker'];
  const neutralIndices=neutralIds.map(id=>parameters.ids.indexOf(id)).filter(index=>index>=0);
  const saved=new Float32Array(neutralIndices.length);
  const vertices=mouthMeshes.map(index=>new Float32Array(drawables.vertexPositions[index].length));
  const opacities=new Float32Array(mouthMeshes.length);
  const transition=createAppearanceTransition(duration);
  const openingIndex=parameters.ids.indexOf('ParamMouthOpenY');
  let speechOpening=0;
  const update=core.update.bind(core);
  core.update=()=>{
    const speaking=isSpeaking(), time=now();
    transition.set({weight:speaking?1:0},time);
    const weight=transition.sample(time).weight||0;
    if((!speaking&&weight===0)||!mouthMeshes.length){update();return;}
    const originalOpening=openingIndex>=0?parameters.values[openingIndex]:0;
    if(speaking)speechOpening=originalOpening;
    for(let n=0;n<neutralIndices.length;n++){
      const index=neutralIndices[n];saved[n]=parameters.values[index];
      parameters.values[index]=parameters.defaultValues[index];
    }
    try {
      // Retain the last spoken opening during fade-out instead of snapping
      // immediately to the expression's resting opening when audio ends.
      if(openingIndex>=0)parameters.values[openingIndex]=speechOpening;
      raw.update();
      for(let n=0;n<mouthMeshes.length;n++){
        const index=mouthMeshes[n];
        vertices[n].set(drawables.vertexPositions[index]);
        opacities[n]=drawables.opacities[index];
      }
    } finally {
      for(let n=0;n<neutralIndices.length;n++)parameters.values[neutralIndices[n]]=saved[n];
      if(openingIndex>=0)parameters.values[openingIndex]=originalOpening;
    }
    try {
      if(openingIndex>=0)parameters.values[openingIndex]=getRestingOpening();
      update();
    } finally {
      if(openingIndex>=0)parameters.values[openingIndex]=originalOpening;
    }
    for(let n=0;n<mouthMeshes.length;n++){
      const index=mouthMeshes[n];
      const positions=drawables.vertexPositions[index];
      for(let v=0;v<positions.length;v++)positions[v]+=(vertices[n][v]-positions[v])*weight;
      drawables.opacities[index]+=(opacities[n]-drawables.opacities[index])*weight;
      // Cubism: visible, visibility/opacity changed, vertex positions changed.
      drawables.dynamicFlags[index]|=0x27;
    }
    if(staticMouth>=0){drawables.opacities[staticMouth]*=1-weight;drawables.dynamicFlags[staticMouth]|=0x06;}
  };
}
