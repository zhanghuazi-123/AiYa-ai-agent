// Generate CSS 3D galaxy orbs — orbit around center
const galaxy = document.getElementById('galaxy');
const ORB_COUNT = 80;

const colors = [
  { bg: '#642674', glow: '0 0 0.8vmin 0.2vmin #642674' },
  { bg: '#fff299', glow: '0 0 0.9vmin 0.35vmin #fff4ad' },
  { bg: '#8380f5', glow: '0 0 0.7vmin 0.25vmin #8380f5' },
  { bg: '#f2eda3', glow: '0 0 0.8vmin 0.25vmin #f2eda3' },
  { bg: '#722b83', glow: '0 0 0.9vmin 0.25vmin #722b83' },
  { bg: '#eee784', glow: '0 0 0.7vmin 0.35vmin #f4efb0' },
  { bg: '#ff6b9d', glow: '0 0 0.7vmin 0.2vmin #ff6b9d' },
  { bg: '#c44dff', glow: '0 0 0.6vmin 0.18vmin #c44dff' },
  { bg: '#6ec6ff', glow: '0 0 0.7vmin 0.18vmin #6ec6ff' },
];

for (let i = 0; i < ORB_COUNT; i++) {
  const c = colors[Math.floor(Math.random() * colors.length)];
  const size = (Math.random() * 0.8 + 0.25).toFixed(4);
  const dist = (Math.random() * 30 + 10).toFixed(4);  // 10-40vmin, close to center
  const rx = Math.random() * 360;
  const ry = Math.random() * 360;
  const rz = Math.random() * 360;

  const el = document.createElement('div');
  el.className = 'orb';
  el.style.cssText = `
    --s: ${size}vmin;
    --bg: ${c.bg};
    --glow: ${c.glow};
    --t: rotate3d(1,0,0,${rx}deg) rotate3d(0,1,0,${ry}deg) rotate3d(0,0,1,${rz}deg) translate3d(0,0,${dist}vmin);
  `;
  galaxy.appendChild(el);
}
