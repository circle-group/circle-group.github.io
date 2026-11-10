import { covarianceRoot, gaussianPoint } from './gaussian-coordinates.js';
import { sampleStandardNormalPair } from './distribution-samples.js';
import { createAffinePathSampler, validatePathSteps } from './gaussian-transition.js';
import { sampleSpiralBridgePath } from './spiral-bridge.js';

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

function determinant(S) {
  const det = S.xx * S.yy - S.xy * S.xy;
  if (!(S.xx > 0 && det > 0 && Number.isFinite(det))) {
    throw new RangeError('The rotating Gaussian bridge requires positive definite covariances.');
  }
  return det;
}

function cholesky(S) {
  const det = determinant(S);
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
    const det = determinant(S);
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
