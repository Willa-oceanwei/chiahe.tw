/* Living pigment field for the home-page hero. */
(function () {
  'use strict';

  const PARTICLE_CONFIG = {
    desktopCount: 420, mobileCount: 190, reducedMotionCount: 70,
    minSize: 0.45, maxSize: 2.15, speed: 0.16,
    mouseRadius: 135, mouseForce: 0.012,
    collisionDistance: 13, collisionProbability: 0.035, collisionSpeed: 0.18,
    burstStrength: 1.35, diffusionLife: 260, maxActiveDiffusions: 7,
    groupCount: 6, dprCap: 1.7
  };
  const COLOR_PALETTE = [
    [39, 177, 187], [202, 76, 137], [228, 184, 67],
    [224, 112, 73], [116, 92, 164], [207, 202, 190]
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

  const mobile = window.matchMedia('(max-width: 736px)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: 0, y: 0, oldX: 0, oldY: 0, active: false, colour: null, colourLife: 0 };
  let width, height, particles = [], groups = [], clouds = [], bursts = [], frame, last = performance.now();
  let visible = !document.hidden;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  function toLab(c) {
    const n = c.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
    const l = Math.cbrt(.4122214708*n[0] + .5363325363*n[1] + .0514459929*n[2]);
    const m = Math.cbrt(.2119034982*n[0] + .6806995451*n[1] + .1073969566*n[2]);
    const s = Math.cbrt(.0883024619*n[0] + .2817188376*n[1] + .6299787005*n[2]);
    return [.2104542553*l + .793617785*m - .0040720468*s, 1.9779984951*l - 2.428592205*m + .4505937099*s, .0259040371*l + .7827717662*m - .808675766*s];
  }
  function fromLab(c) {
    const l = Math.pow(c[0] + .3963377774*c[1] + .2158037573*c[2], 3);
    const m = Math.pow(c[0] - .1055613458*c[1] - .0638541728*c[2], 3);
    const s = Math.pow(c[0] - .0894841775*c[1] - 1.291485548*c[2], 3);
    return [4.0767416621*l - 3.3077115913*m + .2309699292*s, -1.2684380046*l + 2.6097574011*m - .3413193965*s, -.0041960863*l - .7034186147*m + 1.707614701*s].map(v => {
      v = v <= .0031308 ? 12.92*v : 1.055*Math.pow(Math.max(0, v), 1/2.4) - .055;
      return 255 * clamp(v, 0, 1);
    });
  }
  function mix(a, b) {
    const x = toLab(a), y = toLab(b), t = rand(.42, .58);
    return fromLab([x[0]*t+y[0]*(1-t)+rand(-.018,.025), x[1]*t+y[1]*(1-t)+rand(-.012,.012), x[2]*t+y[2]*(1-t)+rand(-.012,.012)]);
  }

  function makeGroups() {
    groups = Array.from({ length: PARTICLE_CONFIG.groupCount }, (_, i) => ({
      x: width * rand(.12, .9), y: height * rand(.12, .9), phase: rand(0, 6.28), colour: COLOR_PALETTE[i]
    }));
  }
  function makeParticle(i) {
    const g = groups[i % groups.length], angle = rand(0, 6.28), radius = Math.pow(Math.random(), .62) * Math.min(width, height) * .28;
    return { x: clamp(g.x + Math.cos(angle)*radius, 0, width), y: clamp(g.y + Math.sin(angle)*radius*.62, 0, height),
      vx: rand(-.12,.12), vy: rand(-.12,.12), size: rand(PARTICLE_CONFIG.minSize, PARTICLE_CONFIG.maxSize),
      alpha: rand(.2,.62), group: i % groups.length, colour: g.colour, phase: rand(0,6.28) };
  }
  function resize() {
    const rect = hero.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, PARTICLE_CONFIG.dprCap);
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
    canvas.style.width = width+'px'; canvas.style.height = height+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0); makeGroups();
    const count = reduced.matches ? PARTICLE_CONFIG.reducedMotionCount : mobile.matches ? PARTICLE_CONFIG.mobileCount : PARTICLE_CONFIG.desktopCount;
    particles = Array.from({length: count}, (_, i) => makeParticle(i)); clouds = []; bursts = [];
  }
  function collide(a, b) {
    const colour = mix(a.colour, b.colour), x = (a.x+b.x)/2, y = (a.y+b.y)/2;
    if (clouds.length < PARTICLE_CONFIG.maxActiveDiffusions) clouds.push({x,y,colour,age:0,life:PARTICLE_CONFIG.diffusionLife*rand(.78,1.15),phase:rand(0,6.28),radius:rand(34,62)});
    for (let i=0; i<7; i++) { const angle=rand(0,6.28), power=rand(.22,PARTICLE_CONFIG.burstStrength); bursts.push({x,y,vx:Math.cos(angle)*power,vy:Math.sin(angle)*power,colour,age:0,life:rand(28,52),size:rand(.6,1.8)}); }
    a.colour = colour; b.colour = colour; a.vx -= (b.x-a.x)*.004; b.vx += (b.x-a.x)*.004;
  }
  function update(dt, time) {
    const pace = (reduced.matches ? .18 : 1) * (PARTICLE_CONFIG.speed / .16);
    groups.forEach((g,i) => { g.x += Math.sin(time*.00009+g.phase+i)*.12*dt*pace; g.y += Math.cos(time*.00007+g.phase)*.08*dt*pace;
      if (g.x<width*.05 || g.x>width*.95) g.phase+=Math.PI; if(g.y<height*.06 || g.y>height*.94) g.phase+=2.2; });
    particles.forEach((p,i) => {
      const g=groups[p.group]; p.vx+=(g.x-p.x)*.000012*dt*pace+Math.sin(time*.00035+p.phase)*.0014*dt; p.vy+=(g.y-p.y)*.000012*dt*pace+Math.cos(time*.00029+p.phase)*.0012*dt;
      if(pointer.active && !mobile.matches && !reduced.matches) { const dx=pointer.x-p.x,dy=pointer.y-p.y,d=Math.hypot(dx,dy);
        if(d<PARTICLE_CONFIG.mouseRadius && d>1) { const f=(1-d/PARTICLE_CONFIG.mouseRadius)*PARTICLE_CONFIG.mouseForce*dt; p.vx+=dx/d*f+(pointer.x-pointer.oldX)*.0025; p.vy+=dy/d*f+(pointer.y-pointer.oldY)*.0025;
          if(d<35) { pointer.colour=pointer.colour?mix(pointer.colour,p.colour):p.colour; pointer.colourLife=100; } } }
      p.vx*=Math.pow(.985,dt); p.vy*=Math.pow(.985,dt); p.x+=p.vx*dt*pace; p.y+=p.vy*dt*pace;
      if(p.x<-8)p.x=width+8; if(p.x>width+8)p.x=-8; if(p.y<-8)p.y=height+8; if(p.y>height+8)p.y=-8;
      if(!reduced.matches && i%3===0) { const o=particles[(i+17+((time/900)|0))%particles.length],dx=o.x-p.x,dy=o.y-p.y,s=Math.hypot(o.vx-p.vx,o.vy-p.vy);
        if(p.group!==o.group && dx*dx+dy*dy<PARTICLE_CONFIG.collisionDistance**2 && s>PARTICLE_CONFIG.collisionSpeed && Math.random()<PARTICLE_CONFIG.collisionProbability*dt) collide(p,o); }
    });
    clouds.forEach(c=>c.age+=dt); clouds=clouds.filter(c=>c.age<c.life);
    bursts.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vx*=Math.pow(.94,dt);p.vy*=Math.pow(.94,dt);p.age+=dt;}); bursts=bursts.filter(p=>p.age<p.life);
    pointer.colourLife=Math.max(0,pointer.colourLife-dt);
  }
  function cloud(c,time) {
    const progress=c.age/c.life, fade=Math.sin(progress*Math.PI)*.2;
    for(let i=0;i<4;i++){const wobble=c.phase+i*1.7+time*.00018,x=c.x+Math.sin(wobble)*c.radius*.24,y=c.y+Math.cos(wobble*1.17)*c.radius*.18,r=c.radius*(.65+progress*2.5+i*.16),g=ctx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0,rgba(c.colour,fade));g.addColorStop(.46,rgba(c.colour,fade*.52));g.addColorStop(1,rgba(c.colour,0));ctx.fillStyle=g;ctx.fillRect(x-r,y-r,r*2,r*2);}
  }
  function draw(time) {
    const bg=ctx.createLinearGradient(0,0,width,height); bg.addColorStop(0,'#111a3d');bg.addColorStop(.55,'#182654');bg.addColorStop(1,'#251942');ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);
    groups.forEach((g,i)=>{const r=Math.min(width,height)*(.28+(i%3)*.055),fill=ctx.createRadialGradient(g.x,g.y,0,g.x,g.y,r);fill.addColorStop(0,rgba(g.colour,.18));fill.addColorStop(.48,rgba(g.colour,.075));fill.addColorStop(1,rgba(g.colour,0));ctx.fillStyle=fill;ctx.fillRect(g.x-r,g.y-r,r*2,r*2);});
    clouds.forEach(c=>cloud(c,time));
    particles.forEach(p=>{ctx.beginPath();ctx.fillStyle=rgba(p.colour,p.alpha);ctx.arc(p.x,p.y,p.size,0,6.28);ctx.fill();});
    bursts.forEach(p=>{ctx.beginPath();ctx.fillStyle=rgba(p.colour,(1-p.age/p.life)*.55);ctx.arc(p.x,p.y,p.size,0,6.28);ctx.fill();});
    if(pointer.active&&pointer.colour&&pointer.colourLife>0&&!mobile.matches){const r=45,g=ctx.createRadialGradient(pointer.x,pointer.y,0,pointer.x,pointer.y,r);g.addColorStop(0,rgba(pointer.colour,.055*pointer.colourLife/100));g.addColorStop(1,rgba(pointer.colour,0));ctx.fillStyle=g;ctx.fillRect(pointer.x-r,pointer.y-r,r*2,r*2);}
  }
  function animate(time){if(!visible)return;const dt=Math.min(2,(time-last)/16.667||1);last=time;update(dt,time);draw(time);pointer.oldX+=(pointer.x-pointer.oldX)*.28;pointer.oldY+=(pointer.y-pointer.oldY)*.28;frame=requestAnimationFrame(animate);}
  hero.addEventListener('pointermove',e=>{if(e.pointerType==='touch')return;const r=hero.getBoundingClientRect();pointer.x=e.clientX-r.left;pointer.y=e.clientY-r.top;if(!pointer.active){pointer.oldX=pointer.x;pointer.oldY=pointer.y;}pointer.active=true;},{passive:true});
  hero.addEventListener('pointerleave',()=>{pointer.active=false;},{passive:true});
  document.addEventListener('visibilitychange',()=>{visible=!document.hidden;cancelAnimationFrame(frame);if(visible){last=performance.now();frame=requestAnimationFrame(animate);}});
  window.addEventListener('resize',resize,{passive:true});
  if(mobile.addEventListener){mobile.addEventListener('change',resize);reduced.addEventListener('change',resize);}
  resize(); frame=requestAnimationFrame(animate);
}());
