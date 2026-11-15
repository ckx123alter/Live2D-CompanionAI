// Continue from the authored entrance pose, moving the wrist and forearm.
// Param42 also drives the model's grass physics, so the tip trails the hand.
export function grassActionPose(seconds, held, entrance = null) {
  const time=Math.max(0,seconds);
  const smooth=value=>{const x=Math.max(0,Math.min(1,value));return x*x*(3-2*x);};
  const weight=smooth(time/.45)*(held?1:smooth((2.8-time)/.45));
  const phase=time*Math.PI*2/2.4;
  const pose = {
    Param36:.04+.025*Math.sin(phase*.5)*weight,
    Param39:.2+.025*Math.sin(phase)*weight,
    Param41:-.732+.12*Math.sin(phase)*weight,
    Param42:(.26*Math.sin(phase)+.06*Math.sin(phase*2))*weight,
  };
  // Blend the actual entrance pose into the authored hold pose while the
  // wrist oscillation ramps in, preserving continuity at the handoff.
  if(entrance){
    const blend=smooth(time/.45);
    for(const id of Object.keys(pose))pose[id]=entrance[id]+(pose[id]-entrance[id])*blend;
  }
  return pose;
}
