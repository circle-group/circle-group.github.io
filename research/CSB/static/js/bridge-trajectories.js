import * as THREE from './vendor/three.module.min.js';
import { clipToTank } from './tank-clip.js';

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

  function setProgress(time) {
    progress.value = time;
    for (const [steps, { line, heads }] of batches) {
      const step = time * steps;
      const i = Math.min(Math.floor(step), steps - 1);
      const coords = line.geometry.attributes.position.array;
      // The shader cuts all current segments at the same fraction as the dots.
      line.geometry.setDrawRange(0, 6 * heads.count * (i + 1));
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
