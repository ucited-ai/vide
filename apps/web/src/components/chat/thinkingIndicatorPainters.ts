/**
 * The dotted vocabulary the live indicator is drawn in.
 *
 * Every variant is one pure function: given a clock, the radius it may fill and
 * a scale for its dots, it returns the dots to paint for that instant. No
 * canvas, no timers, no DOM — `ThinkingIndicator` owns all of that, and these
 * stay a thing you can call in a test and reason about frame by frame.
 *
 * Unit space: x and y run roughly -1..1 before being multiplied by the radius,
 * y points up, and z is depth used only for painter's-order sorting and for
 * fading dots that have travelled behind the centre.
 *
 * `orbits` and `scan` are ports of the working / searching states of
 * thinking-orbs (github.com/Jakubantalik/thinking-orbs); `mark`, `sonar`,
 * `swarm` and `helix` are ours, in the same language.
 */

import type { ChatThinkingIndicator } from "@vide/contracts/settings";

export interface ThinkingIndicatorDot {
  /** Offset from the centre, in pixels, y pointing up. */
  readonly x: number;
  readonly y: number;
  /** Depth. Only ordering and alpha read it; it is never projected to a size. */
  readonly z: number;
  /** Dot radius in pixels. */
  readonly r: number;
  /** 0..1, clamped by the painter that consumes it. */
  readonly a: number;
}

/**
 * One frame of a variant.
 *
 * @param time    seconds on the indicator's own clock (already speed-scaled)
 * @param radius  pixels the variant may reach from the centre
 * @param scale   dot-size multiplier for the rendered size, so a 13px indicator
 *                and a 20px one keep the same visual weight rather than the
 *                same absolute dot radius
 */
export type ThinkingIndicatorPainter = (
  time: number,
  radius: number,
  scale: number,
) => ReadonlyArray<ThinkingIndicatorDot>;

/** Deterministic value noise. Same inputs, same dot layout, every session. */
function hash(a: number, b: number): number {
  const value = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** Spin about y, then tilt about x. Unit space in, unit space out. */
function project(yaw: number, tilt: number) {
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);
  const sinTilt = Math.sin(tilt);
  const cosTilt = Math.cos(tilt);
  return (x: number, y: number, z: number): readonly [number, number, number] => {
    const spunX = x * cosYaw + z * sinYaw;
    const spunZ = -x * sinYaw + z * cosYaw;
    return [spunX, y * cosTilt - spunZ * sinTilt, y * sinTilt + spunZ * cosTilt];
  };
}

/** The V from logo-master.svg as line segments in 0..1 space, with a dot count. */
const MARK_SEGMENTS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0.06, 0.078, 0.5, 0.921, 9],
  [0.582, 0.893, 0.932, 0.078, 9],
  [0.726, 0.208, 0.81, 0.208, 3],
  [0.684, 0.295, 0.779, 0.295, 3],
  [0.64, 0.384, 0.747, 0.384, 3],
  [0.598, 0.475, 0.713, 0.475, 3],
];

/** 1.62 across, 1.28 down — the mark keeps its 240:190 proportion. */
const MARK_DOTS = MARK_SEGMENTS.flatMap(([ax, ay, bx, by, count], segment) =>
  Array.from({ length: count }, (_, index) => {
    const along = index / (count - 1);
    return {
      x: (ax + (bx - ax) * along - 0.5) * 1.62,
      y: (0.5 - (ay + (by - ay) * along)) * 1.28,
      angle: hash(segment * 7 + index, 2.4) * Math.PI * 2,
      seed: hash(segment * 7 + index, 6.1),
    };
  }),
);

/** Particles running tilted orbits around a common centre. */
const orbits: ThinkingIndicatorPainter = (time, radius, scale) => {
  const dots: ThinkingIndicatorDot[] = [];
  const projectPoint = project(time * 0.12, 0.3);

  for (let orbit = 0; orbit < 3; orbit += 1) {
    const tiltSeed = hash(orbit, 1.7);
    const phaseSeed = hash(orbit, 5.2);
    const spinSeed = hash(orbit, 8.9);
    const orbitRadius = 0.45 + 0.52 * tiltSeed;
    const theta = tiltSeed * 2 * Math.PI;
    const phi = Math.acos(2 * phaseSeed - 1);
    const normalX = Math.sin(phi) * Math.cos(theta);
    const normalY = Math.cos(phi);
    const normalZ = Math.sin(phi) * Math.sin(theta);
    const length = Math.max(1e-6, Math.hypot(normalX, normalY));
    const uX = -normalY / length;
    const uY = normalX / length;
    const vX = -normalZ * uY;
    const vY = normalZ * uX;
    const vZ = normalX * uY - normalY * uX;
    const spin = (0.25 + 0.55 * spinSeed) * (spinSeed > 0.5 ? 1 : -1);

    const put = (
      angle: number,
      dotRadius: (depth: number) => number,
      alpha: (depth: number) => number,
    ) => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const [x, y, z] = projectPoint(
        (uX * cos + vX * sin) * orbitRadius,
        (uY * cos + vY * sin) * orbitRadius,
        vZ * sin * orbitRadius,
      );
      const depth = (z / orbitRadius + 1) / 2;
      dots.push({
        x: x * radius,
        y: y * radius,
        z,
        r: dotRadius(depth) * scale,
        a: alpha(depth),
      });
    };

    // The track itself: faint, still, and the thing the bright dots orbit on.
    for (let step = 0; step < 10; step += 1) {
      put(
        (step / 10) * 2 * Math.PI,
        () => 2.16,
        (depth) => 0.25 * (0.4 + 0.6 * depth),
      );
    }
    for (let traveller = 0; traveller < 3; traveller += 1) {
      put(
        time * spin + (traveller / 3) * 2 * Math.PI + phaseSeed * 6,
        (depth) => 2.88 + 3.84 * depth,
        (depth) => 0.6 + 0.34 * depth,
      );
    }
  }

  return dots;
};

/** A meridian sweeping a dotted globe, brightening what it passes. */
const scan: ThinkingIndicatorPainter = (time, radius, scale) => {
  const dots: ThinkingIndicatorDot[] = [];
  const spin = 0.5;
  const projectPoint = project(time * spin, 0.4 + 0.06 * Math.sin(time * 0.35));
  const beam = time * (spin + 1.2 * 4.3);

  for (let ring = 0; ring <= 6; ring += 1) {
    const latitude = -Math.PI / 2 + (ring / 6) * Math.PI;
    const cosLat = Math.cos(latitude);
    const sinLat = Math.sin(latitude);
    const count = Math.max(1, Math.round(Math.abs(cosLat) * 14));

    for (let step = 0; step < count; step += 1) {
      const longitude = (step / count) * 2 * Math.PI;
      const [x, y, z] = projectPoint(
        cosLat * Math.cos(longitude),
        sinLat,
        cosLat * Math.sin(longitude),
      );
      const depth = (z + 1) / 2;
      const fromBeam = Math.atan2(
        Math.sin(longitude + time * spin - beam),
        Math.cos(longitude + time * spin - beam),
      );
      // Only the near hemisphere lights up, so the beam reads as passing over
      // the surface rather than through it.
      const boost = Math.exp(-(fromBeam * fromBeam) / 0.18) * Math.max(0, z);
      dots.push({
        x: x * radius,
        y: y * radius,
        z,
        r: (1.4 + 3.6 * depth + 2.2 * boost) * scale,
        a: 0.3 + 0.7 * Math.min(1, boost + 0.18 + 0.5 * depth),
      });
    }
  }

  return dots;
};

/** The Vide V in dots, drifting off register and settling back. */
const mark: ThinkingIndicatorPainter = (time, radius, scale) => {
  const pulse = (1 - Math.cos(time * 0.85)) / 2;
  return MARK_DOTS.map((dot) => {
    const amplitude = pulse ** 2 * (0.1 + 0.2 * dot.seed);
    const drift = Math.sin(time * 0.9 + dot.seed * 6) * 0.03;
    return {
      x: (dot.x + Math.cos(dot.angle) * amplitude) * radius,
      y: (dot.y + Math.sin(dot.angle) * amplitude + drift) * radius,
      z: 0,
      r: (2.6 - 0.9 * pulse) * scale,
      a: 0.9 - 0.45 * pulse,
    };
  });
};

/** Rings of dots leaving the centre, like a slow sonar. */
const sonar: ThinkingIndicatorPainter = (time, radius, scale) => {
  const dots: ThinkingIndicatorDot[] = [{ x: 0, y: 0, z: 0, r: 2.6 * scale, a: 0.85 }];

  for (let ring = 0; ring < 3; ring += 1) {
    const progress = (time * 0.13 + ring / 3) % 1;
    const ringRadius = 0.12 + 0.86 * progress;
    const count = 6 + Math.round(14 * progress);
    const fade = Math.sin(Math.PI * progress) ** 0.7;

    for (let step = 0; step < count; step += 1) {
      const angle = (step / count) * 2 * Math.PI + time * 0.14 + ring;
      dots.push({
        x: Math.cos(angle) * ringRadius * radius,
        y: Math.sin(angle) * ringRadius * radius,
        z: 0,
        r: (2.4 - 1.1 * progress) * scale,
        a: 0.72 * fade,
      });
    }
  }

  return dots;
};

/** A small swarm gathering and letting go, never quite in sync. */
const swarm: ThinkingIndicatorPainter = (time, radius, scale) =>
  Array.from({ length: 22 }, (_, index) => {
    const phaseSeed = hash(index, 1.1);
    const radiusSeed = hash(index, 3.3);
    const breath = (1 + Math.sin(time * 0.5 + phaseSeed * 6.283)) / 2;
    const angle = phaseSeed * 6.283 + time * 0.08 * (radiusSeed > 0.5 ? 1 : -1);
    const distance = (0.22 + 0.72 * radiusSeed) * (0.34 + 0.66 * breath);
    return {
      x: Math.cos(angle) * distance * radius,
      y: Math.sin(angle) * distance * radius,
      z: 0,
      r: (1.9 + 1.5 * (1 - breath)) * scale,
      a: 0.35 + 0.55 * (1 - distance),
    };
  });

/** Two dotted strands winding around a vertical axis. */
const helix: ThinkingIndicatorPainter = (time, radius, scale) => {
  const dots: ThinkingIndicatorDot[] = [];
  const projectPoint = project(time * 0.55, 0.22);

  for (let strand = 0; strand < 2; strand += 1) {
    for (let step = 0; step < 15; step += 1) {
      const along = step / 14;
      const angle = along * Math.PI * 2.3 + strand * Math.PI + time * 0.15;
      const [x, y, z] = projectPoint(
        Math.cos(angle) * 0.52,
        (along - 0.5) * 1.7,
        Math.sin(angle) * 0.52,
      );
      const depth = (z + 1) / 2;
      dots.push({
        x: x * radius,
        y: y * radius,
        z,
        r: (1.5 + 2.6 * depth) * scale,
        a: 0.3 + 0.6 * depth,
      });
    }
  }

  return dots;
};

/** Keyed by the contract's own list, so a new id here fails to compile until it has a painter. */
export const THINKING_INDICATOR_PAINTERS = {
  orbits,
  scan,
  mark,
  sonar,
  swarm,
  helix,
} satisfies Record<ChatThinkingIndicator, ThinkingIndicatorPainter>;
