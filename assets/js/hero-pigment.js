/* Chia-He logo pigment story. Particle integration stays on the GPU while the
 * CPU supplies the fixed logo geometry, collision phase, and pointer energy. */
(function () {
  'use strict';

  const CONFIG = {
    desktopCount: 30000, mobileCount: 12000, reducedMotionCount: 3600,
    skeletonRatio: 0.50, flowRatio: 0.36, freeRatio: 0.14,
    pointSizeMin: 1.45, pointSizeMax: 7.6,
    approachDuration: 1.32, compressionDuration: 0.48, impactDuration: 0.38,
    ribbonDuration: 4.6, reformDuration: 4.6,
    collisionIntervalMin: 4.8, collisionIntervalMax: 7.4,
    collisionRadius: 0.145, desktopDprCap: 1.65, mobileDprCap: 1.25
  };
  const PALETTE = [
    [0.12, 0.72, 0.78], [0.88, 0.24, 0.56], [0.96, 0.70, 0.18],
    [0.96, 0.40, 0.17], [0.57, 0.25, 0.92]
  ];
  const LOGO_MASK_URL = 'images/chiahe-logo-symbol.png';
  window.HERO_PIGMENT_CONFIG = CONFIG;
  window.HERO_PIGMENT_PALETTE = PALETTE;

  const hero = document.getElementById('intro');
  if (!hero) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-pigment-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  hero.insertBefore(canvas, hero.firstChild);
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance' });
  if (!gl) { canvas.remove(); hero.classList.add('hero-pigment-fallback'); return; }

  const mobileQuery = matchMedia('(max-width: 736px)');
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, active: 0 };
  const collision = { age: 99, next: 2.2, active: false, energy: 0.62 };
  let width = 1, height = 1, aspect = 1, dpr = 1, count = 0, source = 0;
  let sets = [], updateProgram, renderProgram, backgroundProgram, updateU, renderU, backgroundU, emptyVao;
  let frame = 0, lastTime = performance.now(), elapsed = 0, visible = !document.hidden, logoMask;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const random = (a, b) => a + Math.random() * (b - a);

  const UPDATE_VERTEX = `#version 300 es
    precision highp float;
    layout(location=0) in vec2 aPosition; layout(location=1) in vec2 aVelocity;
    layout(location=2) in float aSeed; layout(location=3) in float aGroup;
    layout(location=4) in float aKind; layout(location=5) in vec2 aHome;
    uniform float uTime,uDelta,uAspect,uPhase,uEnergy; uniform vec2 uCore;
    uniform vec4 uMouse; uniform vec2 uMouseVelocity;
    out vec2 vPosition; out vec2 vVelocity;

    vec2 metric(vec2 v){ return vec2(v.x*uAspect,v.y); }
    vec2 curl(vec2 p,float s){
      float a=sin(p.x*17.0+p.y*11.0+uTime*.42+s*6.0);
      float b=cos(p.x*9.0-p.y*19.0-uTime*.31+s*4.0);
      return vec2(a+b*.4,-b+a*.35);
    }
    void main(){
      vec2 p=aPosition, v=aVelocity, toHome=aHome-p;
      float phase=uPhase, homeDistance=length(metric(toHome));
      bool skeleton=aKind<.5, internal=aKind>.5&&aKind<1.5;
      float reform=phase>3.0 ? smoothstep(3.0,4.0,phase) : 0.0;

      // Half of all particles remain a legible, breathing outline.
      if(skeleton){
        float breath=.93+.07*sin(uTime*1.15+aSeed*9.0);
        v += toHome*(3.7+reform*2.8)*uDelta;
        v += curl(p*2.0,aSeed)*(.026+.012*breath)*uDelta;
        v *= pow(.91,uDelta*60.0);
      } else if(internal){
        v += toHome*(1.12+reform*1.8)*uDelta;
        vec2 orbit=metric(p-uCore); vec2 tangent=normalize(vec2(-orbit.y,orbit.x)+vec2(.001)); tangent.x/=uAspect;
        if(aGroup>1.5)tangent=normalize(vec2(1.0,.12*sin(aSeed*19.0+uTime)));
        v += tangent*(.19+.09*sin(aSeed*31.0+uTime*1.3))*uDelta;
        v += curl(p*2.8,aSeed)*.085*uDelta;
      } else {
        v += toHome*(.20+reform*.75)*uDelta;
        v += curl(p*2.1,aSeed)*.105*uDelta;
      }

      bool stream=aGroup<1.5;
      if(stream&&phase>0.0){
        vec2 dc=metric(uCore-p); float dist=length(dc); vec2 toward=dist>.001?dc/dist:vec2(1,0);
        toward.x/=uAspect;
        float local=smoothstep(.42,0.0,dist);
        if(phase<1.0){ // approach: both continuous colour bands visibly converge
          v += toward*(.68+phase*1.05)*uEnergy*local*uDelta;
        } else if(phase<2.0){ // narrow, slow, dense compression at the brand core
          v += toward*3.65*uEnergy*local*uDelta;
          v *= 1.0-local*(.17+.16*uEnergy);
        } else if(phase<3.0){ // arrow-led release, tangential shear, small shock
          vec2 normal=normalize(metric(p-uCore)+vec2(.0001)); normal.x/=uAspect;
          float impact=1.0-(phase-2.0);
          float mixed=step(fract(aSeed*37.17),mix(.27,.44,uEnergy));
          v += vec2(2.85+1.25*uEnergy,(aSeed-.5)*.72)*local*impact*mixed*uDelta;
          v += vec2(-normal.y,normal.x)*sin(aSeed*49.0)*1.65*local*impact*uDelta;
          v += normal*.52*local*impact*uDelta;
        } else { // long mixed ribbon keeps travelling along the arrow
          float mixed=step(fract(aSeed*37.17),mix(.27,.44,uEnergy));
          float ribbonLife=1.0-smoothstep(3.0,4.0,phase);
          v += vec2(.46, sin(aSeed*41.0)*.04)*mixed*ribbonLife*uDelta;
        }
      }

      // Pointer attracts and stirs; near the logo it guides pigment into core.
      if(uMouse.z>.5){
        vec2 dm=metric(uMouse.xy-p); float md=length(dm); vec2 towardMouse=md>.001?dm/md:vec2(0); towardMouse.x/=uAspect;
        float reach=smoothstep(uMouse.w,0.0,md);
        vec2 mouseTangent=vec2(-towardMouse.y,towardMouse.x);
        float mouseSpeed=min(length(metric(uMouseVelocity))*12.0,1.0);
        v += towardMouse*reach*(.52+.34*mouseSpeed)*uDelta;
        v += mouseTangent*reach*(.30+.58*mouseSpeed)*sin(aSeed*17.0)*uDelta;
        vec2 dc=metric(uCore-p); float cd=length(dc); vec2 towardCore=cd>.001?dc/cd:vec2(0); towardCore.x/=uAspect;
        float logoMouse=smoothstep(.34,0.0,length(metric(uMouse.xy-uCore)));
        v += towardCore*reach*logoMouse*.78*uDelta;
        v += uMouseVelocity*reach*(.66+mouseSpeed)*uDelta;
      }
      v*=pow(skeleton?.986:.991,uDelta*60.0); v=clamp(v,vec2(-1.7),vec2(1.7)); p+=v*uDelta;
      if(p.x<-.08||p.x>1.13||p.y<-.1||p.y>1.1){ p=mix(p,aHome,.065); v*=.65; }
      vPosition=p; vVelocity=v;
    }`;
  const PASS_FRAGMENT = `#version 300 es
    precision mediump float; void main() {}`;
  const RENDER_VERTEX = `#version 300 es
    precision highp float;
    layout(location=0) in vec2 aPosition; layout(location=1) in vec2 aVelocity;
    layout(location=2) in float aSeed; layout(location=3) in float aGroup;
    layout(location=4) in float aKind; layout(location=5) in vec2 aHome;
    uniform float uAspect,uDpr,uPointMin,uPointMax,uPhase,uEnergy; uniform vec2 uCore; uniform vec3 uPalette[5];
    out vec4 vColour;
    void main(){
      gl_Position=vec4(aPosition.x*2.0-1.0,1.0-aPosition.y*2.0,0,1);
      float distribution=fract(aSeed*17.731), depth=fract(aSeed*53.73), kindSize=aKind<.5?.88:(aKind<1.5?1.08:.74);
      float size=mix(uPointMin,uPointMax,pow(distribution,2.1))*kindSize;
      float d=length(vec2((aPosition.x-uCore.x)*uAspect,aPosition.y-uCore.y));
      float impact=(uPhase>=2.0&&uPhase<3.0)?1.0-(uPhase-2.0):0.0;
      size*=mix(.70,1.24,depth)*(1.0+smoothstep(.19,0.0,d)*impact*mix(.48,1.0,uEnergy));
      int group=int(aGroup+.5); vec3 colour=uPalette[group];
      bool participant=aGroup<1.5; float mixed=step(fract(aSeed*37.17),mix(.27,.44,uEnergy));
      float ribbon=uPhase>1.72 ? smoothstep(.28,0.0,abs(aPosition.y-uCore.y))*step(uCore.x-.04,aPosition.x) : 0.0;
      float newColour=(participant?mixed:0.0)*max(smoothstep(.23,0.0,d),ribbon)*smoothstep(1.72,2.2,uPhase);
      colour=mix(colour,uPalette[4],newColour);
      if(aKind<.5) colour=mix(colour,vec3(.67,.57,.72),.28);
      float alpha=aKind<.5?mix(.58,.88,distribution):mix(.34,.78,distribution);
      alpha*=mix(.55,1.0,depth); alpha+=newColour*.24+impact*smoothstep(.2,0.0,d)*.14;
      gl_PointSize=size*uDpr*(1.0+newColour*.28); vColour=vec4(colour,alpha);
    }`;
  const RENDER_FRAGMENT = `#version 300 es
    precision mediump float; in vec4 vColour; out vec4 outColour;
    void main(){ vec2 q=gl_PointCoord*2.0-1.0; float r=dot(q,q); if(r>1.0)discard; float halo=smoothstep(1.0,.02,r); float core=smoothstep(.26,0.0,r); outColour=vec4(vColour.rgb*(1.0+core*.20),vColour.a*(halo*.66+core*.34)); }`;
  const BACKGROUND_VERTEX = `#version 300 es
    precision highp float; out vec2 vUv; void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p;gl_Position=vec4(p*2.0-1.0,0,1);}`;
  const BACKGROUND_FRAGMENT = `#version 300 es
    precision highp float; in vec2 vUv; uniform float uTime,uAspect,uPhase,uEnergy; uniform vec2 uCore; uniform vec3 uPalette[5]; out vec4 outColour;
    void main(){
      vec3 c=mix(vec3(.055,.085,.205),vec3(.14,.075,.24),vUv.x*.62+vUv.y*.18);
      vec2 q=vec2((vUv.x-uCore.x)*uAspect,vUv.y-uCore.y);
      float breathing=.5+.5*sin(uTime*.34);
      float cloudA=smoothstep(.48,.025,length(q+vec2(.055*sin(uTime*.12),-.045*cos(uTime*.16))));
      float cloudB=smoothstep(.34,.015,length(q*vec2(.72,1.18)-vec2(.09,-.08)));
      float filaments=.5+.5*sin(q.x*19.0-q.y*14.0+uTime*.28);
      float logoFog=cloudA*(.075+.025*breathing)+cloudB*.045+cloudA*filaments*.025;
      c=mix(c,mix(uPalette[0],uPalette[1],smoothstep(-.24,.24,q.y)),logoFog);
      float warmHaze=smoothstep(.31,.0,length(q-vec2(-.10,.13)))*(.025+.018*sin(uTime*.23+1.2));
      c=mix(c,uPalette[2],warmHaze);
      // Fog follows particle impact by about 160 ms (the latter half of phase 2).
      float delayed=smoothstep(2.50,2.82,uPhase)*(1.0-smoothstep(3.55,4.0,uPhase));
      vec2 trail=q-vec2(max(q.x,0.0)*.34,0); float fog=smoothstep(.34,.0,length(trail))*delayed*(.25+.18*uEnergy);
      float coreGlow=smoothstep(.16,.0,length(q))*smoothstep(1.45,2.15,uPhase)*(1.0-smoothstep(3.2,3.8,uPhase));
      c=mix(c,uPalette[4],fog); c+=uPalette[4]*coreGlow*(.08+.11*uEnergy); outColour=vec4(c,1);
    }`;

  function shader(type, source) { const s=gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function program(v,f,varyings){ const p=gl.createProgram(); gl.attachShader(p,shader(gl.VERTEX_SHADER,v)); gl.attachShader(p,shader(gl.FRAGMENT_SHADER,f)); if(varyings)gl.transformFeedbackVaryings(p,varyings,gl.SEPARATE_ATTRIBS); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)); return p; }
  function locations(p,names){ return names.reduce((o,n)=>(o[n]=gl.getUniformLocation(p,n),o),{}); }
  function buffer(data,usage=gl.STATIC_DRAW){ const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,usage);return b; }
  function initPrograms(){
    updateProgram=program(UPDATE_VERTEX,PASS_FRAGMENT,['vPosition','vVelocity']); renderProgram=program(RENDER_VERTEX,RENDER_FRAGMENT); backgroundProgram=program(BACKGROUND_VERTEX,BACKGROUND_FRAGMENT);
    updateU=locations(updateProgram,['uTime','uDelta','uAspect','uPhase','uEnergy','uCore','uMouse','uMouseVelocity']);
    renderU=locations(renderProgram,['uAspect','uDpr','uPointMin','uPointMax','uPhase','uEnergy','uCore','uPalette[0]']);
    backgroundU=locations(backgroundProgram,['uTime','uAspect','uPhase','uEnergy','uCore','uPalette[0]']); emptyVao=gl.createVertexArray();
  }
  function loadLogoMask(){
    return new Promise((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>{
        const size=420, surface=document.createElement('canvas'); surface.width=size; surface.height=size;
        const context=surface.getContext('2d',{willReadFrequently:true});
        const scale=Math.min(size/image.naturalWidth,size/image.naturalHeight), drawWidth=image.naturalWidth*scale, drawHeight=image.naturalHeight*scale;
        context.clearRect(0,0,size,size); context.drawImage(image,(size-drawWidth)/2,(size-drawHeight)/2,drawWidth,drawHeight);
        const pixels=context.getImageData(0,0,size,size).data, inside=[], edge=[];
        const opaque=(x,y)=>x>=0&&x<size&&y>=0&&y<size&&pixels[(y*size+x)*4+3]>48;
        for(let y=1;y<size-1;y+=2)for(let x=1;x<size-1;x+=2){
          if(!opaque(x,y))continue;
          const point=[x/size,y/size]; inside.push(point);
          if(!opaque(x-2,y)||!opaque(x+2,y)||!opaque(x,y-2)||!opaque(x,y+2))edge.push(point);
        }
        if(edge.length<40||inside.length<100)reject(new Error('Logo mask has insufficient opaque pixels'));
        else resolve({inside,edge});
      };
      image.onerror=()=>reject(new Error(`Unable to load Hero logo mask: ${LOGO_MASK_URL}`));
      image.src=LOGO_MASK_URL;
    });
  }
  function logoGeometry(kind){
    const collection=kind===0?logoMask.edge:logoMask.inside;
    const sample=collection[Math.floor(Math.random()*collection.length)];
    // Keep the PNG's own proportions; aspect correction only maps it into screen space.
    const centerX=mobileQuery.matches?.57:.69, logoHeight=.61, logoWidth=.61/aspect;
    return [centerX+(sample[0]-.5)*logoWidth,.5+(sample[1]-.5)*logoHeight];
  }
  function makeState(n){
    const positions=new Float32Array(n*2), velocities=new Float32Array(n*2), seeds=new Float32Array(n), groups=new Float32Array(n), kinds=new Float32Array(n), homes=new Float32Array(n*2);
    const skeletonEnd=Math.floor(n*CONFIG.skeletonRatio), flowEnd=Math.floor(n*(CONFIG.skeletonRatio+CONFIG.flowRatio));
    for(let i=0;i<n;i++){
      const seed=Math.random(); let kind=i<skeletonEnd?0:(i<flowEnd?1:2), group=2, home;
      if(kind===0){ home=logoGeometry(0); group=home[1]<.485?0:(home[1]>.515?1:2); }
      else if(kind===1){ group=i%10<4?0:(i%10<8?1:2); home=logoGeometry(1); }
      else { group=i%5; home=logoGeometry(i%4===0?0:1); home[0]+=random(-.12,.12)/aspect; home[1]+=random(-.11,.11); }
      const spread=kind===0?.006:(kind===1?.025:.075); positions[i*2]=home[0]+random(-spread,spread)/aspect; positions[i*2+1]=home[1]+random(-spread,spread);
      velocities[i*2]=random(-.01,.01); velocities[i*2+1]=random(-.01,.01); homes[i*2]=home[0]; homes[i*2+1]=home[1]; seeds[i]=seed; groups[i]=group; kinds[i]=kind;
    } return {positions,velocities,seeds,groups,kinds,homes};
  }
  function particleSet(pos,vel,shared){
    const set={position:buffer(pos,gl.DYNAMIC_COPY),velocity:buffer(vel,gl.DYNAMIC_COPY)}, vao=gl.createVertexArray(); set.vao=vao; gl.bindVertexArray(vao);
    [[0,set.position,2],[1,set.velocity,2],[2,shared.seed,1],[3,shared.group,1],[4,shared.kind,1],[5,shared.home,2]].forEach(a=>{gl.bindBuffer(gl.ARRAY_BUFFER,a[1]);gl.enableVertexAttribArray(a[0]);gl.vertexAttribPointer(a[0],a[2],gl.FLOAT,false,0,0);}); return set;
  }
  function initParticles(){
    sets.forEach(s=>{gl.deleteBuffer(s.position);gl.deleteBuffer(s.velocity);gl.deleteVertexArray(s.vao);}); sets=[];
    count=reducedQuery.matches?CONFIG.reducedMotionCount:(mobileQuery.matches?CONFIG.mobileCount:CONFIG.desktopCount); const state=makeState(count);
    const shared={seed:buffer(state.seeds),group:buffer(state.groups),kind:buffer(state.kinds),home:buffer(state.homes)};
    sets=[particleSet(state.positions,state.velocities,shared),particleSet(state.positions,state.velocities,shared)]; source=0;
  }
  function core(){ return [mobileQuery.matches?.57:.69,.50]; }
  function setCommon(u,phase){ const c=core(); gl.uniform1f(u.uAspect,aspect); gl.uniform1f(u.uPhase,phase); gl.uniform1f(u.uEnergy,collision.energy); gl.uniform2f(u.uCore,c[0],c[1]); }
  function trigger(energy){ collision.active=true; collision.age=0; collision.energy=clamp(energy,.55,1); }
  function collisionPhase(dt){
    collision.next-=dt; if(!collision.active&&collision.next<=0&&!reducedQuery.matches)trigger(.55+Math.random()*.15);
    if(!collision.active){ collision.energy+=(0.62-collision.energy)*dt; return 0; } collision.age+=dt;
    const a=CONFIG.approachDuration,b=a+CONFIG.compressionDuration,c=b+CONFIG.impactDuration,d=c+CONFIG.ribbonDuration;
    if(collision.age<a)return collision.age/a; if(collision.age<b)return 1+(collision.age-a)/CONFIG.compressionDuration; if(collision.age<c)return 2+(collision.age-b)/CONFIG.impactDuration;
    if(collision.age<d)return 3+(collision.age-c)/CONFIG.ribbonDuration;
    collision.active=false;collision.next=random(CONFIG.collisionIntervalMin,CONFIG.collisionIntervalMax);return 0;
  }
  function update(dt,phase){
    const a=sets[source],b=sets[1-source]; gl.useProgram(updateProgram);gl.bindVertexArray(a.vao);setCommon(updateU,phase);
    gl.uniform1f(updateU.uTime,elapsed);gl.uniform1f(updateU.uDelta,dt);gl.uniform4f(updateU.uMouse,pointer.x,pointer.y,pointer.active,.265);gl.uniform2f(updateU.uMouseVelocity,pointer.vx,pointer.vy);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,b.position);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,1,b.velocity);gl.enable(gl.RASTERIZER_DISCARD);gl.beginTransformFeedback(gl.POINTS);gl.drawArrays(gl.POINTS,0,count);gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,1,null);source=1-source;
  }
  function draw(phase){
    gl.disable(gl.BLEND);gl.useProgram(backgroundProgram);gl.bindVertexArray(emptyVao);setCommon(backgroundU,phase);gl.uniform1f(backgroundU.uTime,elapsed);gl.uniform3fv(backgroundU['uPalette[0]'],new Float32Array(PALETTE.flat()));gl.drawArrays(gl.TRIANGLES,0,3);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.useProgram(renderProgram);gl.bindVertexArray(sets[source].vao);setCommon(renderU,phase);gl.uniform1f(renderU.uDpr,dpr);gl.uniform1f(renderU.uPointMin,CONFIG.pointSizeMin);gl.uniform1f(renderU.uPointMax,CONFIG.pointSizeMax);gl.uniform3fv(renderU['uPalette[0]'],new Float32Array(PALETTE.flat()));gl.drawArrays(gl.POINTS,0,count);
  }
  function resize(){ if(!logoMask)return;const r=hero.getBoundingClientRect();width=Math.max(1,r.width);height=Math.max(1,r.height);aspect=width/height;dpr=Math.min(devicePixelRatio||1,mobileQuery.matches?CONFIG.mobileDprCap:CONFIG.desktopDprCap);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.width=width+'px';canvas.style.height=height+'px';gl.viewport(0,0,canvas.width,canvas.height);initParticles(); }
  function animate(now){ if(!visible)return;const raw=Math.min(.033,(now-lastTime)/1000||.0167),dt=reducedQuery.matches?raw*.12:raw;lastTime=now;elapsed+=dt;const phase=collisionPhase(raw);update(dt,phase);draw(phase);pointer.vx*=.76;pointer.vy*=.76;frame=requestAnimationFrame(animate); }
  function pointerPosition(e){const r=hero.getBoundingClientRect();return[(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height];}
  hero.addEventListener('pointerenter',e=>{if(e.pointerType==='touch')return;const p=pointerPosition(e);pointer.x=pointer.px=p[0];pointer.y=pointer.py=p[1];pointer.active=1;},{passive:true});
  hero.addEventListener('pointermove',e=>{if(e.pointerType==='touch')return;const p=pointerPosition(e),dx=p[0]-pointer.px,dy=p[1]-pointer.py,speed=Math.hypot(dx*aspect,dy),c=core();pointer.vx=clamp(dx,-.1,.1);pointer.vy=clamp(dy,-.1,.1);pointer.x=pointer.px=p[0];pointer.y=pointer.py=p[1];pointer.active=1;const near=Math.hypot((p[0]-c[0])*aspect,p[1]-c[1]);if(near<.31)collision.energy=Math.max(collision.energy,.75);if(near<CONFIG.collisionRadius&&speed>.022)trigger(1);},{passive:true});
  hero.addEventListener('pointerleave',()=>{pointer.active=0;},{passive:true});
  document.addEventListener('visibilitychange',()=>{visible=!document.hidden;cancelAnimationFrame(frame);if(visible){lastTime=performance.now();frame=requestAnimationFrame(animate);}});
  addEventListener('resize',resize,{passive:true});if(mobileQuery.addEventListener){mobileQuery.addEventListener('change',resize);reducedQuery.addEventListener('change',resize);}
  loadLogoMask().then(mask=>{
    logoMask=mask;
    try{initPrograms();resize();frame=requestAnimationFrame(animate);}catch(error){canvas.remove();hero.classList.add('hero-pigment-fallback');console.error('Hero pigment animation unavailable',error);}
  }).catch(error=>{canvas.remove();hero.classList.add('hero-pigment-fallback');console.error('Hero pigment animation unavailable',error);});
}());
