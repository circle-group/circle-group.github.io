import { covarianceRoot, spiralGuidePoint } from './gaussian-coordinates.js';

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
