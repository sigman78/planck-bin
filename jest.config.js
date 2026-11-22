import { createDefaultPreset } from 'ts-jest';

const tsJestTransformCfg = createDefaultPreset().transform;

/** @type {import("jest").Config} **/
export default {
  testEnvironment: 'jsdom',
  transform: {
    ...tsJestTransformCfg,
    // @mdit plugins ship as ES modules only; compile them to CommonJS for jest.
    '[\\\\/]@mdit[\\\\/].+\\.js$': ['ts-jest', { tsconfig: { allowJs: true }, diagnostics: false }],
  },
  transformIgnorePatterns: ['[\\\\/]node_modules[\\\\/](?!\\.pnpm[\\\\/]@mdit\\+|@mdit[\\\\/])'],
};
