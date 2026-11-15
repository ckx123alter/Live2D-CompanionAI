import './stage-background.css';

// A decorative, simplified Cetus figure, not a navigational star chart.
// References: https://astronomy.hk/en/constellations/cet
// https://www.iau.org/IAU/Astronomy-FAQs/Constellations.aspx
const cetus = [
  [54,100,2.6], [24,44,1.5], [78,26,1.7], [118,65,1.5], [106,130,2],
  [132,172,1.4], [165,184,2.1], [222,248,1.8], [329,273,1.7],
  [358,260,1.9], [429,225,1.8], [412,350,2.8], [302,350,1.8],
];
const paths = [[0,1,2,3,4,0],[4,5,6,7,8,9,10,11,12,7]];
// Fixed positions prevent a new arrangement on every render; keep the face area quiet.
const stars = [
  [8,22,1.2],[19,13,1],[34,8,1.4],[69,11,1],[84,18,1.5],[95,8,.8],
  [5,43,.8],[23,35,1],[36,30,.7],[78,34,1.1],[92,42,.8],[13,58,1.3],
  [29,52,.7],[72,56,.8],[88,63,1.4],[6,76,1],[21,82,.8],[35,70,1],
  [78,80,1.2],[95,88,.8],[43,91,.7],[61,86,1],[52,72,.7],[91,29,.6],
];

export function stageBackground() {
  return `<div class="stage-sky" aria-hidden="true">
    <div class="sky-halo"></div>
    <svg class="cetus-constellation" viewBox="0 0 460 380" fill="none" focusable="false">
      <g class="cetus-lines">${paths.map(path=>`<polyline points="${path.map(index=>cetus[index].slice(0,2).join(',')).join(' ')}"/>`).join('')}</g>
      <g class="cetus-stars">${cetus.map(([x,y,r])=>`<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>
      <g class="cetus-glows">${[0,6,11].map(index=>`<circle cx="${cetus[index][0]}" cy="${cetus[index][1]}" r="7"/>`).join('')}</g>
    </svg>
    <div class="sky-stars">${stars.map(([x,y,size],index)=>`<span class="sky-star${index%4===0?' twinkle':''}" style="--x:${x}%;--y:${y}%;--size:${size}px;--duration:${7+index%5}s;--delay:-${index*1.3}s"></span>`).join('')}</div>
  </div>`;
}
