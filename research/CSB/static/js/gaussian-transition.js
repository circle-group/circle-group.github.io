import { gaussianPoint } from './gaussian-coordinates.js';
import { sampleStandardNormalPair } from './distribution-samples.js';

// Matrices in this module are 2×2, stored in row-major order.
const identity = [1, 0, 0, 1];
function multiply([a, b, c, d], [e, f, g, h]) {
  return [a * e + b * g, a * f + b * h, c * e + d * g, c * f + d * h];
}
function transpose([a, b, c, d]) {
  return [a, c, b, d];
}
function add(a, b) { return a.map((value, i) => value + b[i]); }
function subtract(a, b) { return a.map((value, i) => value - b[i]); }
function transport(F, Q) { return multiply(multiply(F, Q), transpose(F)); }
function determinant([a, b, c, d]) {
  const det = a * d - b * c;
  if (!(a > 0 && det > 0 && Number.isFinite(det))) {
    throw new RangeError('The Gaussian transition covariance must be positive definite.');
  }
  return det;
}
function inverse(Q) {
  const [a, b, c, d] = Q;
  const det = determinant(Q);
  return [d / det, -b / det, -c / det, a / det];
}
function noiseRoot(Q, diffusion) {
  const [a, b, c, d] = Q;
  const rootDet = Math.sqrt(determinant(Q));
  const scale = diffusion / Math.sqrt(a + d + 2 * rootDet);
  return { a: scale * (a + rootDet), b: scale * (b + c) / 2, d: scale * (d + rootDet) };
}
function apply(F, point) {
  return { x: F[0] * point.x + F[1] * point.y, y: F[2] * point.x + F[3] * point.y };
}

export function validatePathSteps(steps) {
  if (!Number.isInteger(steps) || steps < 1) throw new RangeError('A path needs at least one time step.');
}

// For centered coordinates, X_b|X_a has mean U X_a and covariance 2D Q.
// Integrate Q directly so very short intervals never subtract two nearly
// identical marginal covariances. Integrating the unit-noise Gramian also
// gives the same accuracy when D is small.
function transition(start, end, driftMatrix) {
  function derivative(t, [u00, u01, u10, u11, qxx, qxy, qyy]) {
    const [a, b, c, d] = driftMatrix(t);
    return [
      a * u00 + b * u10, a * u01 + b * u11,
      c * u00 + d * u10, c * u01 + d * u11,
      1 + 2 * (a * qxx + b * qxy), c * qxx + (a + d) * qxy + b * qyy, 1 + 2 * (c * qxy + d * qyy),
    ];
  }
  function advance(y, h, change) {
    return y.map((value, i) => value + h * change[i]);
  }
  function rk4(t, h, y) {
    const d1 = derivative(t, y);
    const d2 = derivative(t + h / 2, advance(y, h / 2, d1));
    const d3 = derivative(t + h / 2, advance(y, h / 2, d2));
    const d4 = derivative(t + h, advance(y, h, d3));
    return y.map((v, i) => v + h * (d1[i] + 2 * d2[i] + 2 * d3[i] + d4[i]) / 6);
  }
  let state = [...identity, 0, 0, 0];
  let time = start;
  let h = end - start;
  while (time < end) {
    const coarse = rk4(time, h, state);
    const half = rk4(time, h / 2, state);
    const fine = rk4(time + h / 2, h / 2, half);
    const acceptable = fine.every((v, i) => {
      const unit = i < 4 ? 1 : end - start;
      return Math.abs(v - coarse[i]) <= 1e-9 * (unit + Math.abs(v));
    });
    if (acceptable) {
      // Richardson extrapolation of the two half steps.
      state = fine.map((v, i) => v + (v - coarse[i]) / 15);
      time += h;
      h = Math.min(2 * h, end - time);
    } else {
      h /= 2;
      if (time + h === time) throw new RangeError('The Gaussian transition could not be resolved.');
    }
  }
  return { U: state.slice(0, 4), Q: [state[4], state[5], state[5], state[6]] };
}

export function createAffinePathSampler(meanAt, driftMatrix, D) {
  const diffusion = Math.sqrt(2 * D);
  let cached;

  // Sample the endpoint first, as in the zero-rotation Brownian bridge.
  // Condition each one-step transition on that endpoint via Gaussian
  // regression. This preserves the order and meaning of the random draws
  // as the slider crosses zero. All paths on this grid share the coefficients.
  function prepare(steps) {
    const means = Array.from({ length: steps + 1 }, (_, i) => meanAt(i / steps));
    const interior = new Array(steps - 1);
    let toEnd = { U: identity, Q: [0, 0, 0, 0] };
    for (let i = steps - 1; i >= 0; i--) {
      const step = transition(i / steps, (i + 1) / steps, driftMatrix);
      const Q = add(toEnd.Q, transport(toEnd.U, step.Q));
      if (i < steps - 1) {
        const gain = multiply(multiply(step.Q, transpose(toEnd.U)), inverse(Q));
        const residual = subtract(identity, multiply(gain, toEnd.U));
        // Joseph form keeps the conditional covariance a sum of two PSD matrices.
        const conditional = add(transport(residual, step.Q), transport(gain, toEnd.Q));
        interior[i] = { U: multiply(residual, step.U), gain, root: noiseRoot(conditional, diffusion) };
      }
      toEnd = { U: multiply(toEnd.U, step.U), Q };
    }
    function conditionalMean(startPoint) {
      const offset = apply(toEnd.U, { x: startPoint.x - means[0].x, y: startPoint.y - means[0].y });
      return { x: means[steps].x + offset.x, y: means[steps].y + offset.y };
    }
    const [qxx, qxy, qyx, qyy] = toEnd.Q;
    const endpointLaw = {
      meanAt: conditionalMean,
      covariance: { xx: 2 * D * qxx, xy: D * (qxy + qyx), yy: 2 * D * qyy },
    };
    return { steps, means, interior, endpointLaw, root: noiseRoot(toEnd.Q, diffusion) };
  }

  function coefficients(steps) {
    validatePathSteps(steps);
    if (cached?.steps !== steps) cached = prepare(steps);
    return cached;
  }

  function endpointTransition(steps = 160) {
    return coefficients(steps).endpointLaw;
  }

  function samplePinnedPath(startPoint, endPoint, steps, normalPair = sampleStandardNormalPair) {
    const { means, interior } = coefficients(steps);
    let centered = { x: startPoint.x - means[0].x, y: startPoint.y - means[0].y };
    const end = { x: endPoint.x - means[steps].x, y: endPoint.y - means[steps].y };
    const path = [{ x: startPoint.x, y: startPoint.y }];
    for (let i = 0; i < interior.length; i++) {
      const { U, gain, root } = interior[i];
      const prior = apply(U, centered);
      const terminal = apply(gain, end);
      const z = normalPair();
      centered = gaussianPoint({ x: prior.x + terminal.x, y: prior.y + terminal.y }, root, z.x, z.y);
      path.push({ x: means[i + 1].x + centered.x, y: means[i + 1].y + centered.y });
    }
    path.push({ x: endPoint.x, y: endPoint.y });
    return path;
  }

  function samplePath(startPoint, steps, normalPair = sampleStandardNormalPair) {
    const { endpointLaw, root } = coefficients(steps);
    const noise = normalPair();
    const end = gaussianPoint(endpointLaw.meanAt(startPoint), root, noise.x, noise.y);
    return samplePinnedPath(startPoint, end, steps, normalPair);
  }

  return { endpointTransition, samplePath, samplePinnedPath };
}
