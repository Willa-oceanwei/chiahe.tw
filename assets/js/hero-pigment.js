/* Chia-He logo pigment story. Particle integration stays on the GPU while the
 * CPU supplies the fixed logo geometry, collision phase, and pointer energy. */
(function () {
  'use strict';

  const PIGMENT_CONFIG = {
    desktopCount: 24000,
    mobileCount: 9000,
    reducedMotionCount: 2500,
    clusterCount: 5,
    pointSizeMin: 0.72,
    pointSizeMax: 2.35,
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
    logoParticleRatio: 0.40,
    logoAttractionStrength: 0.035,
    desktopDprCap: 1.65,
    mobileDprCap: 1.25
  };
  const PALETTE = [
    [0.12, 0.72, 0.78], [0.88, 0.24, 0.56], [0.96, 0.70, 0.18],
    [0.96, 0.40, 0.17], [0.57, 0.25, 0.92]
  ];
  const LOGO_MASK_URL = 'images/chiahe-logo-symbol.png';

  window.HERO_PIGMENT_CONFIG = PIGMENT_CONFIG;
  window.HERO_PIGMENT_PALETTE = PALETTE;
  const SANITY_MODE = new URLSearchParams(window.location.search).get('debugPigment')==='sanity';

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
    uniform vec4 uWave;
    uniform float uSanityMode;

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

      // The logo is a low-priority density/flow bias for only 40% of the field.
      // Inside the mask particles remain free; cohesion appears only near its
      // boundary or after a particle has travelled well away from the mark.
      if (fract(aSeed*7.137) < 0.40) {
        vec2 logoUv = vec2(
          (position.x-uLogoField.x)*uAspect/uLogoField.y+0.5,
          (position.y-0.5)/uLogoField.y+0.5
        );
        bool inBounds = all(greaterThanEqual(logoUv,vec2(0.0))) && all(lessThanEqual(logoUv,vec2(1.0)));
        float mask = inBounds ? texture(uLogoMask,logoUv).a : 0.0;
        vec2 texel = vec2(1.0/420.0);
        vec2 gradient = vec2(
          texture(uLogoMask,logoUv+vec2(texel.x,0.0)).a-texture(uLogoMask,logoUv-vec2(texel.x,0.0)).a,
          texture(uLogoMask,logoUv+vec2(0.0,texel.y)).a-texture(uLogoMask,logoUv-vec2(0.0,texel.y)).a
        );
        gradient.x /= uAspect;
        float logoDistance = length(vec2((position.x-uLogoField.x)*uAspect,position.y-0.5));
        velocity += gradient*(1.0-mask)*uLogoField.z*3.0*uDelta;
        velocity += vec2((uLogoField.x-position.x)/uAspect,0.5-position.y)
          *smoothstep(0.30,0.72,logoDistance)*uLogoField.z*uDelta;
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
        velocity += direction * (outer*0.34 + inner*1.35) * uDelta;
        velocity += tangentForce * outer * (0.42 + speed*0.45) * uDelta;
        velocity += uMouseVelocity * outer * (0.95 + speed) * uDelta;
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
          velocity -= normal*influence*1.42*uDelta;
          velocity += tangentCollision*influence*sin(aSeed*31.0)*0.38*uDelta;
        } else if (phase < 3.0) {
          velocity += normal*influence*2.15*uDelta;
          velocity += tangentCollision*influence*sin(aSeed*47.0)*1.15*uDelta;
        } else {
          float wake = (1.0-(phase-3.0))*influence;
          velocity += tangentCollision*wake*(0.9+0.5*sin(aSeed*23.0))*uDelta;
          velocity += curlField(position*5.0,aSeed+uTime)*wake*0.65*uDelta;
        }
      }

      // Pointer attracts and stirs; near the logo it guides pigment into core.
      if(uMouse.z>.5){
        vec2 dm=metric(uMouse.xy-p); float md=length(dm); vec2 towardMouse=md>.001?dm/md:vec2(0); towardMouse.x/=uAspect;
        float reach=smoothstep(uMouse.w,0.0,md);
        v += towardMouse*reach*.34*uDelta;
        vec2 dc=metric(uCore-p); float cd=length(dc); vec2 towardCore=cd>.001?dc/cd:vec2(0); towardCore.x/=uAspect;
        float logoMouse=smoothstep(.34,0.0,length(metric(uMouse.xy-uCore)));
        v += towardCore*reach*logoMouse*.48*uDelta;
        v += uMouseVelocity*reach*.42*uDelta;
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

    void main() {
      vec2 clip = vec2(aPosition.x*2.0-1.0,1.0-aPosition.y*2.0);
      gl_Position = vec4(clip,0.0,1.0);
      float depth = fract(aSeed*17.731);
      gl_PointSize = mix(uPointMin,uPointMax,pow(depth,3.1))*uDpr;
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
        colour = mix(colour,transition,ribbon*min(1.0,(uCollision.z-0.85)*2.4));
        alpha += ribbon*0.16;
      }
      vColour = vec4(colour,alpha);
    }`;
  const RENDER_FRAGMENT = `#version 300 es
    precision mediump float; in vec4 vColour; out vec4 outColour;
    void main(){ vec2 q=gl_PointCoord*2.0-1.0; float r=dot(q,q); if(r>1.0)discard; outColour=vec4(vColour.rgb,vColour.a*smoothstep(1.0,.08,r)); }`;
  const BACKGROUND_VERTEX = `#version 300 es
    precision highp float; out vec2 vUv; void main(){ vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p;gl_Position=vec4(p*2.0-1.0,0,1);}`;
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
      'uCenters[0]','uMouse','uMouseVelocity','uCollision','uCollisionGroups','uWave','uSanityMode'
    ]);
    renderUniforms = locations(renderProgram, [
      'uAspect','uDpr','uPointMin','uPointMax','uPalette[0]','uCollision','uCollisionGroups'
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
    logoTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,logoTexture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,0]));
  }

  function loadLogoMask() {
    const image = new Image();
    image.onload = () => {
      const size = 420;
      const surface = document.createElement('canvas');
      surface.width = surface.height = size;
      const context = surface.getContext('2d',{willReadFrequently:true});
      const scale = Math.min(size/image.naturalWidth,size/image.naturalHeight);
      const drawWidth = image.naturalWidth*scale;
      const drawHeight = image.naturalHeight*scale;
      context.drawImage(image,(size-drawWidth)/2,(size-drawHeight)/2,drawWidth,drawHeight);
      const pixels = context.getImageData(0,0,size,size).data;
      logoPoints = [];
      for (let y=0;y<size;y+=2) for (let x=0;x<size;x+=2) {
        if (pixels[(y*size+x)*4+3]>48) logoPoints.push([x/size,y/size]);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,logoTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,surface);
      // Re-seed the biased share once; the running engine never waits for the image.
      if (logoPoints.length) initializeParticles();
    };
    image.onerror = () => console.warn(`Hero logo mask unavailable: ${LOGO_MASK_URL}`);
    image.src = LOGO_MASK_URL;
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
      if (index<count*PIGMENT_CONFIG.logoParticleRatio && logoPoints.length) {
        const point = logoPoints[Math.floor(Math.random()*logoPoints.length)];
        positions[index*2] = (mobileQuery.matches ? 0.57 : 0.69)+(point[0]-0.5)*0.55/aspect+random(-0.008,0.008)/aspect;
        positions[index*2+1] = 0.5+(point[1]-0.5)*0.55+random(-0.008,0.008);
      } else {
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
    const a = fieldCollision.first*2;
    const b = fieldCollision.second*2;
    return [(centers[a]+centers[b])*0.5,(centers[a+1]+centers[b+1])*0.5];
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
    if (SANITY_MODE) {
      const badge = document.createElement('div');
      badge.textContent = 'HERO SANITY ACTIVE';
      badge.setAttribute('aria-live','polite');
      badge.style.cssText = 'position:absolute;right:12px;bottom:12px;z-index:3;padding:6px 9px;background:#111827;color:#fff;font:600 11px/1.2 monospace;letter-spacing:.08em;border:1px solid rgba(255,255,255,.45);border-radius:3px;pointer-events:none';
      hero.appendChild(badge);
    }
    initializePrograms();
    createLogoTexture();
    resize();
    animationFrame = requestAnimationFrame(animate);
    loadLogoMask();
  } catch (error) {
    canvas.remove();
    hero.classList.add('hero-pigment-fallback');
    console.error(error);
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
