# Repository Guidelines

## Project Structure & Module Organization

This repository provides a NetEase Cloud Music plugin for MyGo Music.

- `src/` contains strict TypeScript modules for authentication, browsing, playback, and other features; `src/index.ts` defines the public entry point.
- `plugin.json` declares plugin metadata and permissions; `locales/zh-CN.json` supplies Simplified Chinese translations.
- `scripts/` contains build, packaging, versioning, and release tooling.
- `tests/*.test.ts` covers plugin behavior, `tests/tooling/` covers distribution tooling, and `tests/fixtures/` stores protocol and export contracts.
- `dist/plugin/` and `dist/release/` contain generated installation files and archives. Do not edit generated output.

## Build, Test, and Development Commands

Use Node.js 22 from `.nvmrc` and the pnpm version pinned in `package.json`.

- `pnpm install --frozen-lockfile`: install the locked dependencies.
- `pnpm build`: bundle the plugin into one standalone ES module and copy installation assets.
- `pnpm test`: build, then run plugin and tooling tests.
- `pnpm typecheck` and `pnpm lint`: check TypeScript and ESLint rules.
- `pnpm format:check`: verify formatting; `pnpm format` applies it.
- `pnpm package`: produce the verified installation ZIP.
- `pnpm check`: run the complete validation and packaging pipeline used by CI.

For local testing, install `dist/plugin/` in MyGo Music; there is no standalone development server.

## Coding Style & Naming Conventions

Use two-space indentation, double quotes, semicolons, and Prettier's configured 100-column width. Prefer camelCase functions and variables, PascalCase types, and lowercase descriptive module filenames.

Keep runtime code host-compatible: `src/` must not import `node:*` or use `process`, `Buffer`, or `require`. Preserve SPDX headers and avoid circular source imports. Keep dependencies exactly pinned and use pnpm exclusively.

## Testing Guidelines

Tests use `node:test`, strict assertions, and `tsx`. Name tests `*.test.ts` and describe observable behavior. Reuse `tests/harness.ts` to mock host storage and network responses; plugin tests exercise the built bundle.

Add regression tests for behavior changes. Run `pnpm build` before focused suites such as `pnpm test:plugin`. No numerical coverage threshold is configured.

## Commit & Pull Request Guidelines

Follow the existing imperative, prefixed commit style: `feat:`, `fix:`, `refactor:`, and `test:`.

PRs should explain the change, link relevant issues, report validation results, and include screenshots for visible changes. Run `pnpm check` before review.

## Security & Configuration

Never commit session cookies or account data. Sessions are stored unencrypted by the host. Preserve network permission boundaries and keep version metadata synchronized through `pnpm version:set <version>`.
