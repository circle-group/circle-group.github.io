import * as THREE from './vendor/three.module.min.js';

export const halfWidth = 1;
export const halfHeight = 1.65;
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
      float cap = max(abs(tankPosition.y) - ${(halfHeight - rimRadius).toFixed(6)}, 0.0);
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
