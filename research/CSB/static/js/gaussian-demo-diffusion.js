import { maxGaussianRotation } from './gaussian-bridge.js';
import { gaussianCovariance } from './gaussian-coordinates.js';

export const demoSigma = 1.0;
export const demoRotationLimit = 5;

const nominalVariance = 0.4;
const logStdSpread = 0.35;
const minCircularVariance = demoSigma ** 2 / 2 * Math.sqrt(Math.max(0, demoRotationLimit ** 2 - 1));
const proposalLogStd = Math.log(Math.max(nominalVariance, minCircularVariance)) / 2;
const normalShift = (proposalLogStd - Math.log(nominalVariance) / 2) / logStdSpread;

export function supportsDemoRotationRange(source, target) {
  // With fixed noise, feasibility at the largest |γ| covers the whole slider.
  const limit = maxGaussianRotation(source, target, demoSigma);
  // An exact boundary can round down by one floating-point step.
  return demoRotationLimit - limit <= Number.EPSILON * demoRotationLimit;
}

export function sampleDemoShapes(random, normalPair) {
  function drawShape() {
    const noise = normalPair();
    const stdX = Math.exp(proposalLogStd + logStdSpread * noise.x);
    const stdY = Math.exp(proposalLogStd + logStdSpread * noise.y);
    const rotation = 2 * Math.PI * random();
    const covariance = gaussianCovariance(stdX, stdY, rotation);
    return { stdX, stdY, rotation, covariance, noiseSum: noise.x + noise.y };
  }

  for (;;) {
    const source = drawShape();
    const target = drawShape();
    if (!supportsDemoRotationRange(source, target)) continue;
    // Shifting the four log widths makes feasible pairs common. This Gaussian
    // density ratio restores the original distribution conditional on feasibility.
    const acceptance = Math.exp(-normalShift * (source.noiseSum + target.noiseSum));
    if (random() < acceptance) return [source, target];
  }
}
