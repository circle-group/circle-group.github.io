import { createSeededRandom, createVisitRandom, sampleCloud, sampleStandardNormalPair, sampleWithoutReplacement } from './distribution-samples.js';
import { createDistributionTank } from './distribution-tank.js';
import { createGaussianBridge } from './gaussian-bridge.js';
import { demoSigma, sampleDemoShapes } from './gaussian-demo-diffusion.js';
import { createBackgroundMatcher } from './gaussian-pairs.js';
import { transformBridgePath } from './spiral-bridge.js';
import { createSpiralMarginal } from './spiral-marginal.js';
import { bridgeAngle, gaussian95Radius, spiralGuidePoint } from './gaussian-coordinates.js';
import { createWPlaneMinimap } from './cmap.js';

// Fixed plot origins make the randomized means visible on the shared scale.
const distributions = [
  { x: -2.35, y: -0.35 },
  { x: 2.35, y: 0.35 },
];
const meanJitterStd = 1.25;
const minViewRadius = 4;
const playbackDuration = 4000;
const initialTime = 0.5;
const pathSteps = 320;
const visibleParticles = 128;
const animatedPathCount = 3;

const conjugate = point => ({ ...point, y: -point.y });

function conjugateCloud(cloud) {
  return {
    ...conjugate(cloud),
    mean: conjugate(cloud.mean),
    covariance: { ...cloud.covariance, xy: -cloud.covariance.xy },
    points: cloud.points.map(conjugate),
  };
}

function swapPair({ sourceIndex, targetIndex }) {
  return { sourceIndex: targetIndex, targetIndex: sourceIndex };
}

export function prepareDirections(tanks, sourcePool, targetPool, viewRadius, normalPair, seed) {
  const source = { ...sourcePool, points: sourcePool.points.slice(0, visibleParticles) };
  const random = createSeededRandom(seed);
  const sourceIndices = sampleWithoutReplacement([...source.points.keys()], animatedPathCount, random);
  const reference = createGaussianBridge(source, targetPool, demoSigma);
  // Each Brownian SB path draws its target from π₀(dy|x) before drawing its bridge noise.
  const baselinePaths = sourceIndices.map(i => reference.samplePath(source.points[i], pathSteps, normalPair));
  const endpoints = baselinePaths.map(path => path[path.length - 1]);
  const scatter = sampleWithoutReplacement(targetPool.points, visibleParticles - endpoints.length, random);
  const target = { ...targetPool, points: [...endpoints, ...scatter] };
  const pairs = sourceIndices.map((sourceIndex, targetIndex) => ({ sourceIndex, targetIndex }));

  const reverseSource = conjugateCloud(target), reverseTarget = conjugateCloud(source);
  const directions = [
    { source, target, pairs, baselinePaths, reference },
    { source: reverseSource, target: reverseTarget, pairs: pairs.map(swapPair),
      baselinePaths: baselinePaths.map(path => path.slice().reverse().map(conjugate)),
      reference: createGaussianBridge(reverseSource, reverseTarget, demoSigma) },
  ];
  const transitions = directions.map(({ reference }) => reference.endpointTransition(pathSteps));
  const matchers = directions.map(({ source, target, pairs }, i) =>
    createBackgroundMatcher(source.points, target.points, pairs, transitions[i]));
  return directions.map(({ source, target, pairs, baselinePaths, reference }, i) => {
    const forward = i === 0;
    // In either panel condition on the point the user clicked. A click on this
    // target cap is a source lookup in the other panel, with the indices swapped.
    function matchBackground(sourceSide, index) {
      if (sourceSide) return matchers[i](true, index);
      const other = matchers[1 - i](true, index);
      return other && swapPair(other);
    }
    return (gamma, time) => {
      const population = gamma === 0 ? reference : createSpiralMarginal(source, target, transitions[i], gamma, forward, demoSigma);
      const beforeRotation = gamma === 0 ? null : reference;
      const paths = baselinePaths.map(path => transformBridgePath(path, gamma, forward));
      const spiralPointAt = (t, start, end) => spiralGuidePoint(t, start, end, gamma, forward);
      tanks[i]?.setSamples(source, target, pairs, viewRadius, population, paths, time, spiralPointAt, matchBackground, beforeRotation);
    };
  });
}

export function setupDistributionDemo(root) {
  if (!root) return;
  const random = createVisitRandom();
  const normalPair = () => sampleStandardNormalPair(random);
  let currentTime = initialTime;
  const plots = Array.from(root.querySelectorAll('.distribution-panel'), (panel, index) => {
    const forward = index === 0;
    const figure = panel.querySelector('.distribution-figure');
    const canvas = figure.querySelector('.distribution-viewport > canvas');
    const minimap = createWPlaneMinimap(figure.querySelector('.w-plane-minimap'));
    const gamma = panel.querySelector('.gamma-control input');
    const gammaValue = panel.querySelector('.gamma-control output');
    const angleValue = panel.querySelector('[data-rotation-angle]');
    function showAngle(time) {
      if (time === (forward ? 1 : 0)) {
        angleValue.textContent = '—';
        return;
      }
      const degrees = bridgeAngle(time, gamma.valueAsNumber, forward) * 180 / Math.PI;
      const rounded = Math.round(degrees * 10) / 10;
      angleValue.textContent = `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}°`;
    }
    function setGamma(rotation) {
      gamma.value = rotation;
      gammaValue.value = rotation.toFixed(3);
      minimap.setGamma(forward ? rotation : -rotation);
      showAngle(currentTime);
    }
    let drawDirection;
    let pendingFrame = null;
    gamma.addEventListener('pointerdown', pause);
    gamma.addEventListener('input', () => {
      if (animationFrame !== null) pause();
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
        forward,
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
    function startBridge(draw) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
      setGamma(0);
      drawDirection = draw;
      drawDirection(0, initialTime);
    }
    return { ...distributions[index], color, tank, startBridge, showAngle };
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
    const seed = Math.floor(random() * 0x100000000);
    const draws = prepareDirections(plots.map(plot => plot.tank), green, orange, viewRadius, normalPair, seed);
    plots.forEach((plot, i) => plot.startBridge(draws[i]));
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
    timeValue.value = `Elapsed ${currentTime.toFixed(2)} T`;
    progress.setAttribute('aria-valuetext', timeValue.value);
    progress.style.setProperty('--seek', `${currentTime * 100}%`);
    for (const plot of plots) {
      plot.showAngle(currentTime);
      plot.tank?.setProgress(currentTime);
    }
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
    showProgress(initialTime);
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
  showProgress(initialTime);
  play.disabled = plots.every(plot => !plot.tank);
}
