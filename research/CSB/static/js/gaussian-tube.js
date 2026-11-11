import * as THREE from './vendor/three.module.min.js';
import { covarianceRoot, gaussian95Radius } from './gaussian-coordinates.js';
import { clipToTank } from './tank-clip.js';

const segments = 80;
const timeSteps = 80;

function peakDensity({ xx, xy, yy }) {
  return 1 / (2 * Math.PI * Math.sqrt(xx * yy - xy * xy));
}

function sameMarginal(a, b) {
  const s = a.covariance, q = b.covariance;
  const variance = Math.max(s.xx, s.yy, q.xx, q.yy);
  return Math.hypot(a.mean.x - b.mean.x, a.mean.y - b.mean.y) <= 1e-8 * Math.sqrt(variance)
    && Math.max(Math.abs(s.xx - q.xx), Math.abs(s.xy - q.xy), Math.abs(s.yy - q.yy)) <= 1e-8 * variance;
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
  slice.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((segments + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const capIndices = [];
  const normalCoordinates = [0, 0];
  for (let i = 0; i < segments; i++) {
    const angle = 2 * Math.PI * i / segments;
    normalCoordinates.push(gaussian95Radius * Math.cos(angle), gaussian95Radius * Math.sin(angle));
    capIndices.push(0, i + 1, (i + 1) % segments + 1);
  }
  slice.geometry.setAttribute('normalCoordinate', new THREE.Float32BufferAttribute(normalCoordinates, 2));
  slice.geometry.setIndex(capIndices);
  const referenceRim = new THREE.LineLoop(new THREE.BufferGeometry(), clipToTank(new THREE.LineBasicMaterial({
    color: 0x617681, opacity: 0.82, transparent: true, depthWrite: false,
  })));
  referenceRim.renderOrder = 1.85;
  referenceRim.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segments * 3), 3).setUsage(THREE.DynamicDrawUsage));
  group.add(slice, referenceRim);
  group.visible = false;
  const fromColor = new THREE.Color();
  const toColor = new THREE.Color();
  const tint = new THREE.Color();
  const point = new THREE.Vector3();
  let bridge;
  let reference;
  let project;

  function sectionAt(time, model = bridge) {
    const { mean, covariance } = model.marginalAt(time);
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
    for (let i = 0; i < segments; i++) {
      pointAt(section, 2 * Math.PI * i / segments, time).toArray(positions.array, 3 * (offset + i));
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
    const before = reference && time > 0 && time < 1 ? sectionAt(time, reference) : null;
    referenceRim.visible = !!before && !sameMarginal(before, section);
    if (referenceRim.visible) writeRim(referenceRim.geometry, before, time, 0);
  }

  function setBridge(model, projectPoint, startColor, endColor, referenceModel = null) {
    bridge = model;
    reference = referenceModel;
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
      for (let i = 0; i <= segments; i++) {
        const point = pointAt(section, 2 * Math.PI * i / segments, time);
        coords.push(point.x, point.y, point.z);
        colors.push(tint.r, tint.g, tint.b);
        times.push(time);
        if (row < timeSteps && i < segments) {
          const a = row * (segments + 1) + i;
          const b = a + segments + 1;
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
