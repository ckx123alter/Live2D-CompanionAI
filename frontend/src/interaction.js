export function tapRegion(point, eyes) {
  if (!eyes) return 'body';
  const relativeY=(point.y-eyes.y)/eyes.span;
  return relativeY < -.3 ? 'head' : relativeY < .55 ? 'face' : 'body';
}

// A short, decaying shake. Start/end at rest so idle never inherits an offset.
export function tapPose(region, elapsed, side=1) {
  const t=Math.max(0,elapsed)/1400;
  if(t>=1)return {x:0,y:0,z:0,bodyX:0,bodyY:0,bodyZ:0};
  const envelope=(1-Math.exp(-t*32))*(1-t)**2;
  const wave=Math.sin(t*Math.PI*6)*envelope*side;
  const bounce=Math.sin(t*Math.PI*8)*envelope;
  const strength=region==='body'?1:region==='head'?.85:.7;
  return {x:26*wave*strength,y:12*bounce*strength,z:14*wave*strength,
    bodyX:wave*.3*strength,bodyY:region==='body'?22*bounce:0,bodyZ:-wave*.24*strength};
}

export function pointInTriangle(p,a,b,c) {
  const cross=(u,v,w)=>(u.x-w.x)*(v.y-w.y)-(v.x-w.x)*(u.y-w.y);
  if(Math.abs(cross(a,b,c))<1e-6)return false;
  const d1=cross(p,a,b),d2=cross(p,b,c),d3=cross(p,c,a);
  return !((d1<0||d2<0||d3<0)&&(d1>0||d2>0||d3>0));
}

// Test visible drawable geometry, not the model's padded rectangular canvas.
export function hitsModel(model, screenPoint) {
  const p=model.toModelPosition(screenPoint);
  const internal=model.internalModel,core=internal.coreModel;
  for(let index=core.getDrawableCount()-1;index>=0;index--) {
    if(core.getDrawableOpacity(index)<.2)continue;
    const v=internal.getDrawableVertices(index);
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(let j=0;j<v.length;j+=2){minX=Math.min(minX,v[j]);maxX=Math.max(maxX,v[j]);minY=Math.min(minY,v[j+1]);maxY=Math.max(maxY,v[j+1]);}
    if(p.x<minX||p.x>maxX||p.y<minY||p.y>maxY)continue;
    const indices=core.getDrawableVertexIndices(index);
    const vertex=i=>({x:v[i*2],y:v[i*2+1]});
    for(let j=0;j<indices.length;j+=3) {
      if(pointInTriangle(p,vertex(indices[j]),vertex(indices[j+1]),vertex(indices[j+2])))return true;
    }
  }
  return false;
}
