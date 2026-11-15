// Draw server-provided points progressively; never evaluate paths as code.
export function playStrokes(ctx, strokes, onDone, {progress: initial=0, paused: initialPaused=false, onProgress=()=>{}}={}) {
  const count = strokes.reduce((sum, points) => sum + points.length, 0);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = 2.5 * Math.min(6500, Math.max(3500, count * 15));
  let progress=initial, base=initial, start=performance.now(), checkpoint=initial;
  let frame=0, stopped=false, paused=initialPaused, done=false;
  function paint(now) {
    if (stopped) return;
    if(!paused)progress = duration ? Math.min(1, base + (now - start) / duration) : 1;
    let remaining = reducedMotion ? (progress >= 1 ? count : 0) : Math.ceil(count * progress);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = '#282333'; ctx.lineWidth = 5; ctx.lineCap = ctx.lineJoin = 'round';
    for (const points of strokes) {
      if (remaining < 1) break;
      ctx.beginPath(); ctx.moveTo(...points[0]);
      for (let i = 1; i < Math.min(points.length, remaining); i++) ctx.lineTo(...points[i]);
      ctx.stroke(); remaining -= points.length;
    }
    if(progress-checkpoint>=.15){checkpoint=progress;onProgress(progress);}
    if (progress < 1 && !paused) frame = requestAnimationFrame(paint);
    else if(progress>=1&&!done){done=true;onDone();}
  }
  paint(performance.now());
  const cancel=()=>{stopped=true;cancelAnimationFrame(frame);};
  cancel.progress=()=>progress;
  cancel.pause=()=>{if(paused||stopped)return;cancelAnimationFrame(frame);paused=true;};
  cancel.resume=()=>{if(!paused||stopped||done)return;paused=false;base=progress;start=performance.now();frame=requestAnimationFrame(paint);};
  return cancel;
}
