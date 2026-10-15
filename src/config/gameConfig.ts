export const GAME_CONFIG = {
  energy: {
    maximum: 100,
    passiveDrain: 0.13,
    closedGateDrain: 0.22,
    mirrorDrain: 0.1,
    lightDrain: 0.18,
  },
  gate: {
    transitionSeconds: 1.45,
  },
  mirror: {
    transitionSeconds: 0.45,
  },
  bell: {
    cooldownSeconds: 24,
    stunSeconds: 7,
    attractionSeconds: 7,
  },
  loop: {
    fixedStepSeconds: 1 / 30,
    maxFrameSeconds: 0.25,
  },
} as const;
