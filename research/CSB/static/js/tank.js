import * as THREE from './vendor/three.module.min.js';
import { covarianceRoot, gaussianPoint, gaussian95Radius } from './gsb.js';

// Tank dimensions and clipping.
export const halfWidth = 1;
export const bottomHeight = -1.5;
export const topHeight = 1.2;
export const halfHeight = (topHeight - bottomHeight) / 2;
export const centerHeight = (topHeight + bottomHeight) / 2;
export const rimRadius = 0.18;
export const capHalfWidth = halfWidth - rimRadius;
export const capCornerRadius = 0.22;

function addTankVolumeTest(shader) {
  const main = /void\s+main\s*\(\s*\)\s*\{/;
  shader.vertexShader = shader.vertexShader.replace(main, `
    varying vec3 tankPosition;
    void main() {
      vec4 tankVertex = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        tankVertex = instanceMatrix * tankVertex;
      #endif
      tankPosition = (modelMatrix * tankVertex).xyz;
  `);
  // The cap is a rounded square. Sweeping its edge through a quarter circle
  // gives the shoulder where the vertical wall meets the cap.
  shader.fragmentShader = shader.fragmentShader.replace(main, `
    varying vec3 tankPosition;
    void main() {
      vec2 corner = max(abs(tankPosition.xz) - vec2(${(capHalfWidth - capCornerRadius).toFixed(6)}), 0.0);
      float wall = max(length(corner) - ${capCornerRadius.toFixed(6)}, 0.0);
      float cap = max(abs(tankPosition.y - (${centerHeight.toFixed(6)})) - ${(halfHeight - rimRadius).toFixed(6)}, 0.0);
      vec2 bevel = vec2(wall, cap);
      // Include points on the cap after conversion to GPU floats.
      float radius = ${rimRadius.toFixed(6)} + 0.000001;
      if (dot(bevel, bevel) > radius * radius) discard;
  `);
}

export function clipToTank(material) {
  // KEEP makes the silhouette a read-only mask during each draw. The full
  // write mask lets WebGL clear the stencil before drawing the next frame.
  material.stencilWrite = true;
  material.stencilRef = 1;
  material.stencilFunc = THREE.EqualStencilFunc;
  material.stencilFail = material.stencilZFail = material.stencilZPass = THREE.KeepStencilOp;
  if (material.isShaderMaterial) {
    // ShaderMaterial.clone() copies the shader sources, including this test.
    addTankVolumeTest(material);
  } else {
    // Three supplies the built-in material shader when it compiles the mesh.
    const previousHook = material.onBeforeCompile;
    const previousKey = material.customProgramCacheKey();
    material.onBeforeCompile = function (shader, renderer) {
      previousHook.call(this, shader, renderer);
      addTankVolumeTest(shader);
    };
    material.customProgramCacheKey = () => previousKey + '/tank-volume';
  }
  material.needsUpdate = true;
  return material;
}

// Gaussian population tube.
const tubeSegments = 80;
const timeSteps = 80;

function peakDensity({ xx, xy, yy }) {
  return 1 / (2 * Math.PI * Math.sqrt(xx * yy - xy * xy));
}

export function createGaussianTube(scene, { forward = false } = {}) {
  const group = new THREE.Group();
  scene.add(group);
  const wallMaterial = clipToTank(new THREE.ShaderMaterial({
    uniforms: { progress: { value: 0 } },
    vertexShader: `
      attribute float time;
      varying float sliceTime;
      varying vec3 tint;
      varying vec3 surfaceNormal;
      void main() {
        sliceTime = time;
        tint = color;
        surfaceNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float progress;
      varying float sliceTime;
      varying vec3 tint;
      varying vec3 surfaceNormal;
      void main() {
        if (sliceTime > progress) discard;
        float edge = pow(1.0 - abs(normalize(surfaceNormal).z), 2.0);
        gl_FragColor = vec4(mix(tint, vec3(1.0), 0.22 * edge), 0.12 + 0.16 * edge);
      }
    `,
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.BackSide,
  }));
  const walls = new THREE.Mesh(new THREE.BufferGeometry(), wallMaterial);
  walls.renderOrder = 0.5;
  const frontWalls = new THREE.Mesh(walls.geometry, wallMaterial.clone());
  frontWalls.material.side = THREE.FrontSide;
  frontWalls.material.uniforms.progress = wallMaterial.uniforms.progress;
  frontWalls.renderOrder = 1.5;
  group.add(walls, frontWalls);

  const slice = new THREE.Mesh(new THREE.BufferGeometry(), clipToTank(new THREE.ShaderMaterial({
    uniforms: { tint: { value: new THREE.Color() }, peak: { value: 1 }, densityScale: { value: 1 } },
    vertexShader: `
      attribute vec2 normalCoordinate;
      varying vec2 u;
      void main() {
        u = normalCoordinate;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 tint;
      uniform float peak;
      uniform float densityScale;
      varying vec2 u;
      void main() {
        float density = peak * exp(-0.5 * dot(u, u));
        gl_FragColor = vec4(tint, 0.68 * density / (density + densityScale));
        #include <encodings_fragment>
      }
    `,
    transparent: true, side: THREE.DoubleSide, depthWrite: false,
  })));
  slice.renderOrder = 1.75;
  slice.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((tubeSegments + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const capIndices = [];
  const normalCoordinates = [0, 0];
  for (let i = 0; i < tubeSegments; i++) {
    const angle = 2 * Math.PI * i / tubeSegments;
    normalCoordinates.push(gaussian95Radius * Math.cos(angle), gaussian95Radius * Math.sin(angle));
    capIndices.push(0, i + 1, (i + 1) % tubeSegments + 1);
  }
  slice.geometry.setAttribute('normalCoordinate', new THREE.Float32BufferAttribute(normalCoordinates, 2));
  slice.geometry.setIndex(capIndices);
  group.add(slice);
  group.visible = false;
  const fromColor = new THREE.Color();
  const toColor = new THREE.Color();
  const tint = new THREE.Color();
  const point = new THREE.Vector3();
  let bridge;
  let project;

  function sectionAt(time) {
    const { mean, covariance } = bridge.marginalAt(time);
    return { mean, covariance, root: covarianceRoot(covariance) };
  }

  function pointAt({ mean, root }, angle, time) {
    const u = gaussian95Radius * Math.cos(angle);
    const v = gaussian95Radius * Math.sin(angle);
    const x = mean.x + root.a * u + root.b * v;
    const y = mean.y + root.b * u + root.d * v;
    return project(x, y, time, point);
  }

  function colorAt(time) {
    const mix = forward ? Math.max(0, 2 * time - 1) : Math.min(1, 2 * time);
    return tint.copy(fromColor).lerp(toColor, mix);
  }

  function writeRim(geometry, section, time, offset) {
    const positions = geometry.attributes.position;
    for (let i = 0; i < tubeSegments; i++) {
      pointAt(section, 2 * Math.PI * i / tubeSegments, time).toArray(positions.array, 3 * (offset + i));
    }
    positions.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  function setProgress(value) {
    if (!bridge) return;
    const time = THREE.MathUtils.clamp(value, 0, 1);
    wallMaterial.uniforms.progress.value = time;
    const section = sectionAt(time);
    project(section.mean.x, section.mean.y, time, point).toArray(slice.geometry.attributes.position.array, 0);
    writeRim(slice.geometry, section, time, 1);
    slice.material.uniforms.tint.value.copy(colorAt(time));
    slice.material.uniforms.peak.value = peakDensity(section.covariance);
  }

  function setBridge(model, projectPoint, startColor, endColor) {
    bridge = model;
    project = projectPoint;
    fromColor.set(startColor);
    toColor.set(endColor);
    // Both directions and all times share this density-to-opacity scale.
    const startPeak = peakDensity(model.marginalAt(0).covariance);
    const endPeak = peakDensity(model.marginalAt(1).covariance);
    slice.material.uniforms.densityScale.value = 0.30 * Math.sqrt(startPeak * endPeak);
    const coords = [];
    const colors = [];
    const times = [];
    const indices = [];
    for (let row = 0; row <= timeSteps; row++) {
      const time = row / timeSteps;
      const section = sectionAt(time);
      colorAt(time);
      for (let i = 0; i <= tubeSegments; i++) {
        const point = pointAt(section, 2 * Math.PI * i / tubeSegments, time);
        coords.push(point.x, point.y, point.z);
        colors.push(tint.r, tint.g, tint.b);
        times.push(time);
        if (row < timeSteps && i < tubeSegments) {
          const a = row * (tubeSegments + 1) + i;
          const b = a + tubeSegments + 1;
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    walls.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('time', new THREE.Float32BufferAttribute(times, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    walls.geometry = frontWalls.geometry = geometry;
    group.visible = true;
    setProgress(0);
  }

  return { setBridge, setProgress };
}

// Sample trajectories.
export function createBridgeTrajectories(scene, color) {
  const ink = new THREE.Color(color).lerp(new THREE.Color(0x193748), 0.55);
  const progress = { value: 0 };
  const viewport = new THREE.Vector2(1, 1);
  const lineMaterial = clipToTank(new THREE.ShaderMaterial({
    uniforms: { progress, ink: { value: ink }, viewport: { value: viewport } },
    vertexShader: `
      uniform vec2 viewport;
      attribute vec3 before;
      attribute vec3 after;
      attribute float side;
      attribute float time;
      varying float trailTime;
      vec2 screenDirection(vec3 delta) {
        // The orthographic camera maps a world-space segment to a pixel direction.
        vec2 v = (projectionMatrix * modelViewMatrix * vec4(delta, 0.0)).xy * viewport;
        return v / max(length(v), 0.00001);
      }
      void main() {
        trailTime = time;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec2 incoming = screenDirection(position - before);
        vec2 outgoing = screenDirection(after - position);
        vec2 tangent = incoming + outgoing;
        tangent = length(tangent) > 0.001 ? normalize(tangent) : outgoing;
        vec2 normal = vec2(-tangent.y, tangent.x);
        float miter = max(0.6, max(dot(incoming, tangent), dot(outgoing, tangent)));
        // A 1.5 CSS-pixel ribbon with a bounded join at sharp Brownian turns.
        gl_Position.xy += side * normal * 1.5 / (miter * viewport) * gl_Position.w;
      }
    `,
    fragmentShader: `
      uniform float progress;
      uniform vec3 ink;
      varying float trailTime;
      void main() {
        if (trailTime > progress) discard;
        gl_FragColor = vec4(ink, 0.90);
      }
    `,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  const beadGeometry = new THREE.SphereGeometry(0.045, 12, 8);
  const beadMaterial = clipToTank(new THREE.MeshBasicMaterial({
    color: ink, transparent: true, depthWrite: false,
  }));
  const current = new THREE.Vector3();
  const next = new THREE.Vector3();
  const translation = new THREE.Matrix4();
  const batches = new Map();

  function createBatch(steps, count) {
    const vertices = 2 * (steps + 1) * count;
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'before', 'after']) {
      const attribute = new THREE.BufferAttribute(new Float32Array(3 * vertices), 3);
      geometry.setAttribute(name, attribute.setUsage(THREE.DynamicDrawUsage));
    }
    const sides = new Float32Array(vertices);
    const times = new Float32Array(vertices);
    const IndexArray = vertices > 65535 ? Uint32Array : Uint16Array;
    const indices = new IndexArray(6 * steps * count);
    for (let path = 0; path < count; path++) {
      for (let i = 0; i <= steps; i++) {
        const a = 2 * (path * (steps + 1) + i);
        sides[a] = -1;
        sides[a + 1] = 1;
        times[a] = times[a + 1] = i / steps;
        if (i < steps) {
          // At each time step submit one segment per path, with independent joins.
          const j = 6 * (i * count + path);
          indices[j] = a;
          indices[j + 1] = a + 1;
          indices[j + 2] = a + 2;
          indices[j + 3] = a + 1;
          indices[j + 4] = a + 3;
          indices[j + 5] = a + 2;
        }
      }
    }
    geometry.setAttribute('side', new THREE.BufferAttribute(sides, 1));
    geometry.setAttribute('time', new THREE.BufferAttribute(times, 1));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const line = new THREE.Mesh(geometry, lineMaterial);
    line.frustumCulled = false;
    line.renderOrder = 1.25;
    const heads = new THREE.InstancedMesh(beadGeometry, beadMaterial, count);
    heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    heads.renderOrder = 5.5;
    scene.add(line, heads);
    return { line, heads };
  }

  function setPaths(paths, project) {
    // Paths on the same grid share one ribbon mesh and one instanced dot mesh.
    const pathsBySteps = new Map();
    for (const path of paths) {
      const steps = path.length - 1;
      if (!pathsBySteps.has(steps)) pathsBySteps.set(steps, []);
      pathsBySteps.get(steps).push(path);
    }
    for (const [steps, { line, heads }] of batches) {
      if (pathsBySteps.get(steps)?.length === heads.count) continue;
      scene.remove(line, heads);
      line.geometry.dispose();
      heads.dispose();
      batches.delete(steps);
    }
    for (const [steps, group] of pathsBySteps) {
      if (!batches.has(steps)) batches.set(steps, createBatch(steps, group.length));
      const { position, before, after } = batches.get(steps).line.geometry.attributes;
      const coords = position.array;
      for (const [pathIndex, path] of group.entries()) {
        // Each knot has two vertices for the two edges of its ribbon.
        const first = 6 * pathIndex * path.length;
        for (let i = 0; i <= steps; i++) {
          const offset = first + 6 * i;
          const point = project(path[i].x, path[i].y, i / steps, current);
          point.toArray(coords, offset);
          point.toArray(coords, offset + 3);
        }
        // Shift each path's positions by one knot to form the ribbon tangents.
        // Repeat the endpoint locally to keep adjacent paths disconnected.
        const last = first + 6 * steps;
        before.array.set(coords.subarray(first, first + 6), first);
        before.array.set(coords.subarray(first, last), first + 6);
        after.array.set(coords.subarray(first + 6, last + 6), first);
        after.array.set(coords.subarray(last, last + 6), last);
      }
      position.needsUpdate = before.needsUpdate = after.needsUpdate = true;
    }
    setProgress(0);
  }

  function setProgress(time, previewPaths = false) {
    progress.value = previewPaths ? 1 : time;
    for (const [steps, { line, heads }] of batches) {
      const step = time * steps;
      const i = Math.min(Math.floor(step), steps - 1);
      const coords = line.geometry.attributes.position.array;
      // Preview the whole ribbon with the dot at its start. During playback
      // the shader cuts the current segment at the dot's interpolated position.
      const visibleSteps = previewPaths ? steps : i + 1;
      line.geometry.setDrawRange(0, 6 * heads.count * visibleSteps);
      for (let path = 0; path < heads.count; path++) {
        const offset = 6 * (path * (steps + 1) + i);
        current.fromArray(coords, offset).lerp(next.fromArray(coords, offset + 6), step - i);
        translation.makeTranslation(current.x, current.y, current.z);
        heads.setMatrixAt(path, translation);
      }
      heads.instanceMatrix.needsUpdate = true;
    }
  }

  function setViewport(width, height) {
    viewport.set(width, height);
  }

  return { setPaths, setProgress, setViewport };
}

// Endpoint polar grids.
export function createGaussianPolarGrid(scene, mapToSurface, { height, opacity, renderOrder, ringColor, spokeColor }) {
  function makeMesh(color) {
    const material = new THREE.ShaderMaterial({
      uniforms: { tint: { value: new THREE.Color(color) }, opacity: { value: opacity } },
      vertexShader: `
        attribute float fade;
        varying float edgeFade;
        void main() {
          edgeFade = fade;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 tint;
        uniform float opacity;
        varying float edgeFade;
        void main() { gl_FragColor = vec4(tint, opacity * edgeFade); }
      `,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.renderOrder = renderOrder;
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  }

  const rings = makeMesh(ringColor);
  const spokes = makeMesh(spokeColor);
  const position = new THREE.Vector3();
  const normal = new THREE.Vector3();

  function setDistribution(cloud, scale, maxRadius) {
    const root = covarianceRoot(cloud.covariance);
    function build(mesh, curves) {
      const coords = [];
      const fades = [];
      const indices = [];
      for (const { pointAt, steps } of curves) {
        const start = coords.length / 3;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const center = pointAt(t);
          const before = pointAt(t - 0.0001);
          const after = pointAt(t + 0.0001);
          const dx = after.x - before.x;
          const dy = after.y - before.y;
          const width = 0.005 / (scale * Math.max(1e-12, Math.hypot(dx, dy)));
          for (const side of [-1, 1]) {
            const x = (center.x - cloud.x - side * dy * width) * scale;
            const z = -(center.y - cloud.y + side * dx * width) * scale;
            mapToSurface(x, z, height, position, normal, 0.004);
            position.toArray(coords, coords.length);
            // Thin and fade naturally as the grid turns onto the rounded shoulder.
            fades.push(Math.max(0.025, normal.y * normal.y));
          }
          if (i < steps) {
            const a = start + 2 * i;
            indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
          }
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
      geometry.setAttribute('fade', new THREE.Float32BufferAttribute(fades, 1));
      geometry.setIndex(indices);
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      mesh.visible = true;
    }
    const point = (u, v) => gaussianPoint(cloud.mean, root, u, v);
    const ringCurves = [];
    for (let radius = 1; radius <= maxRadius; radius++) {
      ringCurves.push({ steps: 192, pointAt: t => point(radius * Math.cos(2 * Math.PI * t), radius * Math.sin(2 * Math.PI * t)) });
    }
    build(rings, ringCurves);
    const spokeCurves = Array.from({ length: 8 }, (_, i) => {
      const angle = i * Math.PI / 4;
      return { steps: 64, pointAt: t => point(maxRadius * t * Math.cos(angle), maxRadius * t * Math.sin(angle)) };
    });
    for (const side of [-1, 1]) {
      spokeCurves.push({ steps: 16, pointAt: t => point(maxRadius - 0.22 * t, side * 0.13 * t) });
    }
    build(spokes, spokeCurves);
  }

  return { setDistribution };
}

// Hover guide geometry.
export const spiralGuideSegments = 120;

export function createSpiralGuideCurve(spiralPointAt, project, start, end) {
  const curve = new THREE.Curve();
  curve.getPoint = (t, out = new THREE.Vector3()) => {
    const point = spiralPointAt(t, start, end);
    return project(point.x, point.y, t, out);
  };
  return curve;
}

export function spiralGuideLength(curve) {
  // TubeGeometry uses these arc-length-spaced points for its centerline.
  const points = curve.getSpacedPoints(spiralGuideSegments);
  let length = 0;
  for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1]);
  return length;
}

// Complex-plane minimap.
const gridLines = 16;
const minimapSegments = 160;
const limit = 10;

export function createWPlaneMinimap(canvas) {
  const ctx = canvas.getContext('2d');
  let gamma = 0;

  function draw() {
    const size = canvas.clientWidth;
    if (!ctx || !size) return;
    const pixels = Math.round(size * (window.devicePixelRatio || 1));
    if (canvas.width !== pixels || canvas.height !== pixels) {
      canvas.width = canvas.height = pixels;
    }
    ctx.setTransform(pixels / size, 0, 0, pixels / size, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const left = 16;
    const top = 5;
    const side = size - left - top;
    const centerX = left + side / 2;
    const centerY = top + side / 2;
    const scale = side / (2 * limit);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, side, side);
    ctx.clip();
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = '#afc4ce';
    ctx.setLineDash([1, 2]);
    ctx.beginPath();
    for (let tick = -limit; tick <= limit; tick += 2.5) {
      ctx.moveTo(centerX + tick * scale, top);
      ctx.lineTo(centerX + tick * scale, top + side);
      ctx.moveTo(left, centerY - tick * scale);
      ctx.lineTo(left + side, centerY - tick * scale);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.lineWidth = 0.85;
    function drawFamily(fixedReal) {
      for (let i = 0; i < gridLines; i++) {
        const fraction = i / (gridLines - 1);
        const fixed = (2 * fraction - 1) * Math.PI;
        const lightness = 70 - 38 * fraction;
        ctx.strokeStyle = fixedReal ? `hsl(207 58% ${lightness}%)` : `hsl(8 58% ${lightness}%)`;
        ctx.beginPath();
        for (let j = 0; j <= minimapSegments; j++) {
          const varying = (2 * j / minimapSegments - 1) * Math.PI;
          const x = fixedReal ? fixed : varying;
          const y = fixedReal ? varying : fixed;
          // exp((1 + iγ)(x + iy)), with the panel's signed map parameter.
          const radius = Math.exp(x - gamma * y);
          const angle = y + gamma * x;
          const px = centerX + scale * radius * Math.cos(angle);
          const py = centerY - scale * radius * Math.sin(angle);
          if (j === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
    drawFamily(true);
    drawFamily(false);
    ctx.restore();

    ctx.strokeStyle = '#b7cad3';
    ctx.lineWidth = 0.6;
    ctx.strokeRect(left, top, side, side);
    ctx.fillStyle = '#526976';
    ctx.font = '9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Re(w)', centerX, size - 4);
    ctx.save();
    ctx.translate(10, centerY);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Im(w)', 0, 0);
    ctx.restore();
  }

  new ResizeObserver(draw).observe(canvas);
  function setGamma(value) {
    gamma = value;
    canvas.setAttribute('aria-description', gamma === 0
      ? 'Concentric circles and radial spokes at zero rotation.'
      : `Two families of logarithmic spirals at rotation ${gamma.toFixed(3)}.`);
    draw();
  }
  return { setGamma };
}

// Distribution tank and interactions.
const plotRadius = capHalfWidth * 0.96;
const polarRings = 4;
const initialYaw = 35 * Math.PI / 180;
const initialElevation = 35 * Math.PI / 180;
// Preserve the existing scale and base position while lowering the top cap.
const framingHalfHeight = 1.65;
const cameraTargetHeight = bottomHeight + framingHalfHeight;
const sunDirection = new THREE.Vector3(-0.5, 8, 3).normalize();

function roundedSquare(halfSize, radius) {
  const tangent = halfSize - radius;
  const shape = new THREE.Shape();
  shape.moveTo(tangent, -halfSize);
  shape.absarc(tangent, -tangent, radius, -Math.PI / 2, 0);
  shape.absarc(tangent, tangent, radius, 0, Math.PI / 2);
  shape.absarc(-tangent, tangent, radius, Math.PI / 2, Math.PI);
  shape.absarc(-tangent, -tangent, radius, Math.PI, 3 * Math.PI / 2);
  shape.closePath();
  return shape;
}

function addOutlineAndShadowReceiver(scene, body) {
  // Mark the glass silhouette so the outline and shadow only draw outside it.
  const mask = new THREE.Mesh(body, new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, stencilWrite: true,
    stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  }));
  scene.add(mask);

  const outsideTank = { stencilWrite: true, stencilRef: 0, stencilFunc: THREE.EqualStencilFunc };
  const outline = new THREE.Mesh(body, new THREE.MeshBasicMaterial({
    color: 0x668b9a, opacity: 0.58, transparent: true, depthWrite: false, ...outsideTank,
  }));
  const stroke = 0.012;
  outline.scale.set(1 + stroke / halfWidth, 1 + stroke / halfHeight, 1 + stroke / halfWidth);
  outline.position.y = centerHeight * (1 - outline.scale.y);
  scene.add(outline);

  const groundMaterial = new THREE.ShadowMaterial({
    color: 0x344854, opacity: 0.10, depthWrite: false,
    // Variance shadow maps also draw receivers. Cull the floor from the sun's view.
    shadowSide: THREE.BackSide,
    ...outsideTank,
  });
  groundMaterial.onBeforeCompile = shader => {
    shader.uniforms.footprint = { value: new THREE.Vector2(capHalfWidth, capCornerRadius) };
    shader.vertexShader = `varying vec2 groundPosition;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      groundPosition = (modelMatrix * vec4(transformed, 1.0)).xz;`
    );
    shader.fragmentShader = `
      varying vec2 groundPosition;
      uniform vec2 footprint;
      ${shader.fragmentShader}
    `.replace(
      'gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );',
      `// The glass transmits most light. Keep a tight contact shadow at the
      // rounded base, then let the much lighter cast shadow fade into the floor.
      vec2 q = abs(groundPosition) - vec2(footprint.x - footprint.y);
      float distanceToBase = max(0.0,
        length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - footprint.y);
      float contact = 0.24 * exp(-distanceToBase / 0.045);
      float castOpacity = opacity * (1.0 - getShadowMask()) * exp(-distanceToBase / 0.65);
      gl_FragColor = vec4(color, 1.0 - (1.0 - contact) * (1.0 - castOpacity));`
    );
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = bottomHeight - 0.006;
  ground.receiveShadow = true;
  ground.renderOrder = -1;
  scene.add(ground);
  return outline;
}

function makeSunGlint(body, sun) {
  // The rounded shoulder follows a quarter circle from the wall to the cap.
  // Its radial normal gives a continuous reflection across the bevel segments.
  const material = new THREE.ShaderMaterial({
    uniforms: {
      sun: { value: sun },
      shoulder: { value: topHeight - rimRadius },
      tangent: { value: capHalfWidth - capCornerRadius },
      cornerRadius: { value: capCornerRadius },
    },
    vertexShader: `
      varying vec3 surface;
      void main() {
        surface = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 sun;
      uniform float shoulder, tangent, cornerRadius;
      varying vec3 surface;
      void main() {
        float rise = surface.y - shoulder;
        if (rise <= 0.0) discard;
        vec2 radial = surface.xz - clamp(surface.xz, vec2(-tangent), vec2(tangent));
        radial *= max(0.0, 1.0 - cornerRadius / max(length(radial), 0.0001));
        vec3 normal = normalize(vec3(radial.x, rise, radial.y));
        // The orthographic camera has a single view direction for the whole surface.
        vec3 towardsEye = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        float alignment = max(dot(normal, normalize(sun + towardsEye)), 0.0);
        float halo = pow(alignment, 18.0);
        float core = pow(alignment, 140.0);
        gl_FragColor = vec4(vec3(1.0), 0.50 * halo + 0.50 * core);
      }
    `,
    transparent: true, depthWrite: false,
  });
  const glint = new THREE.Mesh(body, material);
  glint.renderOrder = 4; // Top samples remain visible over the sunlit rim.
  return glint;
}

export function createTankGeometry() {
  const shoulderHeight = halfHeight - rimRadius;
  const cap = roundedSquare(capHalfWidth, capCornerRadius);
  const body = new THREE.ExtrudeGeometry(cap, {
    depth: 2 * shoulderHeight,
    curveSegments: 12,
    bevelEnabled: true,
    bevelThickness: rimRadius,
    bevelSize: rimRadius,
    bevelSegments: 10,
  });
  body.rotateX(-Math.PI / 2);
  body.translate(0, bottomHeight + rimRadius, 0);
  return body;
}

function makeTank(scene) {
  const sun = sunDirection.clone();
  const body = createTankGeometry();
  const glass = new THREE.MeshPhongMaterial({
    color: 0x9bcedb, specular: 0xffffff, shininess: 36,
    opacity: 0.23, transparent: true, side: THREE.DoubleSide, depthWrite: false,
  });
  const tank = new THREE.Mesh(body, glass);
  tank.castShadow = true;
  scene.add(tank);
  scene.add(makeSunGlint(body, sun));
  const outline = addOutlineAndShadowReceiver(scene, body);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x94b5c0, 0.85));
  const light = new THREE.DirectionalLight(0xffffff, 0.85);
  light.position.copy(sun).multiplyScalar(8);
  light.castShadow = true;
  light.shadow.camera.left = light.shadow.camera.bottom = -3;
  light.shadow.camera.right = light.shadow.camera.top = 3;
  light.shadow.camera.near = 4;
  light.shadow.camera.far = 12;
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.mapSize.set(512, 512);
  light.shadow.radius = 12;
  light.shadow.blurSamples = 12;
  light.shadow.bias = -0.0005;
  scene.add(light);
  return { tank, outline, light, sun };
}

function makePoints(scene, color, ring = false) {
  const material = new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide, transparent: true, depthWrite: false,
  });
  const geometry = ring ? new THREE.RingGeometry(0.072, 0.108, 32) : new THREE.CircleGeometry(0.033, 20);
  const points = new THREE.InstancedMesh(geometry, material, 1);
  points.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  points.renderOrder = ring ? 6 : 5;
  points.visible = false;
  points.frustumCulled = false;
  scene.add(points);
  return points;
}

function reserveInstances(mesh, count) {
  if (mesh.instanceMatrix.count >= count) return;
  mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(count * 16), 16);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
}

export function mapToTankSurface(x, z, height, position, normal, offset = 0.008) {
  const tangent = capHalfWidth - capCornerRadius;
  const cx = THREE.MathUtils.clamp(x, -tangent, tangent);
  const cz = THREE.MathUtils.clamp(z, -tangent, tangent);
  const dx = x - cx;
  const dz = z - cz;
  const distance = Math.hypot(dx, dz);
  const excess = distance - capCornerRadius;
  position.set(x, height + offset, z);
  normal.set(0, 1, 0);
  if (excess > 0) {
    // Unit arc speed at the join preserves the flat face's tangent. The
    // asymptote keeps every finite outlier on the shoulder without clamping.
    const side = height > centerHeight ? 1 : -1;
    const shoulderRadius = rimRadius + side * offset;
    const angle = Math.PI / 2 * Math.tanh(excess / (shoulderRadius * Math.PI / 2));
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const radius = capCornerRadius + shoulderRadius * sin;
    position.set(cx + radius * dx / distance, height - side * rimRadius + side * shoulderRadius * cos, cz + radius * dz / distance);
    normal.set(side * sin * dx / distance, cos, side * sin * dz / distance);
  }
}

export function createDistributionTank(canvas, { color, ringColor, spokeColor, forward }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.setClearColor(0xffffff, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
  const { tank, outline, light, sun } = makeTank(scene);
  const tube = createGaussianTube(scene, { forward });
  const trajectories = createBridgeTrajectories(scene, color);
  let previewPaths = true;
  const topGrid = createGaussianPolarGrid(scene, mapToTankSurface, {
    height: topHeight, opacity: 0.78, renderOrder: 3, ringColor, spokeColor,
  });
  const bottomGrid = createGaussianPolarGrid(scene, mapToTankSurface, {
    height: bottomHeight, opacity: 0.48, renderOrder: 1, ringColor, spokeColor,
  });
  const samples = makePoints(scene, color);
  const floorSamples = makePoints(scene, 0xffffff);
  floorSamples.material.opacity = 0.65;
  floorSamples.renderOrder = 2;
  const floorGray = new THREE.Color(0x8b8e91);
  const layers = [samples, floorSamples];
  const matchColor = 0x244f73;
  const anchorRings = layers.map(() => makePoints(scene, matchColor, true));
  for (const ring of anchorRings) ring.material.opacity = 0.7;
  const topRing = makePoints(scene, matchColor, true);
  const floorRing = makePoints(scene, matchColor, true);
  topRing.renderOrder = floorRing.renderOrder = 7;
  // A guide may choose a candidate outside the 128 displayed cap samples.
  const hoverDots = layers.map(layer => {
    const dot = makePoints(scene, layer.material.color);
    dot.renderOrder = layer.renderOrder;
    return dot;
  });
  const guide = new THREE.Mesh(new THREE.BufferGeometry(), clipToTank(new THREE.MeshBasicMaterial({
    color: matchColor, transparent: true, opacity: 0.92, depthWrite: false,
  })));
  guide.renderOrder = 5.75;
  guide.visible = false;
  scene.add(guide);
  let pairing = null;
  let endpointPairs = null;
  let endpointScale = 0;

  let yaw = initialYaw;
  let elevation = initialElevation;
  let cameraSunDirection = null;
  let selected = -1;
  let selectedLayer = null;
  let selectedPair = null;
  let pinned = null;
  let drag = null;
  let hovered = false;
  let emphasized = false;
  const figure = canvas.closest('.distribution-figure');
  const demo = figure?.closest('.distribution-demo');
  const axisLabels = Array.from(canvas.parentElement.querySelectorAll('[data-tank-axis]'),
    element => ({ element, width: 0, height: 0 }));
  const axisStart = new THREE.Vector3();
  const axisEnd = new THREE.Vector3();
  const capCenter = new THREE.Vector3();
  let viewportWidth = 0, viewportHeight = 0;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const hits = [];
  const projected = new THREE.Vector3();
  const instanceMatrix = new THREE.Matrix4();
  const surfacePosition = new THREE.Vector3();
  const surfaceNormal = new THREE.Vector3();
  const discNormal = new THREE.Vector3(0, 0, 1);
  const surfaceRotation = new THREE.Quaternion();
  const unitScale = new THREE.Vector3(1, 1, 1);
  const markerScale = new THREE.Vector3(0.7, 0.7, 0.7);

  function draw() {
    renderer.render(scene, camera);
    if (!viewportWidth || !viewportHeight) return;
    // Keep a screen-space gap outside the rim, including in overhead views.
    capCenter.set(0, topHeight, 0).project(camera);
    const centerX = (1 + capCenter.x) * viewportWidth / 2;
    const centerY = (1 - capCenter.y) * viewportHeight / 2;
    const farX = -(Math.sign(camera.position.x) || 1) * halfWidth;
    const farZ = -(Math.sign(camera.position.z) || 1) * halfWidth;
    for (const { element: label, width, height } of axisLabels) {
      if (label.dataset.tankAxis === 'position') {
        axisStart.set(-0.5, topHeight, farZ);
        axisEnd.set(0.5, topHeight, farZ);
      } else {
        axisStart.set(farX, topHeight, -0.5);
        axisEnd.set(farX, topHeight, 0.5);
      }
      axisStart.project(camera);
      axisEnd.project(camera);
      let x = (1 + (axisStart.x + axisEnd.x) / 2) * viewportWidth / 2;
      let y = (1 - (axisStart.y + axisEnd.y) / 2) * viewportHeight / 2;
      const dx = (axisEnd.x - axisStart.x) * viewportWidth;
      const dy = -(axisEnd.y - axisStart.y) * viewportHeight;
      const length = Math.hypot(dx, dy);
      let nx = -dy / length, ny = dx / length;
      if (nx * (x - centerX) + ny * (y - centerY) < 0) { nx = -nx; ny = -ny; }
      // Center horizontal labels above shallow edges and beside steep edges.
      // Account for the full text box when keeping it clear of the rim.
      const clearance = 12 + (width * Math.abs(nx) + height * Math.abs(ny)) / 2;
      if (Math.abs(dx) > 1.3 * Math.abs(dy)) y += clearance / ny;
      else x += clearance / nx;
      label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      label.style.visibility = 'visible';
    }
  }

  function updateInteraction() {
    const active = hovered || drag !== null || canvas.matches(':focus-visible');
    if (active === emphasized) return;
    emphasized = active;
    // Expand only the stencil-masked exterior stroke; the glass stays the same size.
    const stroke = active ? 0.030 : 0.012;
    outline.scale.set(1 + stroke / halfWidth, 1 + stroke / halfHeight, 1 + stroke / halfWidth);
    outline.position.y = centerHeight * (1 - outline.scale.y);
    outline.material.opacity = active ? 0.85 : 0.58;
    figure?.classList.toggle('is-interacting', active);
    draw();
  }

  function updateHover(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(2 * (event.clientX - rect.left) / rect.width - 1,
      1 - 2 * (event.clientY - rect.top) / rect.height);
    raycaster.setFromCamera(pointer, camera);
    hits.length = 0;
    raycaster.intersectObject(tank, false, hits);
    hovered = hits.length > 0;
    updateInteraction();
  }

  function orbit() {
    camera.position.set(
      9 * Math.cos(elevation) * Math.sin(yaw),
      cameraTargetHeight + 9 * Math.sin(elevation),
      9 * Math.cos(elevation) * Math.cos(yaw)
    );
    camera.lookAt(0, cameraTargetHeight, 0);
    // Keep the sun in the same place relative to the view. The glint and the
    // shadow-casting light share this direction independently in each plot.
    if (!cameraSunDirection) {
      cameraSunDirection = sun.clone().applyQuaternion(camera.quaternion.clone().invert());
    }
    sun.copy(cameraSunDirection).applyQuaternion(camera.quaternion);
    light.position.copy(sun).multiplyScalar(8);
    renderer.shadowMap.needsUpdate = true;
    draw();
  }

  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    viewportWidth = width;
    viewportHeight = height;
    for (const label of axisLabels) {
      label.width = label.element.offsetWidth;
      label.height = label.element.offsetHeight;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    trajectories.setViewport(width, height);
    const aspect = width / height;
    // Keep the previous framing so shortening the tank does not enlarge it
    // or move its bottom, including on tall phone viewports.
    const halfDiagonal = Math.SQRT2 * halfWidth;
    const halfView = 1.10 * Math.max(Math.hypot(framingHalfHeight, halfDiagonal), halfDiagonal / aspect);
    camera.top = halfView;
    camera.bottom = -halfView;
    camera.right = halfView * aspect;
    camera.left = -camera.right;
    camera.updateProjectionMatrix();
    draw();
  }

  function capPointMatrix(point, cloud, height, scale) {
    const x = (point.x - cloud.x) * scale;
    const z = -(point.y - cloud.y) * scale;
    mapToTankSurface(x, z, height, surfacePosition, surfaceNormal);
    surfaceRotation.setFromUnitVectors(discNormal, surfaceNormal);
    instanceMatrix.compose(surfacePosition, surfaceRotation, unitScale);
  }

  function markEndpoint(ring, dot, layer, index, point) {
    ring.visible = !!point;
    dot.visible = ring.visible && index < 0;
    if (!ring.visible) return;
    if (index >= 0) layer.getMatrixAt(index, instanceMatrix);
    else capPointMatrix(point, layer.userData.cloud, layer === samples ? topHeight : bottomHeight, endpointScale);
    ring.setMatrixAt(0, instanceMatrix);
    ring.instanceMatrix.needsUpdate = true;
    if (dot.visible) {
      dot.material.color.copy(layer.material.color);
      dot.material.opacity = layer.material.opacity;
      dot.setMatrixAt(0, instanceMatrix);
      dot.instanceMatrix.needsUpdate = true;
    }
  }

  function select(index, layer = null, refresh = false) {
    if (!refresh && index === selected && layer === selectedLayer) return;
    selected = index;
    selectedLayer = layer;
    const onPin = pinned && layer && index === (layer === samples ? pinned.sourceIndex : pinned.targetIndex);
    const pair = onPin ? pinned : layer && (layer.userData.animatedPairs.get(index) ?? pairing?.matchBackground?.(layer === samples, index));
    selectedPair = pair;
    const start = pair?.sourcePoint ?? samples.userData.cloud?.points[pair?.sourceIndex];
    const end = pair?.targetPoint ?? floorSamples.userData.cloud?.points[pair?.targetIndex];
    markEndpoint(topRing, hoverDots[0], samples, pair?.sourceIndex ?? -1, start);
    markEndpoint(floorRing, hoverDots[1], floorSamples, pair?.targetIndex ?? -1, end);
    guide.visible = !!pairing && topRing.visible && floorRing.visible;
    if (guide.visible) {
      // The cap discs, the bridge, and this full-time guide share one projection.
      const curve = pairing.curveBetween(start, end);
      guide.geometry.dispose();
      guide.geometry = new THREE.TubeGeometry(curve, spiralGuideSegments, 0.013, 6, false);
    }
    if (!refresh) draw();
  }

  function restorePin(refresh = false) {
    const index = pinned ? (pinned.layer === samples ? pinned.sourceIndex : pinned.targetIndex) : -1;
    select(index, pinned?.layer ?? null, refresh);
  }

  function clearSelection() {
    pinned = null;
    select(-1);
  }

  function pick(event, pin = false) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let closest = -1;
    let closestLayer = null;
    let bestDistance = event.pointerType === 'touch' ? 15 : 8;
    for (const layer of layers) {
      if (!layer.visible) continue;
      const positions = layer.userData.positions;
      for (let i = 0; i < positions.count; i++) {
        projected.fromBufferAttribute(positions, i).project(camera);
        const dx = (projected.x + 1) * rect.width / 2 - x;
        const dy = (1 - projected.y) * rect.height / 2 - y;
        // The outlined endpoints have a slightly larger pick area. A pointer
        // directly over an unpaired dot still selects that dot and its match.
        const distance = Math.hypot(dx, dy) * (layer.userData.animatedPairs.has(i) ? 0.8 : 1);
        if (distance < bestDistance) {
          closest = i;
          closestLayer = layer;
          bestDistance = distance;
        }
      }
    }
    if (closestLayer) {
      select(closest, closestLayer);
      if (pin && selectedPair) pinned = { ...selectedPair, layer: closestLayer };
    } else if (pin) clearSelection();
    else restorePin();
  }

  canvas.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw, elevation, moved: false };
    canvas.setPointerCapture(event.pointerId);
    updateInteraction();
  });
  canvas.addEventListener('pointerenter', event => {
    if (event.pointerType !== 'touch' && !drag) {
      updateHover(event);
      pick(event);
    }
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag) {
      if (event.pointerType !== 'touch') {
        updateHover(event);
        pick(event);
      }
      return;
    }
    if (event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (event.pointerType === 'touch' && !drag.moved && Math.abs(dy) > Math.abs(dx)) return;
    if (!drag.moved) restorePin();
    drag.moved = true;
    yaw = drag.yaw - dx * 0.012;
    if (event.pointerType !== 'touch') {
      elevation = THREE.MathUtils.clamp(drag.elevation + dy * 0.008, 0.15, 1.42);
    }
    orbit();
  });
  canvas.addEventListener('pointerup', event => {
    if (drag?.id !== event.pointerId) return;
    if (!drag.moved) pick(event, true);
    drag = null;
    if (event.pointerType !== 'touch') updateHover(event);
    else {
      hovered = false;
      updateInteraction();
    }
  });
  function cancelDrag(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    hovered = false;
    restorePin();
    updateInteraction();
  }
  canvas.addEventListener('pointercancel', cancelDrag);
  canvas.addEventListener('lostpointercapture', cancelDrag);
  canvas.addEventListener('pointerleave', event => {
    hovered = false;
    updateInteraction();
    if (!drag && event.pointerType !== 'touch') restorePin();
  });
  canvas.addEventListener('focus', updateInteraction);
  canvas.addEventListener('blur', event => {
    if (event.relatedTarget && !demo?.contains(event.relatedTarget)) clearSelection();
    else restorePin();
    updateInteraction();
  });
  // Keep the conditioning pair while inspecting the slice or scrubbing time.
  canvas.ownerDocument.addEventListener('pointerdown', event => {
    if (!demo?.contains(event.target)) clearSelection();
  });

  function resetView() {
    if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
    drag = null;
    hovered = false;
    yaw = initialYaw;
    elevation = initialElevation;
    clearSelection();
    updateInteraction();
    orbit();
  }

  canvas.addEventListener('keydown', event => {
    switch (event.key) {
      case 'Escape': clearSelection(); return;
      case 'ArrowLeft': yaw -= 0.13; break;
      case 'ArrowRight': yaw += 0.13; break;
      case 'ArrowUp': elevation = Math.min(1.42, elevation + 0.1); break;
      case 'ArrowDown': elevation = Math.max(0.15, elevation - 0.1); break;
      case 'Home':
        event.preventDefault();
        resetView();
        return;
      default: return;
    }
    event.preventDefault();
    updateInteraction();
    restorePin();
    orbit();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    renderer.shadowMap.needsUpdate = true;
    draw();
  });
  new ResizeObserver(resize).observe(canvas);
  orbit();
  resize();

  function updateLayer(layer, cloud, height, scale) {
    const coords = new Float32Array(cloud.points.length * 3);
    reserveInstances(layer, cloud.points.length);
    for (const [i, point] of cloud.points.entries()) {
      capPointMatrix(point, cloud, height, scale);
      layer.setMatrixAt(i, instanceMatrix);
      surfacePosition.toArray(coords, 3 * i);
    }
    layer.count = cloud.points.length;
    layer.instanceMatrix.needsUpdate = true;
    layer.userData.positions = new THREE.BufferAttribute(coords, 3);
    layer.userData.cloud = cloud;
    layer.visible = cloud.points.length > 0;
  }

  function markAnimatedPairs(layer, rings, pairs, key) {
    layer.userData.animatedPairs = new Map(pairs.map(pair => [pair[key], pair]));
    reserveInstances(rings, pairs.length);
    for (const [i, pair] of pairs.entries()) {
      layer.getMatrixAt(pair[key], instanceMatrix);
      rings.setMatrixAt(i, instanceMatrix.scale(markerScale));
    }
    rings.count = pairs.length;
    rings.instanceMatrix.needsUpdate = true;
    rings.visible = pairs.length > 0;
  }

  function setSamples(topCloud, floorCloud, visiblePairs, viewRadius, bridge, paths, time = 0, spiralPointAt, createBackgroundMatcher) {
    const scale = plotRadius / viewRadius;
    function project(x, y, time, position) {
      const plotX = (x - THREE.MathUtils.lerp(topCloud.x, floorCloud.x, time)) * scale;
      const plotZ = -(y - THREE.MathUtils.lerp(topCloud.y, floorCloud.y, time)) * scale;
      const height = THREE.MathUtils.lerp(topHeight, bottomHeight, time);
      position.set(plotX, height, plotZ);
      const depth = Math.min(topHeight - height, height - bottomHeight);
      if (depth < rimRadius) {
        // Join the endpoint discs on the rounded cap. The discs have a small
        // surface offset for rendering, while the bridge ends on the glass.
        const capHeight = height > centerHeight ? topHeight : bottomHeight;
        mapToTankSurface(position.x, position.z, capHeight, surfacePosition, surfaceNormal, 0);
        surfacePosition.y += height - capHeight;
        position.lerp(surfacePosition, 1 - THREE.MathUtils.smoothstep(depth, 0, rimRadius));
      }
      return position;
    }
    // Only a new draw changes the caps. A γ update keeps every endpoint index.
    if (topCloud !== samples.userData.cloud || floorCloud !== floorSamples.userData.cloud ||
        visiblePairs !== endpointPairs || scale !== endpointScale) {
      topGrid.setDistribution(topCloud, scale, polarRings);
      bottomGrid.setDistribution(floorCloud, scale, polarRings);
      floorSamples.material.color.set(floorCloud.color).lerp(floorGray, 0.46);
      updateLayer(samples, topCloud, topHeight, scale);
      updateLayer(floorSamples, floorCloud, bottomHeight, scale);
      markAnimatedPairs(samples, anchorRings[0], visiblePairs, 'sourceIndex');
      markAnimatedPairs(floorSamples, anchorRings[1], visiblePairs, 'targetIndex');
      endpointPairs = visiblePairs;
      endpointScale = scale;
      pinned = null;
      select(-1, null, true);
    }
    tube.setBridge(bridge, project, topCloud.color, floorCloud.color);
    trajectories.setPaths(paths, project);
    const curveBetween = (start, end) => createSpiralGuideCurve(spiralPointAt, project, start, end);
    pairing = spiralPointAt ? { curveBetween,
      matchBackground: createBackgroundMatcher?.((start, end) => spiralGuideLength(curveBetween(start, end))) } : null;
    // Pin the hovered origin; a new γ can change its shortest counterpart.
    if (pinned && !pinned.layer.userData.animatedPairs.has(
      pinned.layer === samples ? pinned.sourceIndex : pinned.targetIndex)) {
      const sourceSide = pinned.layer === samples;
      const pair = pairing?.matchBackground?.(sourceSide, sourceSide ? pinned.sourceIndex : pinned.targetIndex);
      pinned = pair ? { ...pair, layer: pinned.layer } : null;
    }
    if (selectedLayer) select(selected, selectedLayer, true);
    // A rotation change rebuilds the paths at the current playback state.
    setProgress(time, previewPaths);
  }
  function setProgress(time, showFullPaths = false) {
    previewPaths = showFullPaths;
    tube.setProgress(time);
    trajectories.setProgress(time, previewPaths);
    draw();
  }
  return { setSamples, setProgress, resetView };
}
