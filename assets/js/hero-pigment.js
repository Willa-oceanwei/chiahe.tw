/* Living pigment field for the home-page hero. */
(function () {
  'use strict';

  const PARTICLE_CONFIG = {
    desktopCount: 1200,
    mobileCount: 500,
    reducedMotionCount: 100,
    clusterCount: 5,
    clusterRadiusMin: 160,
    clusterRadiusMax: 260,
    minSize: 0.32,
    mediumSize: 0.82,
    maxSize: 1.9,
    clusterAttractionStrength: 0.000032,
    separationDistance: 5.5,
    separationStrength: 0.014,
    damping: 0.978,
    mouseInnerRadius: 105,
    mouseOuterRadius: 270,
    mouseForce: 0.052,
    mouseVelocityForce: 0.018,
    clusterAttractionRange: 620,
    clusterCollisionDistance: 205,
    collisionDistance: 22,
    collisionImpulse: 2.7,
    maxActiveCollisions: 2,
    collisionIntervalMin: 300,
    collisionIntervalMax: 510,
    diffusionLife: 260,
    maxActiveDiffusions: 8,
    spatialCellSize: 12,
    dprCap: 1.6
  };

  const COLOR_PALETTE = [
    [39, 177, 187],
    [202, 76, 137],
    [228, 184, 67],
    [224, 112, 73],
    [116, 92, 164]
  ];

  window.HERO_PIGMENT_CONFIG = PARTICLE_CONFIG;
  window.HERO_PIGMENT_PALETTE = COLOR_PALETTE;

  const hero = document.getElementById('intro');
  if (!hero) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'hero-pigment-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  hero.insertBefore(canvas, hero.firstChild);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  const mobileQuery = window.matchMedia('(max-width: 736px)');
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: 0, y: 0, oldX: 0, oldY: 0, vx: 0, vy: 0, active: false };
  let width = 1;
  let height = 1;
  let particles = [];
  let clusters = [];
  let diffusions = [];
  let burstParticles = [];
  let collision = null;
  let collisionClock = 150;
  let gridHeads = new Int32Array(1);
  let gridNext = new Int32Array(1);
  let gridColumns = 1;
  let gridRows = 1;
  let animationFrame = 0;
  let lastTime = performance.now();
  let visible = !document.hidden;

  const random = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rgba = (colour, alpha) => `rgba(${colour[0] | 0},${colour[1] | 0},${colour[2] | 0},${alpha})`;

  function rgbToOklab(colour) {
    const linear = colour.map((value) => {
      value /= 255;
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    const l = Math.cbrt(0.4122214708 * linear[0] + 0.5363325363 * linear[1] + 0.0514459929 * linear[2]);
    const m = Math.cbrt(0.2119034982 * linear[0] + 0.6806995451 * linear[1] + 0.1073969566 * linear[2]);
    const s = Math.cbrt(0.0883024619 * linear[0] + 0.2817188376 * linear[1] + 0.6299787005 * linear[2]);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    ];
  }

  function oklabToRgb(lab) {
    const l = Math.pow(lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2], 3);
    const m = Math.pow(lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2], 3);
    const s = Math.pow(lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2], 3);
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
    ].map((value) => {
      value = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(Math.max(0, value), 1 / 2.4) - 0.055;
      return 255 * clamp(value, 0, 1);
    });
  }

  function mixColours(left, right) {
    const a = rgbToOklab(left);
    const b = rgbToOklab(right);
    const balance = random(0.38, 0.62);
    return oklabToRgb([
      a[0] * balance + b[0] * (1 - balance) + random(-0.015, 0.022),
      a[1] * balance + b[1] * (1 - balance) + random(-0.01, 0.01),
      a[2] * balance + b[2] * (1 - balance) + random(-0.01, 0.01)
    ]);
  }

  function createClusters() {
    clusters = Array.from({ length: PARTICLE_CONFIG.clusterCount }, (_, index) => {
      const angle = index / PARTICLE_CONFIG.clusterCount * Math.PI * 2 - Math.PI / 2;
      return {
        x: width * 0.58 + Math.cos(angle) * width * 0.26,
        y: height * 0.5 + Math.sin(angle) * height * 0.27,
        vx: 0,
        vy: 0,
        radius: random(PARTICLE_CONFIG.clusterRadiusMin, PARTICLE_CONFIG.clusterRadiusMax),
        phase: random(0, Math.PI * 2),
        colour: COLOR_PALETTE[index]
      };
    });
  }

  function particleSize() {
    const roll = Math.random();
    if (roll < 0.76) return random(PARTICLE_CONFIG.minSize, PARTICLE_CONFIG.mediumSize);
    if (roll < 0.97) return random(PARTICLE_CONFIG.mediumSize, 1.25);
    return random(1.25, PARTICLE_CONFIG.maxSize);
  }

  function createParticle(index) {
    const clusterIndex = index % clusters.length;
    const cluster = clusters[clusterIndex];
    const angle = random(0, Math.PI * 2);
    const normalizedRadius = Math.pow(Math.random(), 0.72);
    const radius = cluster.radius * normalizedRadius;
    const depth = Math.random();
    return {
      x: cluster.x + Math.cos(angle) * radius,
      y: cluster.y + Math.sin(angle) * radius * 0.62,
      vx: random(-0.16, 0.16),
      vy: random(-0.16, 0.16),
      size: particleSize() * (0.72 + depth * 0.48),
      alpha: random(0.16, 0.42) + depth * 0.2,
      speed: 0.72 + depth * 0.48,
      cluster: clusterIndex,
      colour: cluster.colour,
      mixLife: 0,
      phase: random(0, Math.PI * 2)
    };
  }

  function resize() {
    const rect = hero.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, PARTICLE_CONFIG.dprCap);
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    createClusters();
    const count = reducedQuery.matches
      ? PARTICLE_CONFIG.reducedMotionCount
      : (mobileQuery.matches ? PARTICLE_CONFIG.mobileCount : PARTICLE_CONFIG.desktopCount);
    particles = Array.from({ length: count }, (_, index) => createParticle(index));
    gridColumns = Math.ceil(width / PARTICLE_CONFIG.spatialCellSize);
    gridRows = Math.ceil(height / PARTICLE_CONFIG.spatialCellSize);
    gridHeads = new Int32Array(gridColumns * gridRows);
    gridNext = new Int32Array(count);
    diffusions = [];
    burstParticles = [];
    collision = null;
    collisionClock = 150;
  }

  function startClusterCollision() {
    let a = Math.floor(Math.random() * clusters.length);
    let b = (a + 1 + Math.floor(Math.random() * (clusters.length - 1))) % clusters.length;
    const first = clusters[a];
    const second = clusters[b];
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.hypot(dx, dy) || 1;
    if (distance > PARTICLE_CONFIG.clusterAttractionRange) b = (a + 1) % clusters.length;
    collision = { a, b, age: 0, phase: 'approach', mixed: false };
  }

  function emitCollision(contactX, contactY, first, second) {
    const mixed = mixColours(first.colour, second.colour);
    diffusions.push({
      x: contactX,
      y: contactY,
      colour: mixed,
      age: 0,
      life: PARTICLE_CONFIG.diffusionLife,
      radius: random(58, 82),
      phase: random(0, Math.PI * 2)
    });
    if (diffusions.length > PARTICLE_CONFIG.maxActiveDiffusions) diffusions.shift();

    let recoloured = 0;
    for (let index = 0; index < particles.length && recoloured < 90; index += 1) {
      const particle = particles[index];
      if (particle.cluster !== collision.a && particle.cluster !== collision.b) continue;
      const dx = particle.x - contactX;
      const dy = particle.y - contactY;
      const distance = Math.hypot(dx, dy);
      if (distance < 115 && Math.random() < 0.7) {
        const direction = distance || 1;
        particle.colour = mixColours(mixed, Math.random() < 0.5 ? first.colour : second.colour);
        particle.mixLife = random(240, 430);
        particle.vx += dx / direction * random(0.35, PARTICLE_CONFIG.collisionImpulse);
        particle.vy += dy / direction * random(0.35, PARTICLE_CONFIG.collisionImpulse);
        recoloured += 1;
      }
    }

    const burstCount = mobileQuery.matches ? 34 : 72;
    for (let index = 0; index < burstCount; index += 1) {
      const angle = random(0, Math.PI * 2);
      const force = random(0.45, PARTICLE_CONFIG.collisionImpulse);
      burstParticles.push({
        x: contactX + random(-12, 12),
        y: contactY + random(-12, 12),
        vx: Math.cos(angle) * force,
        vy: Math.sin(angle) * force,
        size: particleSize(),
        alpha: random(0.25, 0.62),
        colour: mixColours(mixed, Math.random() < 0.5 ? first.colour : second.colour),
        age: 0,
        life: random(48, 82)
      });
    }
  }

  function updateClusterCollision(dt) {
    collisionClock -= dt;
    if (!collision && collisionClock <= 0 && !reducedQuery.matches) startClusterCollision();
    if (!collision) return;

    collision.age += dt;
    const first = clusters[collision.a];
    const second = clusters[collision.b];
    const dx = second.x - first.x;
    const dy = second.y - first.y;
    const distance = Math.hypot(dx, dy) || 1;
    const nx = dx / distance;
    const ny = dy / distance;

    if (collision.phase === 'approach') {
      const pull = distance > PARTICLE_CONFIG.clusterCollisionDistance ? 0.026 : 0.012;
      first.vx += nx * pull * dt;
      first.vy += ny * pull * dt;
      second.vx -= nx * pull * dt;
      second.vy -= ny * pull * dt;
      if (distance < PARTICLE_CONFIG.clusterCollisionDistance || collision.age > 155) {
        collision.phase = 'compress';
        collision.age = 0;
      }
    } else if (collision.phase === 'compress') {
      first.vx += nx * 0.018 * dt;
      first.vy += ny * 0.018 * dt;
      second.vx -= nx * 0.018 * dt;
      second.vy -= ny * 0.018 * dt;
      if (collision.age > 42 && !collision.mixed) {
        collision.mixed = true;
        emitCollision((first.x + second.x) / 2, (first.y + second.y) / 2, first, second);
        first.vx -= nx * PARTICLE_CONFIG.collisionImpulse;
        first.vy -= ny * PARTICLE_CONFIG.collisionImpulse;
        second.vx += nx * PARTICLE_CONFIG.collisionImpulse;
        second.vy += ny * PARTICLE_CONFIG.collisionImpulse;
        collision.phase = 'separate';
        collision.age = 0;
      }
    } else if (collision.age > 95) {
      collision = null;
      collisionClock = random(PARTICLE_CONFIG.collisionIntervalMin, PARTICLE_CONFIG.collisionIntervalMax);
    }
  }

  function updateClusters(dt, time) {
    updateClusterCollision(dt);
    clusters.forEach((cluster, index) => {
      cluster.vx += Math.sin(time * 0.00017 + cluster.phase + index) * 0.0015 * dt;
      cluster.vy += Math.cos(time * 0.00014 + cluster.phase) * 0.0012 * dt;
      if (cluster.x < width * 0.08) cluster.vx += 0.012 * dt;
      if (cluster.x > width * 0.94) cluster.vx -= 0.012 * dt;
      if (cluster.y < height * 0.09) cluster.vy += 0.012 * dt;
      if (cluster.y > height * 0.91) cluster.vy -= 0.012 * dt;
      cluster.vx *= Math.pow(0.992, dt);
      cluster.vy *= Math.pow(0.992, dt);
      cluster.x += cluster.vx * dt;
      cluster.y += cluster.vy * dt;
    });
  }

  function rebuildSpatialGrid() {
    gridHeads.fill(-1);
    particles.forEach((particle, index) => {
      const column = clamp(Math.floor(particle.x / PARTICLE_CONFIG.spatialCellSize), 0, gridColumns - 1);
      const row = clamp(Math.floor(particle.y / PARTICLE_CONFIG.spatialCellSize), 0, gridRows - 1);
      const cell = row * gridColumns + column;
      gridNext[index] = gridHeads[cell];
      gridHeads[cell] = index;
    });
  }

  function separateParticle(particle, index, dt) {
    const column = clamp(Math.floor(particle.x / PARTICLE_CONFIG.spatialCellSize), 0, gridColumns - 1);
    const row = clamp(Math.floor(particle.y / PARTICLE_CONFIG.spatialCellSize), 0, gridRows - 1);
    let checked = 0;
    for (let y = Math.max(0, row - 1); y <= Math.min(gridRows - 1, row + 1) && checked < 7; y += 1) {
      for (let x = Math.max(0, column - 1); x <= Math.min(gridColumns - 1, column + 1) && checked < 7; x += 1) {
        let neighbourIndex = gridHeads[y * gridColumns + x];
        while (neighbourIndex !== -1 && checked < 7) {
          if (neighbourIndex !== index) {
            const neighbour = particles[neighbourIndex];
            const dx = particle.x - neighbour.x;
            const dy = particle.y - neighbour.y;
            const squared = dx * dx + dy * dy;
            if (squared > 0 && squared < PARTICLE_CONFIG.separationDistance * PARTICLE_CONFIG.separationDistance) {
              const distance = Math.sqrt(squared);
              const force = (1 - distance / PARTICLE_CONFIG.separationDistance) * PARTICLE_CONFIG.separationStrength * dt;
              particle.vx += dx / distance * force;
              particle.vy += dy / distance * force;
            }
            checked += 1;
          }
          neighbourIndex = gridNext[neighbourIndex];
        }
      }
    }
  }

  function applyPointerForce(particle, dt) {
    if (!pointer.active || mobileQuery.matches || reducedQuery.matches) return;
    const dx = particle.x - pointer.x;
    const dy = particle.y - pointer.y;
    const distance = Math.hypot(dx, dy) || 1;
    if (distance >= PARTICLE_CONFIG.mouseOuterRadius) return;
    const outer = 1 - distance / PARTICLE_CONFIG.mouseOuterRadius;
    const inner = distance < PARTICLE_CONFIG.mouseInnerRadius
      ? 1 - distance / PARTICLE_CONFIG.mouseInnerRadius
      : 0;
    const force = (outer * 0.012 + inner * PARTICLE_CONFIG.mouseForce) * dt;
    const velocityScale = Math.min(2.4, Math.hypot(pointer.vx, pointer.vy) / 18);
    particle.vx += dx / distance * force + pointer.vx * PARTICLE_CONFIG.mouseVelocityForce * outer * velocityScale;
    particle.vy += dy / distance * force + pointer.vy * PARTICLE_CONFIG.mouseVelocityForce * outer * velocityScale;
  }

  function updateParticles(dt, time) {
    rebuildSpatialGrid();
    particles.forEach((particle, index) => {
      const cluster = clusters[particle.cluster];
      const dx = cluster.x - particle.x;
      const dy = cluster.y - particle.y;
      const distance = Math.hypot(dx, dy) || 1;
      let attraction = PARTICLE_CONFIG.clusterAttractionStrength;
      if (collision && (particle.cluster === collision.a || particle.cluster === collision.b) && collision.phase === 'compress') attraction *= 2.4;
      particle.vx += dx * attraction * dt;
      particle.vy += dy * attraction * dt;
      particle.vx += Math.sin(time * 0.00055 + particle.phase + particle.y * 0.008) * 0.0022 * dt;
      particle.vy += Math.cos(time * 0.00047 + particle.phase + particle.x * 0.008) * 0.002 * dt;
      separateParticle(particle, index, dt);
      applyPointerForce(particle, dt);
      particle.vx *= Math.pow(PARTICLE_CONFIG.damping, dt);
      particle.vy *= Math.pow(PARTICLE_CONFIG.damping, dt);
      particle.x += particle.vx * particle.speed * dt;
      particle.y += particle.vy * particle.speed * dt;
      if (distance > cluster.radius * 1.65) {
        particle.vx += dx / distance * 0.006 * dt;
        particle.vy += dy / distance * 0.006 * dt;
      }
      if (particle.mixLife > 0) {
        particle.mixLife -= dt;
        if (particle.mixLife <= 0) particle.colour = cluster.colour;
      }
    });
  }

  function addResonance(x, y) {
    let nearbyColours = [];
    particles.forEach((particle) => {
      const dx = particle.x - x;
      const dy = particle.y - y;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance < 190) {
        const force = (1 - distance / 190) * 1.45;
        particle.vx += dx / distance * force;
        particle.vy += dy / distance * force;
        if (!nearbyColours.includes(particle.cluster)) nearbyColours.push(particle.cluster);
      }
    });
    if (nearbyColours.length > 1) {
      const colour = mixColours(clusters[nearbyColours[0]].colour, clusters[nearbyColours[1]].colour);
      diffusions.push({ x, y, colour, age: 0, life: 150, radius: 46, phase: random(0, Math.PI * 2) });
      collisionClock = Math.min(collisionClock, 75);
    }
  }

  function updateEffects(dt) {
    diffusions.forEach((cloud) => { cloud.age += dt; });
    diffusions = diffusions.filter((cloud) => cloud.age < cloud.life);
    burstParticles.forEach((particle) => {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.pow(0.95, dt);
      particle.vy *= Math.pow(0.95, dt);
      particle.age += dt;
    });
    burstParticles = burstParticles.filter((particle) => particle.age < particle.life);
  }

  function drawCloud(cloud, time) {
    const progress = cloud.age / cloud.life;
    const opacity = Math.sin(progress * Math.PI) * 0.24;
    for (let layer = 0; layer < 5; layer += 1) {
      const wobble = cloud.phase + layer * 1.37 + time * 0.00016;
      const x = cloud.x + Math.sin(wobble) * cloud.radius * 0.3;
      const y = cloud.y + Math.cos(wobble * 1.21) * cloud.radius * 0.22;
      const radius = cloud.radius * (0.65 + progress * 2.8 + layer * 0.14);
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, rgba(cloud.colour, opacity));
      gradient.addColorStop(0.45, rgba(cloud.colour, opacity * 0.48));
      gradient.addColorStop(1, rgba(cloud.colour, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }

  function draw(time) {
    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#111a3d');
    background.addColorStop(0.52, '#182654');
    background.addColorStop(1, '#251942');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    clusters.forEach((cluster) => {
      const radius = cluster.radius * 1.42;
      const gradient = ctx.createRadialGradient(cluster.x, cluster.y, 0, cluster.x, cluster.y, radius);
      gradient.addColorStop(0, rgba(cluster.colour, 0.24));
      gradient.addColorStop(0.42, rgba(cluster.colour, 0.12));
      gradient.addColorStop(1, rgba(cluster.colour, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(cluster.x - radius, cluster.y - radius, radius * 2, radius * 2);
    });
    diffusions.forEach((cloud) => drawCloud(cloud, time));

    particles.forEach((particle) => {
      ctx.beginPath();
      ctx.fillStyle = rgba(particle.colour, particle.alpha);
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    });
    burstParticles.forEach((particle) => {
      ctx.beginPath();
      ctx.fillStyle = rgba(particle.colour, particle.alpha * (1 - particle.age / particle.life));
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function animate(time) {
    if (!visible) return;
    const dt = Math.min(1.8, (time - lastTime) / 16.667 || 1);
    lastTime = time;
    const pace = reducedQuery.matches ? 0.2 : 1;
    updateClusters(dt * pace, time);
    updateParticles(dt * pace, time);
    updateEffects(dt * pace);
    draw(time);
    pointer.vx *= 0.72;
    pointer.vy *= 0.72;
    animationFrame = requestAnimationFrame(animate);
  }

  hero.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const rect = hero.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    pointer.vx = clamp(x - pointer.oldX, -45, 45);
    pointer.vy = clamp(y - pointer.oldY, -45, 45);
    pointer.x = x;
    pointer.y = y;
    pointer.oldX = x;
    pointer.oldY = y;
    pointer.active = true;
  }, { passive: true });
  hero.addEventListener('pointerenter', (event) => {
    const rect = hero.getBoundingClientRect();
    pointer.oldX = event.clientX - rect.left;
    pointer.oldY = event.clientY - rect.top;
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { pointer.active = false; }, { passive: true });
  hero.addEventListener('pointerdown', (event) => {
    if (reducedQuery.matches) return;
    const rect = hero.getBoundingClientRect();
    addResonance(event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    visible = !document.hidden;
    cancelAnimationFrame(animationFrame);
    if (visible) {
      lastTime = performance.now();
      animationFrame = requestAnimationFrame(animate);
    }
  });
  window.addEventListener('resize', resize, { passive: true });
  if (mobileQuery.addEventListener) {
    mobileQuery.addEventListener('change', resize);
    reducedQuery.addEventListener('change', resize);
  }

  resize();
  animationFrame = requestAnimationFrame(animate);
}());
