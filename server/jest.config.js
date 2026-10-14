export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // Source imports use NodeNext-style `./x.js`; map them back to the .ts files.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Most suites run against the real skipli-dev Firestore over the network, several files in parallel.
  // The 5 s default is too tight for a test that makes a handful of transactions.
  testTimeout: 20_000,
};
