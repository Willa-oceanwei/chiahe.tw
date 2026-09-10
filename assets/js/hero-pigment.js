/* GPU pigment field for the home-page hero. WebGL2 transform feedback keeps all
 * per-particle integration on the GPU; the CPU only updates interaction fields. */
(function () {
  'use strict';

  const PIGMENT_CONFIG = {
    desktopCount: 24000,
    mobileCount: 9000,
    reducedMotionCount: 2500,
    clusterCount: 5,
    pointSizeMin: 1.4,
    pointSizeMax: 6.0,
    flowScale: 3.2,
    flowStrength: 0.34,
    clusterStrength: 0.18,
    damping: 0.986,
    mouseInnerRadius: 0.105,
    mouseOuterRadius: 0.29,
    mouseRadialForce: 1.35,
    mouseSwirlForce: 0.72,
    mouseWakeForce: 0.95,
    collisionIntervalMin: 4.8,
    collisionIntervalMax: 7.5,
    approachDuration: 1.55,
    compressionDuration: 0.72,
    impactDuration: 0.48,
    wakeDuration: 3.1,
    collisionRadius: 0.22,
    collisionImpulse: 2.15,
    resonanceDuration: 2.15,
    resonanceMaxRadius: 0.58,
    logoParticleRatio: 0.50,
    logoAttractionStrength: 0.045,
    desktopDprCap: 1.65,
    mobileDprCap: 1.25
  };

  const PALETTE = [
    [0.153, 0.694, 0.733], // cyan pigment
    [0.792, 0.298, 0.537], // magenta pigment
    [0.894, 0.722, 0.263], // yellow pigment
    [0.878, 0.439, 0.286], // orange pigment
    [0.455, 0.361, 0.643]  // violet pigment
  ];
  // The first recognizable Logo build loaded the root-level transparent PNG.
  // Prefer the current asset path, but retain that proven path for deployments
  // where GitHub Pages still publishes the original filename.
  const LOGO_MASK_URLS = ['images/chiahe-logo-symbol.png','chiahe_logo_transparent.png'];

  window.HERO_PIGMENT_CONFIG = PIGMENT_CONFIG;
  window.HERO_PIGMENT_PALETTE = PALETTE;
  const SANITY_MODE = new URLSearchParams(window.location.search).get('debugPigment')==='sanity';

  const hero = document.getElementById('intro');
  if (!hero) return;

  const rendererDebug = new URLSearchParams(window.location.search).get('debugPigment')==='renderer';
  function reportRenderer(name, detail) {
    window.HERO_PIGMENT_RENDERER = { name, detail: detail ? String(detail.message||detail) : '' };
    hero.dataset.pigmentRenderer = name;
    console.info(`Hero pigment renderer: ${name}`,detail||'');
    if (rendererDebug) {
      const badge = document.createElement('div');
      badge.textContent = name==='webgl2' ? 'HERO WEBGL2 ACTIVE' : `HERO 2D FALLBACK: ${window.HERO_PIGMENT_RENDERER.detail}`;
      badge.style.cssText = 'position:absolute;right:12px;bottom:12px;z-index:4;max-width:70%;padding:6px 9px;background:#111827;color:#fff;font:600 11px/1.3 monospace;border:1px solid rgba(255,255,255,.45);border-radius:3px;pointer-events:none';
      hero.appendChild(badge);
    }
  }

  if (SANITY_MODE) {
    const badge = document.createElement('div');
    badge.textContent = 'HERO SANITY ACTIVE';
    badge.setAttribute('aria-live','polite');
    badge.style.cssText = 'position:absolute;right:12px;bottom:12px;z-index:3;padding:6px 9px;background:#111827;color:#fff;font:600 11px/1.2 monospace;letter-spacing:.08em;border:1px solid rgba(255,255,255,.45);border-radius:3px;pointer-events:none';
    hero.appendChild(badge);
  }

  function startMovingFallback(failedCanvas, reason) {
    console.error('Hero WebGL pipeline unavailable; starting 2D movement fallback.',reason);
    reportRenderer('2d-fallback',reason);
    const fallbackCanvas = document.createElement('canvas');
    fallbackCanvas.className = 'hero-pigment-canvas';
    fallbackCanvas.setAttribute('aria-hidden','true');
    failedCanvas.replaceWith(fallbackCanvas);
    const context = fallbackCanvas.getContext('2d');
    if (!context) return;
    const particles = Array.from({length: 900},(_,index)=>({
      x: Math.random(), y: Math.random(),
      vx: 0.018+Math.random()*0.026, vy: (Math.random()-.5)*0.018,
      radius: 0.7+Math.random()*1.45, colour: PALETTE[index%PALETTE.length]
    }));
    let fallbackTime = performance.now();
    function resizeFallback() {
      const rect = hero.getBoundingClientRect();
      const ratio = Math.min(devicePixelRatio||1,1.5);
      fallbackCanvas.width = Math.max(1,Math.round(rect.width*ratio));
      fallbackCanvas.height = Math.max(1,Math.round(rect.height*ratio));
      fallbackCanvas.style.width = `${rect.width}px`;
      fallbackCanvas.style.height = `${rect.height}px`;
      context.setTransform(ratio,0,0,ratio,0,0);
    }
    function moveFallback(time) {
      const delta = Math.min(0.033,(time-fallbackTime)/1000||0.0167);
      fallbackTime = time;
      const rect = hero.getBoundingClientRect();
      context.fillStyle = '#111a3d';
      context.fillRect(0,0,rect.width,rect.height);
      particles.forEach((particle,index)=>{
        particle.x += particle.vx*delta;
        particle.y += (particle.vy+Math.sin(time*.00035+index)*.006)*delta;
        if (particle.x>1.03) particle.x=-.03;
        if (particle.y>1.03) particle.y=-.03;
        if (particle.y<-.03) particle.y=1.03;
        const colour = particle.colour.map(value=>Math.round(value*255));
        context.fillStyle = `rgba(${colour[0]},${colour[1]},${colour[2]},.56)`;
        context.beginPath();
        context.arc(particle.x*rect.width,particle.y*rect.height,particle.radius,0,Math.PI*2);
        context.fill();
      });
      requestAnimationFrame(moveFallback);
    }
    resizeFallback();
    window.addEventListener('resize',resizeFallback,{passive:true});
    requestAnimationFrame(moveFallback);
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'hero-pigment-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  hero.insertBefore(canvas, hero.firstChild);

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false
  });
  if (!gl) {
    hero.classList.add('hero-pigment-fallback');
    startMovingFallback(canvas,new Error('WebGL2 context creation failed'));
    return;
  }

  const mobileQuery = window.matchMedia('(max-width: 736px)');
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = {
    x: 0, y: 0, previousX: 0, previousY: 0,
    vx: 0, vy: 0, active: 0
  };
  const resonance = { x: 0, y: 0, age: 99 };
  const fieldCollision = {
    first: 0, second: 1, age: 99, next: 2.4, active: false
  };

  let width = 1;
  let height = 1;
  let aspect = 1;
  let dpr = 1;
  let particleCount = 0;
  let sourceIndex = 0;
  let particleSets = [];
  let updateProgram;
  let renderProgram;
  let backgroundProgram;
  let updateUniforms;
  let renderUniforms;
  let backgroundUniforms;
  let emptyVao;
  let animationFrame = 0;
  let lastTime = performance.now();
  let elapsed = 0;
  let visible = !document.hidden;
  let logoTexture;
  let logoPoints = [];
  let collisionEnergy = 0.55;

  const random = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const UPDATE_VERTEX = `#version 300 es
    precision highp float;
    layout(location=0) in vec2 aPosition;
    layout(location=1) in vec2 aVelocity;
    layout(location=2) in float aSeed;
    layout(location=3) in float aGroup;

    uniform float uTime;
    uniform float uDelta;
    uniform float uAspect;
    uniform float uFlowStrength;
    uniform float uClusterStrength;
    uniform float uDamping;
    uniform vec2 uCenters[5];
    uniform vec4 uMouse;
    uniform vec2 uMouseVelocity;
    uniform vec4 uCollision;
    uniform vec2 uCollisionGroups;
    uniform float uCollisionEnergy;
    uniform vec4 uWave;
    uniform float uSanityMode;
    uniform sampler2D uLogoMask;
    uniform vec3 uLogoField;

    out vec2 vPosition;
    out vec2 vVelocity;

    vec2 curlField(vec2 p, float seed) {
      // Analytic derivatives of three travelling wave potentials form a
      // divergence-light curl field without CPU noise sampling.
      vec2 q = vec2(p.x * uAspect, p.y);
      float t = uTime * 0.12;
      float dX = 2.7*cos(dot(q,vec2(2.7,1.9))+t+seed*4.0)
               - 2.1*sin(dot(q,vec2(-2.1,3.1))-t*0.73+seed);
      float dY = 1.9*cos(dot(q,vec2(2.7,1.9))+t+seed*4.0)
               + 3.1*sin(dot(q,vec2(-2.1,3.1))-t*0.73+seed);
      dX += 1.35*cos(dot(q,vec2(1.35,-3.7))+t*0.51-seed*2.0);
      dY -= 3.7*cos(dot(q,vec2(1.35,-3.7))+t*0.51-seed*2.0);
      return vec2(dY, -dX) * 0.12;
    }

    void main() {
      vec2 position = aPosition;
      vec2 velocity = aVelocity;

      if (uSanityMode > 0.5) {
        velocity = vec2(0.12,0.0);
        position += velocity*uDelta;
        if (position.x>1.12) position.x=-0.12;
        vPosition = position;
        vVelocity = velocity;
        return;
      }

      int groupIndex = int(aGroup + 0.5);
      vec2 center = uCenters[groupIndex];

      // A bent ribbon target, rather than a circular point attractor, lets
      // each colour field stretch, fork and fold continuously.
      float strand = sin(position.y*7.0 + uTime*0.18 + aSeed*6.283);
      vec2 tangent = normalize(vec2(
        cos(uTime*0.09 + float(groupIndex)*1.4),
        sin(uTime*0.11 + float(groupIndex)*1.7)
      ));
      vec2 ribbonTarget = center + tangent * strand * (0.14 + 0.055*sin(aSeed*19.0));
      vec2 toRibbon = ribbonTarget - position;
      float ribbonDistance = length(toRibbon);
      velocity += toRibbon * uClusterStrength * (0.35 + smoothstep(0.05,0.7,ribbonDistance)) * uDelta;
      velocity += curlField(position*3.2 + center, aSeed) * uFlowStrength * uDelta;

      // The mask is a weak density field, never a fixed home position. Half
      // the particles can drift through it; only its edge and far field steer.
      if (fract(aSeed*7.137)<0.50) {
        vec2 logoUv=vec2((position.x-uLogoField.x)*uAspect/uLogoField.y+0.5,(position.y-0.5)/uLogoField.y+0.5);
        float mask=texture(uLogoMask,logoUv).a;
        vec2 texel=vec2(1.0/420.0);
        vec2 gradient=vec2(
          texture(uLogoMask,logoUv+vec2(texel.x,0.0)).a-texture(uLogoMask,logoUv-vec2(texel.x,0.0)).a,
          texture(uLogoMask,logoUv+vec2(0.0,texel.y)).a-texture(uLogoMask,logoUv-vec2(0.0,texel.y)).a
        );
        gradient.x/=uAspect;
        float farField=smoothstep(0.32,0.72,length(vec2((position.x-uLogoField.x)*uAspect,position.y-0.5)));
        velocity+=(gradient*(1.0-mask)*2.4+vec2((uLogoField.x-position.x)/uAspect,0.5-position.y)*farField)*uLogoField.z*uDelta;
      }

      // Mouse is one continuous radial + tangential + dragged wake field.
      if (uMouse.z > 0.5) {
        vec2 mouseDelta = position - uMouse.xy;
        mouseDelta.x *= uAspect;
        float mouseDistance = length(mouseDelta);
        float outer = smoothstep(uMouse.w, 0.0, mouseDistance);
        float inner = smoothstep(uMouse.w*0.38, 0.0, mouseDistance);
        vec2 direction = mouseDistance > 0.0001 ? mouseDelta/mouseDistance : vec2(1.0,0.0);
        vec2 tangentForce = vec2(-direction.y,direction.x);
        float speed = min(length(uMouseVelocity)*8.0,2.2);
        velocity -= direction * (outer*0.48 + inner*0.30) * uDelta;
        velocity += tangentForce * outer * (0.72 + speed*0.62) * uDelta;
        velocity += uMouseVelocity * outer * (1.20 + speed*1.15) * uDelta;
      }

      // Expanding click ring applies force only near the moving wave front.
      if (uWave.z < uWave.w) {
        vec2 waveDelta = position-uWave.xy;
        waveDelta.x *= uAspect;
        float waveDistance = length(waveDelta);
        float waveProgress = uWave.z/uWave.w;
        float waveRadius = waveProgress*0.58;
        float ring = exp(-pow((waveDistance-waveRadius)/0.035,2.0));
        vec2 waveDirection = waveDistance > 0.0001 ? waveDelta/waveDistance : vec2(1.0,0.0);
        velocity += waveDirection*ring*(1.25-waveProgress*0.45)*uDelta;
        velocity += vec2(-waveDirection.y,waveDirection.x)*ring*0.18*uDelta;
      }

      // The CPU selects two fields and a phase; this shader deforms every
      // affected particle coherently: anticipation, compression, impact, wake.
      bool selected = abs(aGroup-uCollisionGroups.x)<0.25 || abs(aGroup-uCollisionGroups.y)<0.25;
      if (selected && uCollision.z > 0.0) {
        vec2 contactDelta = position-uCollision.xy;
        contactDelta.x *= uAspect;
        float contactDistance = length(contactDelta);
        vec2 normal = contactDistance > 0.0001 ? contactDelta/contactDistance : vec2(1.0,0.0);
        vec2 tangentCollision = vec2(-normal.y,normal.x);
        float influence = smoothstep(0.44,0.0,contactDistance);
        float phase = uCollision.z;
        if (phase < 1.0) {
          velocity -= normal*influence*(0.4+phase*0.95)*uDelta;
          velocity += tangentCollision*influence*phase*0.22*uDelta;
        } else if (phase < 2.0) {
          velocity -= normal*influence*(1.42+uCollisionEnergy*0.9)*uDelta;
          velocity *= 1.0-influence*(0.08+uCollisionEnergy*0.08);
          velocity += tangentCollision*influence*sin(aSeed*31.0)*0.38*uDelta;
        } else if (phase < 3.0) {
          velocity += vec2(1.0/uAspect,0.0)*influence*(1.5+uCollisionEnergy)*uDelta;
          velocity += tangentCollision*influence*sin(aSeed*47.0)*(1.15+uCollisionEnergy*0.7)*uDelta;
        } else {
          float wake = (1.0-(phase-3.0))*influence;
          velocity += tangentCollision*wake*(0.9+0.5*sin(aSeed*23.0))*uDelta;
          velocity += curlField(position*5.0,aSeed+uTime)*wake*0.65*uDelta;
        }
      }

      velocity *= pow(uDamping,uDelta*60.0);
      velocity = clamp(velocity,vec2(-1.8),vec2(1.8));
      position += velocity*uDelta;
      if (position.x < -0.12) position.x = 1.12;
      if (position.x > 1.12) position.x = -0.12;
      if (position.y < -0.12) position.y = 1.12;
      if (position.y > 1.12) position.y = -0.12;
      vPosition = position;
      vVelocity = velocity;
    }`;

  const PASSTHROUGH_FRAGMENT = `#version 300 es
    precision mediump float;
    void main() { }
  `;

  const RENDER_VERTEX = `#version 300 es
    precision highp float;
    layout(location=0) in vec2 aPosition;
    layout(location=1) in vec2 aVelocity;
    layout(location=2) in float aSeed;
    layout(location=3) in float aGroup;
    uniform float uAspect;
    uniform float uDpr;
    uniform float uPointMin;
    uniform float uPointMax;
    uniform vec3 uPalette[5];
    uniform vec4 uCollision;
    uniform vec2 uCollisionGroups;
    uniform float uCollisionEnergy;
    out vec4 vColour;

    void main() {
      vec2 clip = vec2(aPosition.x*2.0-1.0,1.0-aPosition.y*2.0);
      gl_Position = vec4(clip,0.0,1.0);
      float depth = fract(aSeed*17.731);
      vec2 coreDelta=aPosition-uCollision.xy;
      coreDelta.x*=uAspect;
      float coreInfluence=smoothstep(0.19,0.0,length(coreDelta));
      float impactPulse=uCollision.z>=2.0&&uCollision.z<3.0 ? 1.0-(uCollision.z-2.0) : 0.0;
      gl_PointSize = mix(uPointMin,uPointMax,pow(depth,2.6))*uDpr*(1.0+coreInfluence*impactPulse*(0.3+uCollisionEnergy*0.45));
      int groupIndex = int(aGroup+0.5);
      vec3 colour = uPalette[groupIndex];
      float alpha = mix(0.16,0.57,depth);

      // Multiple perceptual interpolation positions create a colour ribbon,
      // rather than replacing both colliding fields with one flat mixed hue.
      bool selected = abs(aGroup-uCollisionGroups.x)<0.25 || abs(aGroup-uCollisionGroups.y)<0.25;
      if (selected && uCollision.z>0.85) {
        vec2 delta = aPosition-uCollision.xy;
        delta.x *= uAspect;
        float distanceToContact = length(delta);
        float ribbon = smoothstep(0.27,0.015,distanceToContact);
        float gradientPosition = clamp(0.5+delta.x*2.4+sin(delta.y*22.0+aSeed*9.0)*0.12,0.0,1.0);
        vec3 firstColour = uPalette[int(uCollisionGroups.x+0.5)];
        vec3 secondColour = uPalette[int(uCollisionGroups.y+0.5)];
        vec3 transition = mix(firstColour,secondColour,smoothstep(0.0,1.0,gradientPosition));
        colour = mix(colour,transition,ribbon*min(1.0,(uCollision.z-0.85)*(2.0+uCollisionEnergy)));
        alpha += ribbon*0.24;
      }
      vColour = vec4(colour,alpha);
    }`;

  const RENDER_FRAGMENT = `#version 300 es
    precision mediump float;
    in vec4 vColour;
    out vec4 outColour;
    void main() {
      vec2 point = gl_PointCoord*2.0-1.0;
      float radius = dot(point,point);
      if (radius>1.0) discard;
      float powderEdge = smoothstep(1.0,0.12,radius);
      float softCore=smoothstep(0.28,0.0,radius);
      outColour = vec4(vColour.rgb*(1.0+softCore*0.12),vColour.a*powderEdge);
    }`;

  const BACKGROUND_VERTEX = `#version 300 es
    precision highp float;
    out vec2 vUv;
    void main() {
      vec2 position = vec2((gl_VertexID<<1)&2,gl_VertexID&2);
      vUv = position;
      gl_Position = vec4(position*2.0-1.0,0.0,1.0);
    }`;

  const BACKGROUND_FRAGMENT = `#version 300 es
    precision highp float;
    in vec2 vUv;
    uniform float uTime;
    uniform float uAspect;
    uniform vec2 uCenters[5];
    uniform vec3 uPalette[5];
    uniform vec4 uCollision;
    uniform vec2 uCollisionGroups;
    out vec4 outColour;

    void main() {
      vec2 uv = vUv;
      vec3 colour = mix(vec3(0.067,0.102,0.239),vec3(0.145,0.098,0.26),uv.x*0.64+uv.y*0.2);
      for (int index=0;index<5;index++) {
        vec2 delta = uv-uCenters[index];
        delta.x *= uAspect;
        float angle = float(index)*1.37+uTime*0.025;
        mat2 rotation = mat2(cos(angle),-sin(angle),sin(angle),cos(angle));
        delta = rotation*delta;
        float warped = length(delta*vec2(0.72,1.28))+sin(delta.x*13.0+uTime*0.1)*0.012;
        float fog = smoothstep(0.44,0.015,warped)*0.19;
        colour = mix(colour,uPalette[index],fog);
      }
      if (uCollision.z>0.9) {
        vec2 delta = uv-uCollision.xy;
        delta.x *= uAspect;
        float wake = smoothstep(0.32,0.0,length(delta+vec2(sin(delta.y*18.0+uTime)*0.025,0.0)));
        vec3 mixed = mix(uPalette[int(uCollisionGroups.x+0.5)],uPalette[int(uCollisionGroups.y+0.5)],0.5+0.18*sin(delta.y*28.0));
        colour = mix(colour,mixed,wake*0.2*min(1.0,uCollision.z-0.75));
      }
      outColour = vec4(colour,1.0);
    }`;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      console.error(message);
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(vertexSource, fragmentSource, varyings) {
    const program = gl.createProgram();
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentSource));
    if (varyings) gl.transformFeedbackVaryings(program, varyings, gl.SEPARATE_ATTRIBS);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program);
      console.error(message);
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function locations(program, names) {
    return names.reduce((result, name) => {
      result[name] = gl.getUniformLocation(program, name);
      return result;
    }, {});
  }

  function setPalette(uniform) {
    gl.uniform3fv(uniform, new Float32Array(PALETTE.flat()));
  }

  function initializePrograms() {
    updateProgram = createProgram(UPDATE_VERTEX, PASSTHROUGH_FRAGMENT, ['vPosition', 'vVelocity']);
    renderProgram = createProgram(RENDER_VERTEX, RENDER_FRAGMENT);
    backgroundProgram = createProgram(BACKGROUND_VERTEX, BACKGROUND_FRAGMENT);
    updateUniforms = locations(updateProgram, [
      'uTime','uDelta','uAspect','uFlowStrength','uClusterStrength','uDamping',
      'uCenters[0]','uMouse','uMouseVelocity','uCollision','uCollisionGroups','uWave','uSanityMode',
      'uLogoMask','uLogoField','uCollisionEnergy'
    ]);
    renderUniforms = locations(renderProgram, [
      'uAspect','uDpr','uPointMin','uPointMax','uPalette[0]','uCollision','uCollisionGroups','uCollisionEnergy'
    ]);
    backgroundUniforms = locations(backgroundProgram, [
      'uTime','uAspect','uCenters[0]','uPalette[0]','uCollision','uCollisionGroups'
    ]);
    emptyVao = gl.createVertexArray();
  }

  function createBuffer(data, usage) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    return buffer;
  }

  function createLogoTexture() {
    logoTexture=gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,logoTexture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,0]));
  }

  function loadLogoMask() {
    const image=new Image();
    image.onload=()=>{
      const size=420,surface=document.createElement('canvas');
      surface.width=surface.height=size;
      const context=surface.getContext('2d',{willReadFrequently:true});
      const scale=Math.min(size/image.naturalWidth,size/image.naturalHeight);
      const drawWidth=image.naturalWidth*scale,drawHeight=image.naturalHeight*scale;
      context.drawImage(image,(size-drawWidth)/2,(size-drawHeight)/2,drawWidth,drawHeight);
      const pixels=context.getImageData(0,0,size,size).data;
      logoPoints=[];
      for(let y=0;y<size;y+=2)for(let x=0;x<size;x+=2){if(pixels[(y*size+x)*4+3]>48)logoPoints.push([x/size,y/size]);}
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,logoTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,surface);
      if(logoPoints.length)initializeParticles();
    };
    let sourceIndex=0;
    image.onerror=()=>{
      sourceIndex+=1;
      if(sourceIndex<LOGO_MASK_URLS.length){
        console.warn(`Hero logo mask unavailable, trying legacy asset: ${LOGO_MASK_URLS[sourceIndex]}`);
        image.src=LOGO_MASK_URLS[sourceIndex];
      }else{
        console.error(`Hero logo masks unavailable: ${LOGO_MASK_URLS.join(', ')}`);
      }
    };
    image.src=LOGO_MASK_URLS[sourceIndex];
  }

  function makeInitialState(count) {
    const positions = new Float32Array(count * 2);
    const velocities = new Float32Array(count * 2);
    const seeds = new Float32Array(count);
    const groups = new Float32Array(count);
    for (let index=0;index<count;index+=1) {
      const group = index % PIGMENT_CONFIG.clusterCount;
      const band = Math.floor(index/PIGMENT_CONFIG.clusterCount) / Math.ceil(count/PIGMENT_CONFIG.clusterCount);
      const angle = band*26.0 + group*1.7 + random(-0.28,0.28);
      const ribbon = (band-0.5)*0.58;
      const centerAngle = group/PIGMENT_CONFIG.clusterCount*Math.PI*2-Math.PI/2;
      const centerX = 0.58+Math.cos(centerAngle)*0.265/aspect;
      const centerY = 0.5+Math.sin(centerAngle)*0.27;
      if(index<count*PIGMENT_CONFIG.logoParticleRatio&&logoPoints.length){
        const point=logoPoints[Math.floor(Math.random()*logoPoints.length)];
        positions[index*2]=(mobileQuery.matches?0.57:0.69)+(point[0]-.5)*.55/aspect+random(-.01,.01)/aspect;
        positions[index*2+1]=.5+(point[1]-.5)*.55+random(-.01,.01);
      }else{
        positions[index*2] = centerX + Math.cos(angle)*random(0.015,0.17)/aspect + Math.cos(centerAngle)*ribbon*0.14;
        positions[index*2+1] = centerY + Math.sin(angle)*random(0.012,0.105) + Math.sin(centerAngle)*ribbon*0.11;
      }
      velocities[index*2] = random(-0.025,0.025);
      velocities[index*2+1] = random(-0.025,0.025);
      seeds[index] = Math.random();
      groups[index] = group;
    }
    return { positions, velocities, seeds, groups };
  }

  function createParticleSet(positionData, velocityData, seedBuffer, groupBuffer) {
    const position = createBuffer(positionData, gl.DYNAMIC_COPY);
    const velocity = createBuffer(velocityData, gl.DYNAMIC_COPY);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER, velocity);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1,2,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER, seedBuffer);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2,1,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER, groupBuffer);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3,1,gl.FLOAT,false,0,0);
    return { position, velocity, vao };
  }

  function destroyParticleSets() {
    if (particleSets[0]) {
      gl.deleteBuffer(particleSets[0].seed);
      gl.deleteBuffer(particleSets[0].group);
    }
    particleSets.forEach((set) => {
      gl.deleteBuffer(set.position);
      gl.deleteBuffer(set.velocity);
      gl.deleteVertexArray(set.vao);
    });
    particleSets = [];
  }

  function initializeParticles() {
    destroyParticleSets();
    particleCount = reducedQuery.matches
      ? PIGMENT_CONFIG.reducedMotionCount
      : (mobileQuery.matches ? PIGMENT_CONFIG.mobileCount : PIGMENT_CONFIG.desktopCount);
    const state = makeInitialState(particleCount);
    const seedBuffer = createBuffer(state.seeds, gl.STATIC_DRAW);
    const groupBuffer = createBuffer(state.groups, gl.STATIC_DRAW);
    particleSets = [
      createParticleSet(state.positions,state.velocities,seedBuffer,groupBuffer),
      createParticleSet(state.positions,state.velocities,seedBuffer,groupBuffer)
    ];
    // VAOs retain these buffers; mark ownership on the first set for cleanup.
    particleSets[0].seed = seedBuffer;
    particleSets[0].group = groupBuffer;
    sourceIndex = 0;
  }

  function resize() {
    const rect = hero.getBoundingClientRect();
    width = Math.max(1,rect.width);
    height = Math.max(1,rect.height);
    aspect = width/height;
    dpr = Math.min(window.devicePixelRatio||1,mobileQuery.matches ? PIGMENT_CONFIG.mobileDprCap : PIGMENT_CONFIG.desktopDprCap);
    canvas.width = Math.round(width*dpr);
    canvas.height = Math.round(height*dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    gl.viewport(0,0,canvas.width,canvas.height);
    initializeParticles();
  }

  function clusterCenters(time) {
    const data = new Float32Array(10);
    for (let index=0;index<5;index+=1) {
      const angle = index/5*Math.PI*2-Math.PI/2;
      const pulse = 1+Math.sin(time*0.13+index*1.71)*0.13;
      data[index*2] = 0.58+Math.cos(angle)*0.265*pulse/aspect+Math.sin(time*0.08+index)*0.025;
      data[index*2+1] = 0.5+Math.sin(angle)*0.27*pulse+Math.cos(time*0.065+index*1.4)*0.032;
    }
    return data;
  }

  function updateCollision(delta) {
    fieldCollision.next -= delta;
    if (!fieldCollision.active && fieldCollision.next<=0 && !reducedQuery.matches) {
      fieldCollision.first = Math.floor(Math.random()*5);
      fieldCollision.second = (fieldCollision.first+1+Math.floor(Math.random()*4))%5;
      fieldCollision.age = 0;
      fieldCollision.active = true;
    }
    if (!fieldCollision.active) return 0;
    fieldCollision.age += delta;
    const approach = PIGMENT_CONFIG.approachDuration;
    const compression = approach+PIGMENT_CONFIG.compressionDuration;
    const impact = compression+PIGMENT_CONFIG.impactDuration;
    const total = impact+PIGMENT_CONFIG.wakeDuration;
    if (fieldCollision.age<approach) return fieldCollision.age/approach;
    if (fieldCollision.age<compression) return 1+(fieldCollision.age-approach)/PIGMENT_CONFIG.compressionDuration;
    if (fieldCollision.age<impact) return 2+(fieldCollision.age-compression)/PIGMENT_CONFIG.impactDuration;
    if (fieldCollision.age<total) return 3+(fieldCollision.age-impact)/PIGMENT_CONFIG.wakeDuration;
    fieldCollision.active = false;
    fieldCollision.next = random(PIGMENT_CONFIG.collisionIntervalMin,PIGMENT_CONFIG.collisionIntervalMax);
    return 0;
  }

  function collisionPoint(centers) {
    return [mobileQuery.matches?0.57:0.69,0.5];
  }

  function setInteractionUniforms(uniforms, centers, collisionPhase) {
    const contact = collisionPoint(centers);
    gl.uniform1f(uniforms.uAspect,aspect);
    if (uniforms['uCenters[0]']) gl.uniform2fv(uniforms['uCenters[0]'],centers);
    if (uniforms.uCollision) gl.uniform4f(uniforms.uCollision,contact[0],contact[1],collisionPhase,PIGMENT_CONFIG.collisionRadius);
    if (uniforms.uCollisionGroups) gl.uniform2f(uniforms.uCollisionGroups,fieldCollision.first,fieldCollision.second);
  }

  function updateParticles(delta, centers, collisionPhase) {
    const source = particleSets[sourceIndex];
    const target = particleSets[1-sourceIndex];
    gl.useProgram(updateProgram);
    gl.bindVertexArray(source.vao);
    gl.uniform1f(updateUniforms.uTime,elapsed);
    gl.uniform1f(updateUniforms.uDelta,delta);
    gl.uniform1f(updateUniforms.uFlowStrength,reducedQuery.matches ? 0.055 : (mobileQuery.matches ? 0.25 : PIGMENT_CONFIG.flowStrength));
    gl.uniform1f(updateUniforms.uClusterStrength,PIGMENT_CONFIG.clusterStrength);
    gl.uniform1f(updateUniforms.uDamping,PIGMENT_CONFIG.damping);
    gl.uniform4f(updateUniforms.uMouse,pointer.x,pointer.y,pointer.active,PIGMENT_CONFIG.mouseOuterRadius);
    gl.uniform2f(updateUniforms.uMouseVelocity,pointer.vx,pointer.vy);
    gl.uniform4f(updateUniforms.uWave,resonance.x,resonance.y,resonance.age,PIGMENT_CONFIG.resonanceDuration);
    gl.uniform1f(updateUniforms.uSanityMode,SANITY_MODE ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,logoTexture);
    gl.uniform1i(updateUniforms.uLogoMask,0);
    gl.uniform3f(updateUniforms.uLogoField,mobileQuery.matches?0.57:0.69,0.55,PIGMENT_CONFIG.logoAttractionStrength);
    gl.uniform1f(updateUniforms.uCollisionEnergy,collisionEnergy);
    setInteractionUniforms(updateUniforms,centers,collisionPhase);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,target.position);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,1,target.velocity);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS,0,particleCount);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,1,null);
    sourceIndex = 1-sourceIndex;
  }

  function drawBackground(centers, collisionPhase) {
    gl.disable(gl.BLEND);
    gl.useProgram(backgroundProgram);
    gl.bindVertexArray(emptyVao);
    gl.uniform1f(backgroundUniforms.uTime,elapsed);
    setPalette(backgroundUniforms['uPalette[0]']);
    setInteractionUniforms(backgroundUniforms,centers,collisionPhase);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }

  function drawParticles(centers, collisionPhase) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(renderProgram);
    gl.bindVertexArray(particleSets[sourceIndex].vao);
    gl.uniform1f(renderUniforms.uDpr,dpr);
    gl.uniform1f(renderUniforms.uPointMin,PIGMENT_CONFIG.pointSizeMin);
    gl.uniform1f(renderUniforms.uPointMax,PIGMENT_CONFIG.pointSizeMax);
    gl.uniform1f(renderUniforms.uCollisionEnergy,collisionEnergy);
    setPalette(renderUniforms['uPalette[0]']);
    setInteractionUniforms(renderUniforms,centers,collisionPhase);
    gl.drawArrays(gl.POINTS,0,particleCount);
  }

  function animate(time) {
    if (!visible) return;
    const rawDelta = Math.min(0.033,(time-lastTime)/1000||0.0167);
    const delta = reducedQuery.matches ? rawDelta*0.16 : rawDelta;
    lastTime = time;
    elapsed += delta;
    resonance.age += rawDelta;
    const collisionPhase = updateCollision(rawDelta);
    const centers = clusterCenters(elapsed);
    updateParticles(delta,centers,collisionPhase);
    drawBackground(centers,collisionPhase);
    drawParticles(centers,collisionPhase);
    pointer.vx *= 0.82;
    pointer.vy *= 0.82;
    collisionEnergy += (0.55-collisionEnergy)*Math.min(1,rawDelta*0.7);
    animationFrame = requestAnimationFrame(animate);
  }

  function pointerPosition(event) {
    const rect = hero.getBoundingClientRect();
    return [(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height];
  }

  hero.addEventListener('pointerenter',(event) => {
    if (event.pointerType==='touch') return;
    const position = pointerPosition(event);
    pointer.x = pointer.previousX = position[0];
    pointer.y = pointer.previousY = position[1];
    pointer.active = 1;
  },{passive:true});
  hero.addEventListener('pointermove',(event) => {
    if (event.pointerType==='touch') return;
    const position = pointerPosition(event);
    pointer.vx = clamp(position[0]-pointer.previousX,-0.08,0.08);
    pointer.vy = clamp(position[1]-pointer.previousY,-0.08,0.08);
    pointer.x = pointer.previousX = position[0];
    pointer.y = pointer.previousY = position[1];
    pointer.active = 1;
    const coreX=mobileQuery.matches?0.57:0.69;
    const coreDistance=Math.hypot((position[0]-coreX)*aspect,position[1]-.5);
    const speed=Math.hypot(pointer.vx*aspect,pointer.vy);
    if(coreDistance<.3)collisionEnergy=Math.max(collisionEnergy,.75);
    if(coreDistance<PIGMENT_CONFIG.collisionRadius&&speed>.018){
      collisionEnergy=1;
      fieldCollision.age=PIGMENT_CONFIG.approachDuration+PIGMENT_CONFIG.compressionDuration;
      fieldCollision.active=true;
    }
  },{passive:true});
  hero.addEventListener('pointerleave',() => { pointer.active = 0; },{passive:true});
  hero.addEventListener('pointerdown',(event) => {
    if (reducedQuery.matches) return;
    const position = pointerPosition(event);
    resonance.x = position[0];
    resonance.y = position[1];
    resonance.age = 0;
  },{passive:true});
  document.addEventListener('visibilitychange',() => {
    visible = !document.hidden;
    cancelAnimationFrame(animationFrame);
    if (visible) {
      lastTime = performance.now();
      animationFrame = requestAnimationFrame(animate);
    }
  });
  window.addEventListener('resize',resize,{passive:true});
  if (mobileQuery.addEventListener) {
    mobileQuery.addEventListener('change',resize);
    reducedQuery.addEventListener('change',resize);
  }

  try {
    initializePrograms();
    createLogoTexture();
    resize();
    reportRenderer('webgl2');
    animationFrame = requestAnimationFrame(animate);
    loadLogoMask();
  } catch (error) {
    hero.classList.add('hero-pigment-fallback');
    startMovingFallback(canvas,error);
  }
}());
