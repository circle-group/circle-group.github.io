import { sampleStandardNormalPair } from './distribution-samples.js';
import { rotateBridgePoint } from './gaussian-coordinates.js';
import { validatePathSteps } from './gaussian-transition.js';

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
