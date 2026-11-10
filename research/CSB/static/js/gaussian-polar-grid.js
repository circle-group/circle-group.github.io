import * as THREE from './vendor/three.module.min.js';
import { covarianceRoot, gaussianPoint } from './gaussian-coordinates.js';

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
