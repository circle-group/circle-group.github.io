import * as THREE from './vendor/three.module.min.js';
import { covarianceRoot, gaussian95Radius } from './gaussian-coordinates.js';
import { clipToTank } from './tank-clip.js';

const segments = 80;
const timeSteps = 80;

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

  const slice = new THREE.Mesh(new THREE.BufferGeometry(), clipToTank(new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false,
  })));
  slice.renderOrder = 1.75;
  slice.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((segments + 1) * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const capIndices = [];
  for (let i = 0; i < segments; i++) capIndices.push(0, i + 1, (i + 1) % segments + 1);
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
    return { mean, root: covarianceRoot(covariance) };
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

  function setProgress(value) {
    if (!bridge) return;
    const time = THREE.MathUtils.clamp(value, 0, 1);
    wallMaterial.uniforms.progress.value = time;
    slice.visible = time > 0 && time < 1;
    if (!slice.visible) return;
    const section = sectionAt(time);
    const attribute = slice.geometry.attributes.position;
    const coords = attribute.array;
    coords[0] = coords[1] = coords[2] = 0;
    for (let i = 0; i < segments; i++) {
      const point = pointAt(section, 2 * Math.PI * i / segments, time);
      point.toArray(coords, (i + 1) * 3);
      coords[0] += point.x / segments;
      coords[1] += point.y / segments;
      coords[2] += point.z / segments;
    }
    attribute.needsUpdate = true;
    slice.geometry.computeBoundingSphere();
    slice.material.color.copy(colorAt(time));
  }

  function setBridge(model, projectPoint, startColor, endColor) {
    bridge = model;
    project = projectPoint;
    fromColor.set(startColor);
    toColor.set(endColor);
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
