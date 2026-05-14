const canvas = document.getElementById('starfield');
const ctx = canvas.getContext('2d');

let stars = [];
const STAR_COUNT = 400;

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function createStars() {
  stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.8 + 0.3,
      opacity: Math.random(),
      speed: Math.random() * 0.008 + 0.002,
      hue: Math.random() < 0.3 ? 280 : Math.random() < 0.5 ? 200 : 340,
    });
  }
}

function drawStars() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const s of stars) {
    s.opacity += s.speed;
    if (s.opacity > 1 || s.opacity < 0.1) s.speed *= -1;

    const alpha = s.opacity;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${s.hue}, 60%, 70%, ${alpha})`;
    ctx.fill();

    if (s.r > 1.0 && alpha > 0.6) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${s.hue}, 60%, 70%, ${alpha * 0.08})`;
      ctx.fill();
    }
  }
}

function animate() {
  drawStars();
  requestAnimationFrame(animate);
}

resize();
createStars();
animate();
window.addEventListener('resize', () => { resize(); createStars(); });
