# Changelog

All notable changes to `cathode-fx`. Format based on [Keep a Changelog](https://keepachangelog.com/), versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.1.0]

### Added
- `createCRT` / `attach`: WebGL2 multi-pass CRT renderer using the Toddler-Boy/CRTEmulation-Data shaders.
- `Cathode` API: preset matrix (`Presets.{Simple,Detailed,Exhaustive}.{Clean,Enhance,Degrade}`), grouped settings,
  `gl` and `fast` (Canvas2D) backends, `requestVideoFrameCallback` loop.
- AC hum bar (`signal.humBar`), TypeScript declarations.
