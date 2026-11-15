// Reuse only expression curves; the full idle motion also moves the body.
export function createExpressionAnimation(motion) {
  const curves = motion.Curves.filter(curve => /^(SweatBurst[1-6]|Param11)$/.test(curve.Id));
  const duration = motion.Meta.Duration;
  const cubic = (a, b, c, d, t) => (1-t)**3*a + 3*(1-t)**2*t*b + 3*(1-t)*t*t*c + t**3*d;
  const sample = (values, time) => {
    let x = values[0], y = values[1], i = 2;
    while (i < values.length) {
      const type = values[i++];
      if (type === 1) {
        const [x1,y1,x2,y2,x3,y3] = values.slice(i,i+6); i += 6;
        if (time <= x3) {
          let low = 0, high = 1;
          for (let n = 0; n < 16; n++) {
            const t = (low+high)/2;
            if (cubic(x,x1,x2,x3,t) < time) low=t; else high=t;
          }
          return cubic(y,y1,y2,y3,(low+high)/2);
        }
        x=x3; y=y3;
      } else {
        const endX=values[i++], endY=values[i++];
        if (time <= endX) {
          if (type === 2) return y;
          if (type === 3) return endY;
          return y+(endY-y)*Math.max(0,(time-x)/(endX-x || 1));
        }
        x=endX; y=endY;
      }
    }
    return y;
  };
  return seconds => Object.fromEntries(curves.map(curve => [curve.Id, sample(curve.Segments, seconds % duration)]));
}
