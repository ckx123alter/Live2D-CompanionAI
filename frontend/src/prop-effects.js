// These decoration parameters have no visible meshes in the distributed rig.
// Draw lightweight vector effects and anchor them to the rendered eyes so
// dragging, zooming, body changes and head gestures keep the props in place.
const flower = `<svg viewBox="-20 -20 40 40" fill="currentColor" aria-hidden="true">${Array.from({length:5}, (_,n)=>`<ellipse cy="-9" rx="5.8" ry="8" transform="rotate(${n*72})"/>`).join('')}<circle r="5" fill="#ffe8a9"/></svg>`;
const sparkle = '<svg viewBox="-20 -20 40 40" fill="currentColor" aria-hidden="true"><path d="M0-18Q3-3 15 0Q3 3 0 18Q-3 3-15 0Q-3-3 0-18Z"/></svg>';
// Eye-span units: stagger sparkles from the shoulders down either side of the torso.
const sparkleAnchors = [[-1.35,.85],[1.55,1.25],[-1.7,1.95],[1.25,2.45],[-.95,3.1],[1.65,3.45]];

export function createPropEffects(host) {
  const layer = document.createElement('div');
  layer.className = 'prop-effects';
  layer.setAttribute('aria-hidden', 'true');
  const groups = { flowers: [], sparkles: [] };
  for (const [key, count, svg] of [['flowers', 5, flower], ['sparkles', sparkleAnchors.length, sparkle]]) {
    for (let index=0; index<count; index++) {
      const node = document.createElement('span');
      node.className = `prop-effect ${key}`;
      node.innerHTML = svg;
      node.hidden = true;
      layer.append(node);
      groups[key].push(node);
    }
  }
  host.append(layer);
  return (eyes, flowerWeight, seconds) => {
    for (const [key, nodes] of Object.entries(groups)) {
      const weight=key==='sparkles'?1:flowerWeight;
      const visible = Boolean(eyes && weight>.001);
      nodes.forEach((node,index) => {
        node.hidden = !visible;
        if (!visible) return;
        const span = eyes.span;
        const phase = (seconds / 3.8 + index / nodes.length) % 1;
        const side = index % 2 ? 1 : -1;
        const anchor = key === 'sparkles' ? sparkleAnchors[index] : null;
        const x = eyes.x + span * (anchor
          ? anchor[0] + Math.sin(seconds * .65 + index * 2) * .16
          : side * (1.05 + (index % 3) * .25) + Math.sin(seconds + index * 2) * .12);
        const y = eyes.y + span * (anchor
          ? anchor[1] + Math.sin(seconds * .8 + index * 1.7) * .18
          : .35 - phase * 2.2);
        const size = span * (key === 'flowers' ? .33 : .28);
        const opacity = key === 'flowers' ? Math.sin(Math.PI * phase) * .9 : .35 + .65 * (Math.sin(seconds * 3 + index * 1.7) + 1) / 2;
        const rotation = key === 'flowers' ? seconds * 22 + index * 47 : 0;
        node.style.width = `${size}px`;
        node.style.height = `${size}px`;
        node.style.opacity = opacity*weight;
        node.style.transform = `translate(${x-size/2}px,${y-size/2}px) rotate(${rotation}deg) scale(${key==='sparkles'?.65+opacity*.35:1})`;
      });
    }
  };
}
