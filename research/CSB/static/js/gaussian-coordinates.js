// The squared Mahalanobis distance of a 2D Gaussian has a chi-square(2) law.
export const gaussian95Radius = Math.sqrt(-2 * Math.log(0.05));

// Eq. (56) rotates the entire Brownian bridge about its conditioning endpoint.
// Conjugate time reversal moves the pivot to the displayed source and flips the angle.
export function rotateBridgePoint(time, point, source, target, gamma, forward) {
  if (time === 0) return source;
  if (time === 1) return target;
  if (gamma === 0) return point;
  const center = forward ? target : source;
  const angle = gamma * (forward ? Math.log1p(-time) : -Math.log(time));
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
