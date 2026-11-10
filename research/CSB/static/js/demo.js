import { createSeededRandom, createVisitRandom, sampleCloud, sampleStandardNormalPair, sampleWithoutReplacement } from './distribution-samples.js';
import { createDistributionTank } from './distribution-tank.js';
import { createGaussianBridge } from './gaussian-bridge.js';
import { demoSigma, sampleDemoShapes } from './gaussian-demo-diffusion.js';
import { createBackgroundMatcher, optimalGaussianPairs, optimalPairCount } from './gaussian-pairs.js';
import { selectGaussianTargets } from './gaussian-target-selection.js';
import { sampleSpiralBridgePath } from './spiral-bridge.js';
import { createSpiralMarginal } from './spiral-marginal.js';
import { gaussian95Radius, spiralGuidePoint } from './gaussian-coordinates.js';
import { createWPlaneMinimap } from './cmap.js';

// Fixed plot origins make the randomized means visible on the shared scale.
const distributions = [
  { x: -2.35, y: -0.35 },
  { x: 2.35, y: 0.35 },
];
const meanJitterStd = 1.25;
const minViewRadius = 4;
const playbackDuration = 4000;
const pathSteps = 320;
const visibleParticles = 128;

function conjugateCloud(cloud) {
  const reflect = point => ({ ...point, y: -point.y });
  return {
    ...reflect(cloud),
    mean: reflect(cloud.mean),
    covariance: { ...cloud.covariance, xy: -cloud.covariance.xy },
    points: cloud.points.map(reflect),
  };
}

export function prepareDirection(tank, sourcePool, targetPool, viewRadius, normalPair, forward, seed) {
  const source = { ...sourcePool, points: sourcePool.points.slice(0, visibleParticles) };
  const random = createSeededRandom(seed);
  const sourceIndices = sampleWithoutReplacement([...source.points.keys()], optimalPairCount, random);
  const anchors = sourceIndices.map(i => source.points[i]);
  const scatterSeed = Math.floor(random() * 0x100000000);
  const draws = anchors.map(() => Array.from({ length: pathSteps - 1 }, normalPair));
  return (gamma, time) => {
    const endpointBridge = createGaussianBridge(source, targetPool, demoSigma, gamma);
    const transition = endpointBridge.endpointTransition(pathSteps);
    const population = createSpiralMarginal(source, targetPool, transition, gamma, forward, demoSigma);
    const bestPairs = optimalGaussianPairs(anchors, targetPool.points, transition);
    const tick = Math.round(gamma * 1000);
    const targets = selectGaussianTargets(targetPool.points, bestPairs, visibleParticles, scatterSeed, tick);
    // The selected targets occupy the first three displayed slots, in anchor order.
    const visiblePairs = sourceIndices.map((sourceIndex, targetIndex) => ({ sourceIndex, targetIndex }));
    const matchBackground = createBackgroundMatcher(source.points, targets, visiblePairs, transition);
    const paths = visiblePairs.map(({ sourceIndex, targetIndex }, i) => {
      let draw = 0;
      return sampleSpiralBridgePath(source.points[sourceIndex], targets[targetIndex], gamma, forward,
        demoSigma, pathSteps, () => draws[i][draw++]);
    });
    const spiralPointAt = (t, start, end) => spiralGuidePoint(t, start, end, gamma, forward);
    tank?.setSamples(source, { ...targetPool, points: targets }, visiblePairs, viewRadius, population, paths, time, spiralPointAt, matchBackground);
  };
}

export function setupDistributionDemo(root) {
  if (!root) return;
  const random = createVisitRandom();
  const normalPair = () => sampleStandardNormalPair(random);
  let currentTime = 0;
  const plots = Array.from(root.querySelectorAll('.distribution-panel'), (panel, index) => {
    const figure = panel.querySelector('.distribution-figure');
    const canvas = figure.querySelector('.distribution-viewport > canvas');
    const minimap = createWPlaneMinimap(figure.querySelector('.w-plane-minimap'));
    const gamma = panel.querySelector('.gamma-control input');
    const gammaValue = panel.querySelector('.gamma-control output');
    function setGamma(rotation) {
      gamma.value = rotation;
      gammaValue.value = rotation.toFixed(3);
      minimap.setGamma(rotation);
    }
    let drawDirection;
    let pendingFrame = null;
    gamma.addEventListener('input', () => {
      setGamma(gamma.valueAsNumber);
      if (pendingFrame !== null) return;
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        drawDirection(gamma.valueAsNumber, currentTime);
      });
    });
    setGamma(0);
    const style = getComputedStyle(figure);
    const color = style.getPropertyValue('--sample-color').trim();
    let tank;
    try {
      tank = createDistributionTank(canvas, {
        color,
        forward: index === 0,
        ringColor: style.getPropertyValue('--polar-radius').trim(),
        spokeColor: style.getPropertyValue('--polar-angle').trim(),
        readout: figure.querySelector('output'),
      });
    } catch (error) {
      console.error('Unable to initialize the distribution plot.', error);
      const message = document.createElement('p');
      message.textContent = 'This 3D plot requires WebGL.';
      canvas.replaceWith(message);
    }
    function startBridge(source, target, viewRadius) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
      setGamma(0);
      const seed = Math.floor(random() * 0x100000000);
      drawDirection = prepareDirection(tank, source, target, viewRadius, normalPair, index === 0, seed);
      drawDirection(0, 0);
    }
    return { ...distributions[index], color, tank, startBridge };
  });

  function resample() {
    const shapes = sampleDemoShapes(random, normalPair);

    const clouds = plots.map(({ x, y, color }, i) => {
      const { stdX, stdY, rotation, covariance } = shapes[i];
      const meanNoise = normalPair();
      const mean = { x: x + meanJitterStd * meanNoise.x, y: y + meanJitterStd * meanNoise.y };
      const points = sampleCloud(
        mean.x,
        mean.y,
        0,
        color,
        rotation,
        { stdX, stdY, normalPair, count: 2 * visibleParticles }
      );
      return {
        points, x, y, color, mean,
        covariance,
        maxStd: Math.max(stdX, stdY),
      };
    });
    const [green, orange] = clouds;
    const maxStd = Math.max(green.maxStd, orange.maxStd);
    // Keep the same scale for both directions and across the slider.
    const meanOffset = Math.max(...clouds.map(({ mean, x, y }) => Math.hypot(mean.x - x, mean.y - y)));
    const viewRadius = Math.max(minViewRadius, meanOffset + gaussian95Radius * Math.hypot(maxStd, demoSigma / 2));
    plots[0].startBridge(green, orange, viewRadius);
    // Time reversal negates γ in the original plane. Conjugation reverses it
    // again, so the reverse panel uses its slider value in reflected coordinates.
    plots[1].startBridge(conjugateCloud(orange), conjugateCloud(green), viewRadius);
  }

  const reset = root.querySelector('[data-action="reset"]');
  const play = root.querySelector('[data-action="play"]');
  const playLabel = play.querySelector('[data-play-label]');
  const progress = root.querySelector('.distribution-seek');
  const timeValue = root.querySelector('#distribution-time');
  let animationFrame = null;
  let startedAt = null;
  function showProgress(time) {
    currentTime = Math.max(0, Math.min(time, 1));
    progress.value = currentTime;
    timeValue.value = `t = ${currentTime.toFixed(2)} T`;
    progress.setAttribute('aria-valuetext', timeValue.value);
    progress.style.setProperty('--seek', `${currentTime * 100}%`);
    plots.forEach(plot => plot.tank?.setProgress(currentTime));
  }
  function setPlaying(playing) {
    play.setAttribute('aria-pressed', String(playing));
    playLabel.textContent = playing ? 'Pause' : 'Play';
  }
  function pause() {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
    startedAt = null;
    setPlaying(false);
  }
  function animate(timestamp) {
    const time = Math.min((timestamp - startedAt) / playbackDuration, 1);
    showProgress(time);
    if (time < 1) animationFrame = requestAnimationFrame(animate);
    else pause();
  }
  reset.addEventListener('click', () => {
    pause();
    plots.forEach(plot => plot.tank?.resetView());
    resample();
    showProgress(0);
  });
  play.addEventListener('click', () => {
    if (play.disabled) return;
    if (animationFrame !== null) {
      pause();
      return;
    }
    if (currentTime >= 1) showProgress(0);
    startedAt = performance.now() - currentTime * playbackDuration;
    setPlaying(true);
    animationFrame = requestAnimationFrame(animate);
  });
  progress.addEventListener('input', () => {
    showProgress(Number(progress.value));
    if (animationFrame !== null) {
      if (currentTime >= 1) pause();
      else startedAt = performance.now() - currentTime * playbackDuration;
    }
  });
  resample();
  showProgress(0);
  play.disabled = plots.every(plot => !plot.tank);
}
