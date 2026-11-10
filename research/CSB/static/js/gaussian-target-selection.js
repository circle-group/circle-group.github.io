import { createSeededRandom, sampleWithoutReplacement } from './distribution-samples.js';

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
