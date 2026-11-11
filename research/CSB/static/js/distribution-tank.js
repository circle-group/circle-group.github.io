import * as THREE from './vendor/three.module.min.js';
import { createBridgeTrajectories } from './bridge-trajectories.js';
import { createGaussianTube } from './gaussian-tube.js';
import { covarianceRoot, gaussianPolar } from './gaussian-coordinates.js';
import { createGaussianPolarGrid } from './gaussian-polar-grid.js';
import { halfWidth, halfHeight, rimRadius, capHalfWidth, capCornerRadius, clipToTank } from './tank-clip.js';

const plotRadius = capHalfWidth * 0.96;
const polarRings = 4;
const initialYaw = 35 * Math.PI / 180;
const initialElevation = 35 * Math.PI / 180;
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
  ground.position.y = -halfHeight - 0.006;
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
      shoulder: { value: halfHeight - rimRadius },
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

function makeTank(scene) {
  const sun = sunDirection.clone();
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
  body.translate(0, -shoulderHeight, 0);
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

function mapToTankSurface(x, z, height, position, normal, offset = 0.008) {
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
    const side = Math.sign(height);
    const shoulderRadius = rimRadius + side * offset;
    const angle = Math.PI / 2 * Math.tanh(excess / (shoulderRadius * Math.PI / 2));
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const radius = capCornerRadius + shoulderRadius * sin;
    position.set(cx + radius * dx / distance, side * (halfHeight - rimRadius + shoulderRadius * cos), cz + radius * dz / distance);
    normal.set(side * sin * dx / distance, cos, side * sin * dz / distance);
  }
}

export function createDistributionTank(canvas, { color, ringColor, spokeColor, readout, forward }) {
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
    height: halfHeight, opacity: 0.78, renderOrder: 3, ringColor, spokeColor,
  });
  const bottomGrid = createGaussianPolarGrid(scene, mapToTankSurface, {
    height: -halfHeight, opacity: 0.48, renderOrder: 1, ringColor, spokeColor,
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
  }

  function updateInteraction() {
    const active = hovered || drag !== null || canvas.matches(':focus-visible');
    if (active === emphasized) return;
    emphasized = active;
    // Expand only the stencil-masked exterior stroke; the glass stays the same size.
    const stroke = active ? 0.030 : 0.012;
    outline.scale.set(1 + stroke / halfWidth, 1 + stroke / halfHeight, 1 + stroke / halfWidth);
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
      9 * Math.sin(elevation),
      9 * Math.cos(elevation) * Math.cos(yaw)
    );
    camera.lookAt(0, 0, 0);
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    trajectories.setViewport(width, height);
    const aspect = width / height;
    // Fit the full cage at any orbit angle, including tall phone viewports.
    const halfDiagonal = Math.SQRT2 * halfWidth;
    const halfView = 1.10 * Math.max(Math.hypot(halfHeight, halfDiagonal), halfDiagonal / aspect);
    camera.top = halfView;
    camera.bottom = -halfView;
    camera.right = halfView * aspect;
    camera.left = -camera.right;
    camera.updateProjectionMatrix();
    draw();
  }

  function markEndpoint(ring, layer, index) {
    ring.visible = index >= 0 && index < layer.count;
    if (!ring.visible) return;
    layer.getMatrixAt(index, instanceMatrix);
    ring.setMatrixAt(0, instanceMatrix);
    ring.instanceMatrix.needsUpdate = true;
  }

  function select(index, layer = null, refresh = false) {
    if (!refresh && index === selected && layer === selectedLayer) return;
    selected = index;
    selectedLayer = layer;
    const onPin = pinned && layer && index === (layer === samples ? pinned.sourceIndex : pinned.targetIndex);
    const pair = onPin ? pinned : layer && (layer.userData.animatedPairs.get(index) ?? pairing?.matchBackground?.(layer === samples, index));
    selectedPair = pair;
    markEndpoint(topRing, samples, pair?.sourceIndex ?? -1);
    markEndpoint(floorRing, floorSamples, pair?.targetIndex ?? -1);
    guide.visible = !!pairing && topRing.visible && floorRing.visible;
    if (guide.visible) {
      const start = samples.userData.cloud.points[pair.sourceIndex];
      const end = floorSamples.userData.cloud.points[pair.targetIndex];
      const { project, spiralPointAt } = pairing;
      // The cap discs, the bridge, and this full-time guide share one projection.
      const curve = new THREE.Curve();
      curve.getPoint = (t, out = new THREE.Vector3()) => {
        const point = spiralPointAt(t, start, end);
        return project(point.x, point.y, t, out);
      };
      guide.geometry.dispose();
      guide.geometry = new THREE.TubeGeometry(curve, 120, 0.013, 6, false);
    }
    if (index >= 0) {
      const cloud = layer.userData.cloud;
      const polar = gaussianPolar(cloud.points[index], cloud.mean, layer.userData.root);
      const degrees = Math.round(polar.angle * 180 / Math.PI) % 360;
      readout.textContent = `r = ${polar.radius.toFixed(2)} · θ = ${degrees}°`;
    } else {
      readout.textContent = '';
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
      const x = (point.x - cloud.x) * scale;
      const z = -(point.y - cloud.y) * scale;
      mapToTankSurface(x, z, height, surfacePosition, surfaceNormal);
      surfaceRotation.setFromUnitVectors(discNormal, surfaceNormal);
      instanceMatrix.compose(surfacePosition, surfaceRotation, unitScale);
      layer.setMatrixAt(i, instanceMatrix);
      surfacePosition.toArray(coords, 3 * i);
    }
    layer.count = cloud.points.length;
    layer.instanceMatrix.needsUpdate = true;
    layer.userData.positions = new THREE.BufferAttribute(coords, 3);
    layer.userData.cloud = cloud;
    layer.userData.root = covarianceRoot(cloud.covariance);
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

  function setSamples(topCloud, floorCloud, visiblePairs, viewRadius, bridge, paths, time = 0, spiralPointAt, matchBackground, beforeRotation) {
    const scale = plotRadius / viewRadius;
    function project(x, y, time, position) {
      const plotX = (x - THREE.MathUtils.lerp(topCloud.x, floorCloud.x, time)) * scale;
      const plotZ = -(y - THREE.MathUtils.lerp(topCloud.y, floorCloud.y, time)) * scale;
      const height = halfHeight * (1 - 2 * time);
      position.set(plotX, height, plotZ);
      const depth = halfHeight - Math.abs(height);
      if (depth < rimRadius) {
        // Join the endpoint discs on the rounded cap. The discs have a small
        // surface offset for rendering, while the bridge ends on the glass.
        const capHeight = Math.sign(height) * halfHeight;
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
      updateLayer(samples, topCloud, halfHeight, scale);
      updateLayer(floorSamples, floorCloud, -halfHeight, scale);
      markAnimatedPairs(samples, anchorRings[0], visiblePairs, 'sourceIndex');
      markAnimatedPairs(floorSamples, anchorRings[1], visiblePairs, 'targetIndex');
      endpointPairs = visiblePairs;
      endpointScale = scale;
      pinned = null;
      select(-1, null, true);
    }
    tube.setBridge(bridge, project, topCloud.color, floorCloud.color, beforeRotation);
    trajectories.setPaths(paths, project);
    pairing = spiralPointAt ? { project, spiralPointAt, matchBackground } : null;
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
