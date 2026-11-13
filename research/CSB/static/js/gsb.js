// Gaussian coordinates.

// The squared Mahalanobis distance of a 2D Gaussian has a chi-square(2) law.
export const gaussian95Radius = Math.sqrt(-2 * Math.log(0.05));

// At the collapsed endpoint the displacement is zero and has no orientation.
export function bridgeAngle(time, gamma, forward) {
  if (time === (forward ? 1 : 0)) return 0;
  return gamma * (forward ? Math.log1p(-time) : -Math.log(time));
}

// Eq. (56) rotates the entire Brownian bridge about its conditioning endpoint.
// Conjugate time reversal moves the pivot to the displayed source and flips the angle.
export function rotateBridgePoint(time, point, source, target, gamma, forward) {
  if (time === 0) return source;
  if (time === 1) return target;
  if (gamma === 0) return point;
  const center = forward ? target : source;
  const angle = bridgeAngle(time, gamma, forward);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return {
    x: center.x + cos * dx - sin * dy,
    y: center.y + sin * dx + cos * dy,
  };
}

// Rotating the ordinary bridge's linear mean gives the Eq. (8) guide.
export function spiralGuidePoint(time, source, target, gamma, forward) {
  const mean = {
    x: (1 - time) * source.x + time * target.x,
    y: (1 - time) * source.y + time * target.y,
  };
  return rotateBridgePoint(time, mean, source, target, gamma, forward);
}

// The sampling transform is R diag(stdX, stdY), so Sigma = R D^2 R^T.
export function gaussianCovariance(stdX, stdY, rotation) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const x = stdX * stdX;
  const y = stdY * stdY;
  return {
    xx: cos * cos * x + sin * sin * y,
    xy: cos * sin * (x - y),
    yy: sin * sin * x + cos * cos * y,
  };
}

// The symmetric square root gives a continuous frame, including circular Sigma.
export function covarianceRoot({ xx, xy, yy }) {
  const rootDet = Math.sqrt(Math.max(0, xx * yy - xy * xy));
  const denominator = Math.sqrt(Math.max(Number.EPSILON, xx + yy + 2 * rootDet));
  return { a: (xx + rootDet) / denominator, b: xy / denominator, d: (yy + rootDet) / denominator };
}

export function gaussianPoint(mean, root, u, v) {
  return { x: mean.x + root.a * u + root.b * v, y: mean.y + root.b * u + root.d * v };
}

export function gaussianPolar(point, mean, root) {
  const dx = point.x - mean.x;
  const dy = point.y - mean.y;
  const det = Math.max(Number.EPSILON, root.a * root.d - root.b * root.b);
  const u = (root.d * dx - root.b * dy) / det;
  const v = (root.a * dy - root.b * dx) / det;
  return { radius: Math.hypot(u, v), angle: (Math.atan2(v, u) + 2 * Math.PI) % (2 * Math.PI) };
}

// Random sampling.

const samplesPerCloud = 128;

// SplitMix32 supplies a repeatable sampling stream from a 32-bit seed.
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let value = Math.imul(state ^ (state >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return ((value ^ (value >>> 15)) >>> 0) / 0x100000000;
  };
}

export function sampleWithoutReplacement(values, count, random) {
  const pool = values.slice();
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function sampleStandardNormalPair(random = Math.random) {
  // Box–Muller gives a pair of independent standard normal samples.
  const radius = Math.sqrt(-2 * Math.log(1 - random()));
  const angle = random() * 2 * Math.PI;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

export function sampleCloud(centerX, centerY, slope, color, rotation = 0, options = {}) {
  const { stdX = 0.76, stdY = 0.44, normalPair = sampleStandardNormalPair, count = samplesPerCloud } = options;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return Array.from({ length: count }, () => {
    const { x: u, y: v } = normalPair();
    const dx = stdX * u;
    const dy = slope * u + stdY * v;
    return {
      x: centerX + cos * dx - sin * dy,
      y: centerY + sin * dx + cos * dy,
      color,
    };
  });
}

// Demo distributions.

export const demoSigma = 1.0;

const logStdMean = Math.log(0.4) / 2;
const logStdSpread = 0.35;

export function sampleDemoShapes(random, normalPair) {
  function drawShape() {
    const noise = normalPair();
    const stdX = Math.exp(logStdMean + logStdSpread * noise.x);
    const stdY = Math.exp(logStdMean + logStdSpread * noise.y);
    const rotation = 2 * Math.PI * random();
    const covariance = gaussianCovariance(stdX, stdY, rotation);
    return { stdX, stdY, rotation, covariance };
  }
  return [drawShape(), drawShape()];
}

// Affine transition sampling.

// Affine transition matrices are 2×2, stored in row-major order.
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
function matrixDeterminant([a, b, c, d]) {
  const det = a * d - b * c;
  if (!(a > 0 && det > 0 && Number.isFinite(det))) {
    throw new RangeError('The Gaussian transition covariance must be positive definite.');
  }
  return det;
}
function inverse(Q) {
  const [a, b, c, d] = Q;
  const det = matrixDeterminant(Q);
  return [d / det, -b / det, -c / det, a / det];
}
function noiseRoot(Q, diffusion) {
  const [a, b, c, d] = Q;
  const rootDet = Math.sqrt(matrixDeterminant(Q));
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

// Endpoint-conditioned paths.

// Push the same realized path through the forward or conjugate-reverse map.
export function transformBridgePath(path, gamma, forward) {
  if (gamma === 0) return path;
  const steps = path.length - 1;
  const start = path[0], end = path[steps];
  return path.map((point, i) => rotateBridgePoint(i / steps, point, start, end, gamma, forward));
}

// Exact joint grid sample of the endpoint-conditioned SDE (48), via Eq. (56).
// In reverse, knot i has s=i/steps and Eq. (57)'s forward index n=steps-i.
// sigma is the Brownian amplitude in each real coordinate on [0, 1].
export function sampleSpiralBridgePath(start, end, gamma, forward, sigma, steps, normalPair = sampleStandardNormalPair) {
  validatePathSteps(steps);
  let brownian = { x: start.x, y: start.y };
  const path = [brownian];
  for (let i = 1; i < steps; i++) {
    const remaining = steps - i + 1;
    const std = sigma * Math.sqrt((remaining - 1) / (remaining * steps));
    const noise = normalPair();
    brownian = {
      x: brownian.x + (end.x - brownian.x) / remaining + std * noise.x,
      y: brownian.y + (end.y - brownian.y) / remaining + std * noise.y,
    };
    path.push(brownian);
  }
  path.push({ x: end.x, y: end.y });
  return transformBridgePath(path, gamma, forward);
}

// Gaussian bridge models.

// R M R for two symmetric 2D matrices.
function sandwich({ a, b, d }, { xx, xy, yy }) {
  const firstX = a * xx + b * xy;
  const firstY = a * xy + b * yy;
  const secondX = b * xx + d * xy;
  const secondY = b * xy + d * yy;
  return {
    xx: firstX * a + firstY * b,
    xy: firstX * b + firstY * d,
    yy: secondX * b + secondY * d,
  };
}

// With G the endpoint regression matrix, G Σ0 G + σ² G = Σ1.
// This rationalized form of Bunne et al., Eq. (2), avoids subtracting
// nearly equal matrices when the endpoint variances are small.
function endpointGain(source, target, variance) {
  const root = covarianceRoot(target);
  const inner = sandwich(root, source);
  const half = variance / 2;
  const shifted = covarianceRoot({ xx: inner.xx + half * half, xy: inner.xy, yy: inner.yy + half * half });
  const a = shifted.a + half;
  const b = shifted.b;
  const d = shifted.d + half;
  const det = a * d - b * b;
  return sandwich(root, { xx: d / det, xy: -b / det, yy: a / det });
}

// Both branches have affine mean and quadratic covariance on [0, 1].
function marginalCurve(source, target, mixed) {
  const A = source.covariance;
  const B = target.covariance;
  function meanAt(t) {
    return { x: (1 - t) * source.mean.x + t * target.mean.x, y: (1 - t) * source.mean.y + t * target.mean.y };
  }
  function covarianceAt(t) {
    const u = 1 - t;
    return {
      xx: u * u * A.xx + t * t * B.xx + u * t * mixed.xx,
      xy: u * u * A.xy + t * t * B.xy + u * t * mixed.xy,
      yy: u * u * A.yy + t * t * B.yy + u * t * mixed.yy,
    };
  }
  function marginalAt(t) {
    return { mean: meanAt(t), covariance: covarianceAt(t) };
  }
  return { meanAt, covarianceAt, marginalAt };
}

// At γ=0 use the Brownian Gaussian SB (Bunne et al., Theorems 2–3
// and Appendix C.2, https://arxiv.org/pdf/2202.05722).
export function createGaussianBridge(source, target, diffusion = 1, gamma = 0) {
  const D = diffusivity(diffusion);
  if (!Number.isFinite(gamma)) throw new RangeError('Rotation must be finite.');
  if (gamma !== 0) return createRotatingBridge(source, target, D, gamma);
  const initial = source.covariance;
  const final = target.covariance;
  const variance = diffusion * diffusion;
  const gain = endpointGain(initial, final, variance);
  const conditionalCovariance = { xx: variance * gain.xx, xy: variance * gain.xy, yy: variance * gain.yy };
  const conditionalRoot = covarianceRoot(conditionalCovariance);

  // C = Cov(X0, X1) = Σ0 G. The marginal needs C + Cᵀ + σ² I.
  const mixed = {
    xx: 2 * (initial.xx * gain.xx + initial.xy * gain.xy) + variance,
    xy: initial.xx * gain.xy + initial.xy * gain.yy + initial.xy * gain.xx + initial.yy * gain.xy,
    yy: 2 * (initial.xy * gain.xy + initial.yy * gain.yy) + variance,
  };

  const { marginalAt } = marginalCurve(source, target, mixed);

  function conditionalMean(startPoint) {
    const dx = startPoint.x - source.mean.x;
    const dy = startPoint.y - source.mean.y;
    return {
      x: target.mean.x + gain.xx * dx + gain.xy * dy,
      y: target.mean.y + gain.xy * dx + gain.yy * dy,
    };
  }

  const endpointLaw = { meanAt: conditionalMean, covariance: conditionalCovariance };
  function endpointTransition(steps = 160) {
    validatePathSteps(steps);
    return endpointLaw;
  }

  function samplePinnedPath(startPoint, endPoint, steps, normalPair = sampleStandardNormalPair) {
    return sampleSpiralBridgePath(startPoint, endPoint, 0, true, diffusion, steps, normalPair);
  }

  function samplePath(startPoint, steps, normalPair = sampleStandardNormalPair) {
    const mean = endpointTransition(steps).meanAt(startPoint);
    const noise = normalPair();
    const end = gaussianPoint(mean, conditionalRoot, noise.x, noise.y);
    return samplePinnedPath(startPoint, end, steps, normalPair);
  }

  return { marginalAt, endpointTransition, samplePath, samplePinnedPath };
}

function diffusivity(diffusion) {
  const D = diffusion * diffusion / 2;
  if (!(Number.isFinite(diffusion) && diffusion > 0 && Number.isFinite(D) && D > 0)) {
    throw new RangeError('The noise amplitude must give a positive finite diffusivity.');
  }
  return D;
}

function covarianceDeterminant(S) {
  const det = S.xx * S.yy - S.xy * S.xy;
  if (!(S.xx > 0 && det > 0 && Number.isFinite(det))) {
    throw new RangeError('The rotating Gaussian bridge requires positive definite covariances.');
  }
  return det;
}

function cholesky(S) {
  const det = covarianceDeterminant(S);
  const a = Math.sqrt(S.xx);
  return [a, S.xy / a, Math.sqrt(det / S.xx)];
}

function rotationSpectrum(A, B, D) {
  // With Cholesky factors A=LLᵀ and B=RRᵀ, the singular values of W=LᵀR
  // are the square roots of the eigenvalues of A½BA½. Swapping A and B
  // transposes W, so both panels obtain the same rotation limit.
  const [a, b, d] = cholesky(A);
  const [e, f, h] = cholesky(B);
  const w00 = a * e + b * f, w01 = b * h, w10 = d * f, w11 = d * h;
  const sum = Math.hypot(w00 + w11, w10 - w01);
  const difference = Math.hypot(w00 - w11, w10 + w01);
  const largest = (sum + difference) / 2;
  const q = (a * d) * (e * h) / largest;
  return { q, gap: sum * difference, maxRotation: Math.hypot(1, q / D) };
}

// Largest |γ| for the principal unforced bridge at fixed per-coordinate noise.
export function maxGaussianRotation(source, target, diffusion = 1) {
  return rotationSpectrum(source.covariance, target.covariance, diffusivity(diffusion)).maxRotation;
}

// Compute √(q²+D²(1−γ²)). The factored difference avoids squaring two
// almost equal quantities near the feasibility boundary.
function shiftedMinRoot(q, D, gamma, maxRotation) {
  const magnitude = Math.abs(gamma);
  if (magnitude <= 1) return Math.hypot(q, D * Math.sqrt((1 - magnitude) * (1 + magnitude)));
  if (magnitude === maxRotation) return 0;
  const shift = D * Math.sqrt(magnitude - 1) * Math.sqrt(magnitude + 1);
  const difference = q - shift;
  if (difference < -4 * Number.EPSILON * q) {
    throw new RangeError(`Rotation exceeds the fixed-diffusion Gaussian bridge limit of ${maxRotation}.`);
  }
  return Math.sqrt(Math.max(0, difference)) * Math.sqrt(q + shift);
}

// Principal unforced Gaussian CSB on [0,1]. See README.md for the phase
// equation and the fixed-diffusion feasibility bound.
function createRotatingBridge(source, target, D, gamma) {
  const A = source.covariance;
  const B = target.covariance;
  const { q, gap, maxRotation } = rotationSpectrum(A, B, D);
  const lambdaMin = q * q;
  const lowRoot = shiftedMinRoot(q, D, gamma, maxRotation);
  const highRoot = Math.hypot(Math.sqrt(gap), lowRoot);
  const sumRoots = lowRoot + highRoot;
  // Cayley–Hamilton: √(A½BA½+kI) = lowRoot I + (A½BA½−λ_min I)/sumRoots.
  // The symmetric mixed covariance below is HA+AH, H=A⁻½√(A½BA½+kI)A⁻½.
  const mixed = gap === 0 ? { xx: 2 * lowRoot, xy: 0, yy: 2 * lowRoot } : {
    xx: 2 * (lowRoot + (A.xx * B.xx + A.xy * B.xy - lambdaMin) / sumRoots),
    xy: (B.xy * (A.xx + A.yy) + A.xy * (B.xx + B.yy)) / sumRoots,
    yy: 2 * (lowRoot + (A.yy * B.yy + A.xy * B.xy - lambdaMin) / sumRoots),
  };
  const { meanAt, covarianceAt, marginalAt } = marginalCurve(source, target, mixed);
  function driftMatrix(t) {
    const S = covarianceAt(t);
    const det = covarianceDeterminant(S);
    const u = 1 - t;
    const dxx = -2 * u * A.xx + 2 * t * B.xx + (u - t) * mixed.xx;
    const dxy = -2 * u * A.xy + 2 * t * B.xy + (u - t) * mixed.xy;
    const dyy = -2 * u * A.yy + 2 * t * B.yy + (u - t) * mixed.yy;
    // Solve KΣ+ΣK=Σ' for the symmetric velocity gradient K.
    const kxy = (S.xx * S.yy * dxy - 0.5 * S.xy * (S.yy * dxx + S.xx * dyy)) / (det * (S.xx + S.yy));
    const kxx = (dxx / 2 - S.xy * kxy) / S.xx;
    const kyy = (dyy / 2 - S.xy * kxy) / S.yy;
    // E = K − D(I+γJ)Σ⁻¹, row major in the common real coordinates.
    return [
      kxx - D * (S.yy + gamma * S.xy) / det, kxy + D * (S.xy + gamma * S.xx) / det,
      kxy + D * (S.xy - gamma * S.yy) / det, kyy - D * (S.xx - gamma * S.xy) / det,
    ];
  }
  return { marginalAt, ...createAffinePathSampler(meanAt, driftMatrix, D) };
}

// Spiral marginals.

function rootColumns(covariance) {
  const { a, b, d } = covarianceRoot(covariance);
  return [{ x: a, y: b }, { x: b, y: d }];
}

// Integrate the endpoint-conditioned rotation over the reference bridge's
// joint endpoint law. Both endpoints are in the panel's coordinates.
export function createSpiralMarginal(source, target, transition, gamma, forward, sigma) {
  const origin = { x: 0, y: 0 };
  const endpointMean = transition.meanAt(source.mean);
  // The first two independent normals generate X. The affine conditional
  // mean carries these same normals into Y. Two further normals generate
  // the independent conditional endpoint noise.
  const loadings = rootColumns(source.covariance).map(start => {
    const shifted = transition.meanAt({ x: source.mean.x + start.x, y: source.mean.y + start.y });
    return { start, end: { x: shifted.x - endpointMean.x, y: shifted.y - endpointMean.y } };
  });
  for (const end of rootColumns(transition.covariance)) loadings.push({ start: origin, end });

  function marginalAt(time) {
    if (time === 0) return { mean: source.mean, covariance: source.covariance };
    if (time === 1) return { mean: target.mean, covariance: target.covariance };
    const mean = spiralGuidePoint(time, source.mean, target.mean, gamma, forward);
    const bridgeVariance = sigma * sigma * time * (1 - time);
    const covariance = { xx: bridgeVariance, xy: 0, yy: bridgeVariance };
    // The spiral mean is linear in its two endpoints. Each transformed
    // loading contributes an outer product, including endpoint correlations.
    for (const { start, end } of loadings) {
      const { x, y } = spiralGuidePoint(time, start, end, gamma, forward);
      covariance.xx += x * x;
      covariance.xy += x * y;
      covariance.yy += y * y;
    }
    return { mean, covariance };
  }
  return { marginalAt };
}

// Shortest guide matching.

// The default metric is physical endpoint distance. A renderer can supply the
// arc length in its own coordinates, including cap origins and spiral geometry.
export function createShortestPathMatcher(sources, targets, visiblePairs,
  sourceCandidates = sources, targetCandidates = targets,
  distanceBetween = (source, target) => Math.hypot(target.x - source.x, target.y - source.y)) {
  const pairedSources = new Set(visiblePairs.map(pair => pair.sourceIndex));
  const pairedTargets = new Set(visiblePairs.map(pair => pair.targetIndex));
  const reservedSources = new Set([...pairedSources].map(index => sources[index]));
  const reservedTargets = new Set([...pairedTargets].map(index => targets[index]));

  return (sourceSide, index) => {
    const origins = sourceSide ? sources : targets;
    const paired = sourceSide ? pairedSources : pairedTargets;
    if (!Number.isInteger(index) || index < 0 || index >= origins.length || paired.has(index)) return null;
    const origin = origins[index];
    if (!origin || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return null;

    const candidates = sourceSide ? targetCandidates : sourceCandidates;
    const reserved = sourceSide ? reservedTargets : reservedSources;
    let closest = null;
    let shortest = Infinity;
    for (const candidate of candidates) {
      if (!candidate || reserved.has(candidate)) continue;
      const distance = sourceSide ? distanceBetween(origin, candidate) : distanceBetween(candidate, origin);
      if (distance < shortest) {
        shortest = distance;
        closest = candidate;
      }
    }
    if (!closest) return null;
    const sourcePoint = sourceSide ? origin : closest;
    const targetPoint = sourceSide ? closest : origin;
    return {
      sourceIndex: sourceSide ? index : sources.indexOf(sourcePoint),
      targetIndex: sourceSide ? targets.indexOf(targetPoint) : index,
      sourcePoint,
      targetPoint,
    };
  };
}

// Gaussian pair selection.

export const optimalPairCount = 3;

function gaussianEndpointCost(transition) {
  // Q = LLᵀ is common to every conditional endpoint density at this rotation.
  // Its normalizer cancels, so maximize likelihood by minimizing ||L⁻¹(y−μ(x))||².
  const { xx, xy, yy } = transition.covariance;
  const a = Math.sqrt(xx);
  const b = xy / a;
  const d = Math.sqrt(yy - b * b);
  if (!(a > 0 && d > 0 && Number.isFinite(a) && Number.isFinite(d))) {
    throw new RangeError('The Gaussian endpoint transition must have positive definite covariance.');
  }
  return (mean, target) => {
    const u = (target.x - mean.x) / a;
    const v = (target.y - mean.y - b * u) / d;
    return u * u + v * v;
  };
}

export function optimalGaussianPairs(sources, targets, transition) {
  if (sources.length !== optimalPairCount || targets.length < optimalPairCount) {
    throw new RangeError('Choosing targets requires three fixed sources and at least three targets.');
  }
  const cost = gaussianEndpointCost(transition);
  const nearest = sources.map(source => {
    const mean = transition.meanAt(source);
    const ranked = targets.map((target, targetIndex) => ({ targetIndex, cost: cost(mean, target) }));
    ranked.sort((left, right) => left.cost - right.cost || left.targetIndex - right.targetIndex);
    // At most two cheaper targets can be taken by the other two sources.
    return ranked.slice(0, optimalPairCount);
  });

  let best;
  let bestCost = Infinity;
  for (const first of nearest[0]) {
    for (const second of nearest[1]) {
      if (second.targetIndex === first.targetIndex) continue;
      for (const third of nearest[2]) {
        if (third.targetIndex === first.targetIndex || third.targetIndex === second.targetIndex) continue;
        const cost = first.cost + second.cost + third.cost;
        if (cost < bestCost) {
          bestCost = cost;
          best = [first, second, third];
        }
      }
    }
  }
  return best.map(({ targetIndex }, sourceIndex) => ({ sourceIndex, targetIndex }));
}

export function createBackgroundMatcher(sources, targets, visiblePairs, transition) {
  const cost = gaussianEndpointCost(transition);
  const means = sources.map(source => transition.meanAt(source));
  const pairedSources = new Set(visiblePairs.map(pair => pair.sourceIndex));
  const pairedTargets = new Set(visiblePairs.map(pair => pair.targetIndex));
  const freeSources = [...sources.keys()].filter(i => !pairedSources.has(i));
  const freeTargets = [...targets.keys()].filter(i => !pairedTargets.has(i));

  return (sourceSide, index) => {
    if ((sourceSide ? pairedSources : pairedTargets).has(index)) return null;
    const candidates = sourceSide ? freeTargets : freeSources;
    let bestCost = Infinity;
    let best = null;
    for (const candidate of candidates) {
      const sourceIndex = sourceSide ? index : candidate;
      const targetIndex = sourceSide ? candidate : index;
      // A hovered target searches the same endpoint likelihood over sources.
      const pairCost = cost(means[sourceIndex], targets[targetIndex]);
      if (pairCost < bestCost) {
        bestCost = pairCost;
        best = { sourceIndex, targetIndex };
      }
    }
    return best;
  };
}

// Gaussian cloud assignment.

// Minimize the sum of one entry per row and column (Hungarian algorithm).
// Indices inside the search are one-based. Column zero starts the augmenting path.
function minimumAssignment(costs, size) {
  const owner = new Int32Array(size + 1);
  const rowPotential = new Float64Array(size + 1);
  const columnPotential = new Float64Array(size + 1);
  const predecessor = new Int32Array(size + 1);
  const slack = new Float64Array(size + 1);
  const visited = new Uint8Array(size + 1);
  for (let row = 1; row <= size; row++) {
    owner[0] = row;
    let column = 0;
    slack.fill(Infinity);
    visited.fill(0);
    do {
      visited[column] = 1;
      const activeRow = owner[column];
      const offset = (activeRow - 1) * size;
      let nextColumn = 0;
      let delta = Infinity;
      for (let j = 1; j <= size; j++) {
        if (visited[j]) continue;
        const reducedCost = costs[offset + j - 1] - rowPotential[activeRow] - columnPotential[j];
        if (reducedCost < slack[j]) {
          slack[j] = reducedCost;
          predecessor[j] = column;
        }
        if (slack[j] < delta) {
          delta = slack[j];
          nextColumn = j;
        }
      }
      for (let j = 0; j <= size; j++) {
        if (visited[j]) {
          rowPotential[owner[j]] += delta;
          columnPotential[j] -= delta;
        } else {
          slack[j] -= delta;
        }
      }
      column = nextColumn;
    } while (owner[column] !== 0);
    // Retrace the minimum-cost augmenting path to the new row.
    do {
      const previous = predecessor[column];
      owner[column] = owner[previous];
      column = previous;
    } while (column !== 0);
  }
  const targetForSource = new Array(size);
  for (let j = 1; j <= size; j++) targetForSource[owner[j] - 1] = j - 1;
  return targetForSource;
}

// Each displayed particle has equal mass. Match the two fixed clouds by
// maximizing the product of the bridge transition densities p(target | source).
export function matchGaussianClouds(sourcePoints, targetPoints, transition) {
  const size = sourcePoints.length;
  if (size !== targetPoints.length) throw new RangeError('Gaussian clouds must have equal particle counts.');
  if (size === 0) return [];
  const { xx, xy, yy } = transition.covariance;
  const a = Math.sqrt(xx);
  const b = xy / a;
  const d = Math.sqrt(yy - b * b);
  if (!(a > 0 && d > 0 && Number.isFinite(a) && Number.isFinite(d))) {
    throw new RangeError('The Gaussian endpoint transition must have positive definite covariance.');
  }
  function whiten(points) {
    const origin = points[0];
    let scale = 0;
    const whitened = points.map(point => {
      const x = (point.x - origin.x) / a;
      const y = (point.y - origin.y - b * x) / d;
      scale = Math.max(scale, Math.abs(x), Math.abs(y));
      return { x, y };
    });
    if (!Number.isFinite(scale)) throw new RangeError('Gaussian assignment coordinates must be finite.');
    // A common positive scale per cloud preserves the optimum and bounds
    // the magnitudes of the cost matrix and its dual potentials.
    if (scale > 0) {
      for (const point of whitened) {
        point.x /= scale;
        point.y /= scale;
      }
    }
    return whitened;
  }
  const means = whiten(sourcePoints.map(point => transition.meanAt(point)));
  const targets = whiten(targetPoints);
  const costs = new Float64Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      // The squared Mahalanobis cost is ||target - mean||² in these axes.
      // Its row/column terms sum to constants for every permutation, even
      // after centering each cloud. Only the standardized cross term matters.
      costs[i * size + j] = -(means[i].x * targets[j].x + means[i].y * targets[j].y);
    }
  }
  return minimumAssignment(costs, size);
}

// Candidate display selection.

// Put the current rotation's optimal endpoints first, followed by unpaired scatter.
export function selectGaussianTargets(candidatePoints, bestPairs, displayCount, seed, tick) {
  if (displayCount < bestPairs.length || displayCount > candidatePoints.length) {
    throw new RangeError('The display count must fit the selected pairs and the candidate pool.');
  }
  const reserved = new Set(bestPairs.map(pair => pair.targetIndex));
  const targets = bestPairs.map(pair => candidatePoints[pair.targetIndex]);
  const available = candidatePoints.filter((_, i) => !reserved.has(i));
  const random = createSeededRandom((seed + tick) >>> 0);
  return targets.concat(sampleWithoutReplacement(available, displayCount - targets.length, random));
}
