import { gaussianCovariance } from './gaussian-coordinates.js';

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
