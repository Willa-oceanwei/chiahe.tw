/* GPU pigment field for the home-page hero. WebGL2 transform feedback keeps all
 * per-particle integration on the GPU; the CPU only updates interaction fields. */
(function () {
  'use strict';

  const PIGMENT_CONFIG = {
    desktopCount: 20000,
    mobileCount: 8000,
    reducedMotionCount: 2500,
    clusterCount: 5,
    pointSizeMin: 1.5,
    pointSizeMax: 8.0,
    flowScale: 3.2,
    flowStrength: 0.34,
    clusterStrength: 0.18,
    damping: 0.986,
    mouseInnerRadius: 0.105,
    mouseOuterRadius: 0.29,
    mouseRadialForce: 0.18,
    mouseSwirlForce: 1.18,
    mouseWakeForce: 1.65,
    mouseAttractionForce: 0.24,
    pigmentCarryLifetime: 1.4,
    mixedLifetime: 4.8,
    mixedSizeMultiplier: 1.35,
    mixedOpacityMultiplier: 1.22,
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

  window.HERO_PIGMENT_CONFIG = PIGMENT_CONFIG;
  window.HERO_PIGMENT_PALETTE = PALETTE;

  const hero = document.getElementById('intro');
  if (!hero) return;

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
    canvas.remove();
    hero.classList.add('hero-pigment-fallback');
    return;
  }

  const mobileQuery = window.matchMedia('(max-width: 736px)');
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = {
    x: 0, y: 0, previousX: 0, previousY: 0,
    vx: 0, vy: 0, active: 0
  };
  const resonance = { x: 0, y: 0, age: 99 };
  const pigmentCarry = { group: -1, age: 99, mixAge: 0 };
  const waveMix = { first: 0, second: 1 };
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
  let currentCenters = new Float32Array(10);

  const random = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const UPDATE_VERTEX = `#version 300 es
    precision highp float;
    layout(location=0) in vec2 aPosition;
    layout(location=1) in vec2 aVelocity;
    layout(location=2) in float aSeed;
    layout(location=3) in float aGroup;
    layout(location=4) in vec2 aMixState;

    uniform float uTime;
    uniform float uDelta;
    uniform float uAspect;
    uniform float uFlowStrength;
    uniform float uClusterStrength;
    uniform float uDamping;
    uniform vec2 uCenters[5];
    uniform vec4 uMouse;
    uniform vec2 uMouseVelocity;
    uniform vec4 uMouseForces;
    uniform vec3 uCarry;
    uniform vec4 uCollision;
    uniform vec2 uCollisionGroups;
    uniform vec4 uWave;
    uniform vec2 uWaveMix;
    uniform float uMixDecay;

    out vec2 vPosition;
    out vec2 vVelocity;
    out vec2 vMixState;

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
      vec2 mixState = aMixState;
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

      // Mouse is one continuous radial + tangential + dragged wake field.
      if (uMouse.z > 0.5) {
        vec2 mouseDelta = position - uMouse.xy;
        mouseDelta.x *= uAspect;
        float mouseDistance = length(mouseDelta);
        float outer = smoothstep(uMouse.w, 0.0, mouseDistance);
        float core = smoothstep(uMouse.w*0.15, 0.0, mouseDistance);
        float middle = smoothstep(uMouse.w*0.55, uMouse.w*0.15, mouseDistance)*(1.0-core);
        vec2 direction = mouseDistance > 0.0001 ? mouseDelta/mouseDistance : vec2(1.0,0.0);
        vec2 tangentForce = vec2(-direction.y,direction.x);
        float speed = min(length(uMouseVelocity)*8.0,2.2);
        velocity += direction*core*uMouseForces.x*uDelta;
        velocity -= direction*outer*(1.0-core)*uMouseForces.w*uDelta;
        velocity += tangentForce*(middle+outer*0.24)*uMouseForces.y*(0.65+speed*0.45)*uDelta;
        velocity += uMouseVelocity*outer*uMouseForces.z*(1.0+speed)*uDelta;
        if (uCarry.x >= 0.0 && abs(aGroup-uCarry.x)>0.25) {
          float carryMix = middle*uCarry.y*(0.32+speed*0.3);
          if (carryMix>mixState.x) mixState = vec2(carryMix,uCarry.x);
        }
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
        bool waveSelected = abs(aGroup-uWaveMix.x)<0.25 || abs(aGroup-uWaveMix.y)<0.25;
        if (waveSelected && waveProgress<0.46) {
          float target = abs(aGroup-uWaveMix.x)<0.25 ? uWaveMix.y : uWaveMix.x;
          float compression = smoothstep(0.31,0.0,waveDistance)*(1.0-waveProgress/0.46);
          velocity -= waveDirection*compression*0.48*uDelta;
          if (compression*0.82>mixState.x) mixState = vec2(compression*0.82,target);
        }
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
        float influence = smoothstep(0.52,0.0,contactDistance);
        float phase = uCollision.z;
        if (phase < 1.0) {
          velocity -= normal*influence*(0.4+phase*0.95)*uDelta;
          velocity += tangentCollision*influence*phase*0.22*uDelta;
        } else if (phase < 2.0) {
          velocity -= normal*influence*2.35*uDelta;
          velocity *= 1.0-influence*0.16;
          velocity += tangentCollision*influence*sin(aSeed*31.0)*0.62*uDelta;
        } else if (phase < 3.0) {
          velocity += normal*influence*1.12*uDelta;
          velocity += tangentCollision*influence*sin(aSeed*47.0)*2.05*uDelta;
        } else {
          float wake = (1.0-(phase-3.0))*influence;
          velocity += tangentCollision*wake*(0.9+0.5*sin(aSeed*23.0))*uDelta;
          velocity += curlField(position*5.0,aSeed+uTime)*wake*0.65*uDelta;
        }
        float mixingProgress = clamp((phase-1.12)/1.65,0.0,1.0);
        float mixingBand = smoothstep(0.43,0.015,contactDistance)*mixingProgress;
        float otherGroup = abs(aGroup-uCollisionGroups.x)<0.25 ? uCollisionGroups.y : uCollisionGroups.x;
        if (mixingBand>mixState.x) mixState = vec2(mixingBand,otherGroup);
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
      mixState.x = max(0.0,mixState.x-uMixDecay*uDelta);
      vMixState = mixState;
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
    layout(location=4) in vec2 aMixState;
    uniform float uAspect;
    uniform float uDpr;
    uniform float uPointMin;
    uniform float uPointMax;
    uniform float uMixedSize;
    uniform float uMixedOpacity;
    uniform vec3 uPalette[5];
    uniform vec4 uCollision;
    uniform vec2 uCollisionGroups;
    out vec4 vColour;

    void main() {
      vec2 clip = vec2(aPosition.x*2.0-1.0,1.0-aPosition.y*2.0);
      gl_Position = vec4(clip,0.0,1.0);
      float distribution = fract(aSeed*17.731);
      float localSeed = fract(aSeed*43.117);
      float pointSize;
      if (distribution<0.25) pointSize = mix(uPointMin,uPointMin+1.0,localSeed);
      else if (distribution<0.75) pointSize = mix(uPointMin+1.0,uPointMin+3.0,localSeed);
      else if (distribution<0.95) pointSize = mix(uPointMin+2.5,uPointMax-2.0,localSeed);
      else pointSize = mix(uPointMax-2.0,uPointMax,localSeed);
      float persistentMix = smoothstep(0.0,0.76,aMixState.x);
      gl_PointSize = pointSize*mix(1.0,uMixedSize,persistentMix)*uDpr;
      int groupIndex = int(aGroup+0.5);
      vec3 colour = uPalette[groupIndex];
      float alpha = mix(0.30,0.76,pow(distribution,0.72));
      colour = mix(colour,uPalette[int(aMixState.y+0.5)],persistentMix*0.72);
      alpha *= mix(1.0,uMixedOpacity,persistentMix);

      // Multiple perceptual interpolation positions create a colour ribbon,
      // rather than replacing both colliding fields with one flat mixed hue.
      bool selected = abs(aGroup-uCollisionGroups.x)<0.25 || abs(aGroup-uCollisionGroups.y)<0.25;
      if (selected && uCollision.z>0.85) {
        vec2 delta = aPosition-uCollision.xy;
        delta.x *= uAspect;
        float distanceToContact = length(delta);
        float ribbon = smoothstep(0.43,0.015,distanceToContact);
        float gradientPosition = clamp(0.5+delta.x*2.4+sin(delta.y*22.0+aSeed*9.0)*0.12,0.0,1.0);
        vec3 firstColour = uPalette[int(uCollisionGroups.x+0.5)];
        vec3 secondColour = uPalette[int(uCollisionGroups.y+0.5)];
        vec3 transition = mix(firstColour,secondColour,smoothstep(0.0,1.0,gradientPosition));
        float timedMix = smoothstep(1.05,2.65,uCollision.z);
        colour = mix(colour,transition,ribbon*timedMix*0.64);
        alpha += ribbon*timedMix*0.13;
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
      outColour = vec4(vColour.rgb,vColour.a*powderEdge);
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
        bool collisionFog = abs(float(index)-uCollisionGroups.x)<0.25 || abs(float(index)-uCollisionGroups.y)<0.25;
        if (collisionFog && uCollision.z>1.0) fog *= 0.84;
        colour = mix(colour,uPalette[index],fog);
      }
      if (uCollision.z>0.9) {
        vec2 delta = uv-uCollision.xy;
        delta.x *= uAspect;
        float wake = smoothstep(0.32,0.0,length(delta+vec2(sin(delta.y*18.0+uTime)*0.025,0.0)));
        vec3 mixed = mix(uPalette[int(uCollisionGroups.x+0.5)],uPalette[int(uCollisionGroups.y+0.5)],0.5+0.18*sin(delta.y*28.0));
        float mixedFog = smoothstep(1.0,2.75,uCollision.z);
        colour = mix(colour,mixed,wake*0.31*mixedFog);
      }
      outColour = vec4(colour,1.0);
    }`;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Hero pigment shader failed: ${message}`);
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
      gl.deleteProgram(program);
      throw new Error(`Hero pigment program failed: ${message}`);
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
    updateProgram = createProgram(UPDATE_VERTEX, PASSTHROUGH_FRAGMENT, ['vPosition', 'vVelocity', 'vMixState']);
    renderProgram = createProgram(RENDER_VERTEX, RENDER_FRAGMENT);
    backgroundProgram = createProgram(BACKGROUND_VERTEX, BACKGROUND_FRAGMENT);
    updateUniforms = locations(updateProgram, [
      'uTime','uDelta','uAspect','uFlowStrength','uClusterStrength','uDamping',
      'uCenters[0]','uMouse','uMouseVelocity','uMouseForces','uCarry','uCollision',
      'uCollisionGroups','uWave','uWaveMix','uMixDecay'
    ]);
    renderUniforms = locations(renderProgram, [
      'uAspect','uDpr','uPointMin','uPointMax','uMixedSize','uMixedOpacity',
      'uPalette[0]','uCollision','uCollisionGroups'
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

  function makeInitialState(count) {
    const positions = new Float32Array(count * 2);
    const velocities = new Float32Array(count * 2);
    const seeds = new Float32Array(count);
    const groups = new Float32Array(count);
    const mixes = new Float32Array(count * 2);
    for (let index=0;index<count;index+=1) {
      const group = index % PIGMENT_CONFIG.clusterCount;
      const band = Math.floor(index/PIGMENT_CONFIG.clusterCount) / Math.ceil(count/PIGMENT_CONFIG.clusterCount);
      const angle = band*26.0 + group*1.7 + random(-0.28,0.28);
      const ribbon = (band-0.5)*0.58;
      const centerAngle = group/PIGMENT_CONFIG.clusterCount*Math.PI*2-Math.PI/2;
      const centerX = 0.58+Math.cos(centerAngle)*0.265/aspect;
      const centerY = 0.5+Math.sin(centerAngle)*0.27;
      positions[index*2] = centerX + Math.cos(angle)*random(0.015,0.17)/aspect + Math.cos(centerAngle)*ribbon*0.14;
      positions[index*2+1] = centerY + Math.sin(angle)*random(0.012,0.105) + Math.sin(centerAngle)*ribbon*0.11;
      velocities[index*2] = random(-0.025,0.025);
      velocities[index*2+1] = random(-0.025,0.025);
      seeds[index] = Math.random();
      groups[index] = group;
      mixes[index*2+1] = group;
    }
    return { positions, velocities, seeds, groups, mixes };
  }

  function createParticleSet(positionData, velocityData, mixData, seedBuffer, groupBuffer) {
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
    const mix = createBuffer(mixData, gl.DYNAMIC_COPY);
    gl.bindBuffer(gl.ARRAY_BUFFER, mix);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4,2,gl.FLOAT,false,0,0);
    return { position, velocity, mix, vao };
  }

  function destroyParticleSets() {
    if (particleSets[0]) {
      gl.deleteBuffer(particleSets[0].seed);
      gl.deleteBuffer(particleSets[0].group);
    }
    particleSets.forEach((set) => {
      gl.deleteBuffer(set.position);
      gl.deleteBuffer(set.velocity);
      gl.deleteBuffer(set.mix);
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
      createParticleSet(state.positions,state.velocities,state.mixes,seedBuffer,groupBuffer),
      createParticleSet(state.positions,state.velocities,state.mixes,seedBuffer,groupBuffer)
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
    const a = fieldCollision.first*2;
    const b = fieldCollision.second*2;
    return [(centers[a]+centers[b])*0.5,(centers[a+1]+centers[b+1])*0.5];
  }

  function nearestGroups(x, y, centers) {
    const distances = [];
    for (let group=0;group<5;group+=1) {
      const dx = (x-centers[group*2])*aspect;
      const dy = y-centers[group*2+1];
      distances.push({ group, distance: Math.hypot(dx,dy) });
    }
    distances.sort((a,b) => a.distance-b.distance);
    return distances;
  }

  function updatePigmentCarry(delta, centers) {
    pigmentCarry.age += delta;
    if (!pointer.active) {
      pigmentCarry.mixAge = 0;
      return;
    }
    const nearest = nearestGroups(pointer.x,pointer.y,centers)[0];
    if (nearest.distance>0.3) return;
    if (pigmentCarry.group<0 || pigmentCarry.age>PIGMENT_CONFIG.pigmentCarryLifetime) {
      pigmentCarry.group = nearest.group;
      pigmentCarry.age = 0;
      pigmentCarry.mixAge = 0;
      return;
    }
    if (nearest.group===pigmentCarry.group) {
      pigmentCarry.age = 0;
      pigmentCarry.mixAge = 0;
      return;
    }
    pigmentCarry.mixAge += delta;
    if (pigmentCarry.mixAge>0.28 && !fieldCollision.active) {
      fieldCollision.first = pigmentCarry.group;
      fieldCollision.second = nearest.group;
      fieldCollision.age = PIGMENT_CONFIG.approachDuration*0.72;
      fieldCollision.active = true;
      pigmentCarry.mixAge = 0;
    }
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
    gl.uniform4f(updateUniforms.uMouseForces,PIGMENT_CONFIG.mouseRadialForce,PIGMENT_CONFIG.mouseSwirlForce,PIGMENT_CONFIG.mouseWakeForce,PIGMENT_CONFIG.mouseAttractionForce);
    gl.uniform3f(updateUniforms.uCarry,pigmentCarry.group,clamp(1-pigmentCarry.age/PIGMENT_CONFIG.pigmentCarryLifetime,0,1),PIGMENT_CONFIG.pigmentCarryLifetime);
    gl.uniform4f(updateUniforms.uWave,resonance.x,resonance.y,resonance.age,PIGMENT_CONFIG.resonanceDuration);
    gl.uniform2f(updateUniforms.uWaveMix,waveMix.first,waveMix.second);
    gl.uniform1f(updateUniforms.uMixDecay,1/PIGMENT_CONFIG.mixedLifetime);
    setInteractionUniforms(updateUniforms,centers,collisionPhase);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,target.position);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,1,target.velocity);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,2,target.mix);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS,0,particleCount);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,1,null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,2,null);
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
    gl.uniform1f(renderUniforms.uMixedSize,PIGMENT_CONFIG.mixedSizeMultiplier);
    gl.uniform1f(renderUniforms.uMixedOpacity,PIGMENT_CONFIG.mixedOpacityMultiplier);
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
    currentCenters = clusterCenters(elapsed);
    updatePigmentCarry(rawDelta,currentCenters);
    updateParticles(delta,currentCenters,collisionPhase);
    drawBackground(currentCenters,collisionPhase);
    drawParticles(currentCenters,collisionPhase);
    pointer.vx *= 0.82;
    pointer.vy *= 0.82;
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
  },{passive:true});
  hero.addEventListener('pointerleave',() => { pointer.active = 0; },{passive:true});
  hero.addEventListener('pointerdown',(event) => {
    if (reducedQuery.matches) return;
    const position = pointerPosition(event);
    resonance.x = position[0];
    resonance.y = position[1];
    resonance.age = 0;
    const nearest = nearestGroups(position[0],position[1],currentCenters);
    waveMix.first = nearest[0].group;
    waveMix.second = nearest[1].distance<0.38 ? nearest[1].group : nearest[0].group;
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
    resize();
    animationFrame = requestAnimationFrame(animate);
  } catch (error) {
    canvas.remove();
    hero.classList.add('hero-pigment-fallback');
    console.error(error);
  }
}());
