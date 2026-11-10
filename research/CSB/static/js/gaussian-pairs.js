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
