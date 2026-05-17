import { Platform, TextStyle } from 'react-native';

export const palette = {
  void: '#05070D',
  space: '#0A0E1A',
  surface: '#121826',
  surfaceElevated: '#1A2236',
  hairline: '#1E2A44',
  hairlineStrong: '#2A3A5C',

  text: '#E6ECFF',
  textMuted: '#8A97B8',
  textDim: '#5A6584',

  accent: '#00E5FF',
  accentDim: '#0089A8',
  accentGlow: 'rgba(0, 229, 255, 0.45)',
  accentSoft: 'rgba(0, 229, 255, 0.12)',

  premium: '#FFD24A',
  premiumGlow: 'rgba(255, 210, 74, 0.5)',

  danger: '#FF4D6A',
  success: '#22E39E',

  gridLine: 'rgba(0, 229, 255, 0.18)',
  gridLineDim: 'rgba(0, 229, 255, 0.08)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
const sans = Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' });

export const typography = {
  display: {
    fontFamily: sans,
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: palette.text,
  } satisfies TextStyle,
  h1: {
    fontFamily: sans,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: palette.text,
  } satisfies TextStyle,
  h2: {
    fontFamily: sans,
    fontSize: 20,
    fontWeight: '700',
    color: palette.text,
  } satisfies TextStyle,
  body: {
    fontFamily: sans,
    fontSize: 15,
    fontWeight: '500',
    color: palette.text,
  } satisfies TextStyle,
  bodyMuted: {
    fontFamily: sans,
    fontSize: 15,
    fontWeight: '500',
    color: palette.textMuted,
  } satisfies TextStyle,
  label: {
    fontFamily: mono,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: palette.textMuted,
  } satisfies TextStyle,
  mono: {
    fontFamily: mono,
    fontSize: 14,
    color: palette.text,
  } satisfies TextStyle,
} as const;

export const glow = {
  accent: {
    shadowColor: palette.accent,
    shadowOpacity: 0.8,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  accentSoft: {
    shadowColor: palette.accent,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  premium: {
    shadowColor: palette.premium,
    shadowOpacity: 0.7,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
} as const;

export const motion = {
  fast: 150,
  base: 220,
  slow: 380,
} as const;
