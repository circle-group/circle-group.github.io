import { sampleStandardNormalPair } from './distribution-samples.js';
import { rotateBridgePoint } from './gaussian-coordinates.js';
import { validatePathSteps } from './gaussian-transition.js';

// Exact joint grid sample of the endpoint-conditioned SDE (48), via Eq. (56).
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
    path.push(rotateBridgePoint(i / steps, brownian, start, end, gamma, forward));
  }
  path.push({ x: end.x, y: end.y });
  return path;
}
