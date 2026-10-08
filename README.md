# Agent Orchestrator: unofficial security patches

Three small, independent patches for [OrchestratorInc/agent-orchestrator](https://github.com/OrchestratorInc/agent-orchestrator). Together they upgrade the desktop app from the end-of-life Electron 33.4.11 to Electron 44.7.0, harden the packaged binary with Electron fuses, and update the vulnerable dependencies that ship inside the app. Each patch is a `git am`-ready commit with a full explanation in its message. They were built and tested on Linux x64 against upstream `main` at the base commit listed below, and have since been verified on an Apple Silicon Mac in daily use.

> [!IMPORTANT]
> **Unofficial.** This repository is not affiliated with or endorsed by the Agent Orchestrator maintainers. The patches are offered as a proposal and for people who build the app themselves. Use them at your own risk. Upstream is licensed under Apache-2.0, and these patches are offered under Apache-2.0 as well (see [LICENSE](LICENSE)). Upstream discussion: [OrchestratorInc/agent-orchestrator#6446](https://github.com/OrchestratorInc/agent-orchestrator/issues/6446).

## Contents

| Path | What it is |
| --- | --- |
| [`patches/0001-deps-update-vulnerable-dependencies.patch`](patches/0001-deps-update-vulnerable-dependencies.patch) | Updates the vulnerable packages in the shipped dependency tree (dompurify, js-yaml, katex, seroval, fflate, ...) |
| [`patches/0002-electron-upgrade-to-44.patch`](patches/0002-electron-upgrade-to-44.patch) | Electron 33.4.11 → 44.7.0, plus the code changes Electron 44 requires |
| [`patches/0003-electron-fuses.patch`](patches/0003-electron-fuses.patch) | Electron fuses through `@electron-forge/plugin-fuses` |
| [`patches/security-updates.patch`](patches/security-updates.patch) | All three patches in one mbox file (same content as 0001–0003) |
| [`evidence/`](evidence/) | Fuse readouts before and after, the CORS reproduction for GHSA-v3j7-r9gq-3gjw, and an npm audit summary |

The patches apply in order (0002 builds on 0001's lockfile, and 0003 builds on 0002's). `git am patches/000*.patch` (or `git am patches/security-updates.patch`) applies all three at once.

## Base

- Upstream commit: [`6eb6c096741877bfdf12a8e0c4a462bf2cb92df8`](https://github.com/OrchestratorInc/agent-orchestrator/commit/6eb6c096741877bfdf12a8e0c4a462bf2cb92df8) (`main`, 2026-10-08 23:28 +0530)
- Latest release at that time: [v0.13.5](https://github.com/OrchestratorInc/agent-orchestrator/releases/tag/v0.13.5)

Upstream moves quickly. The lockfile hunks in particular will stop applying cleanly once upstream touches `frontend/package-lock.json`. If that happens, apply the `package.json` and source changes by hand, then regenerate the lockfiles with `npm install` and `npm audit fix` (without `--force`).

## Problem

Agent Orchestrator runs coding agents with access to the user's source code, sessions and credentials, so a compromise of the desktop app is high-impact. Each problem below ends with a realistic "What could happen" scenario. These describe what the weakness makes possible. We know of no exploitation of any of them against Agent Orchestrator.

### 1. The desktop app ships an end-of-life Electron

- The v0.13.5 Linux package (`agent-orchestrator-linux-x64.deb`) contains **Electron 33.4.11** (Chrome 130.0.6723.191), as read from the bundled `version` file and the binary.
- Electron 33 reached end-of-life on **2025-04-28** ([endoflife.date](https://endoflife.date/electron)), and 33.4.11 is its last release.
- On 2026-10-08, `npm audit` listed **38 advisories** against `electron@33.4.11`: 11 high, 21 moderate, 6 low.
- At the time of writing, upstream has two open Dependabot PRs that bump Electron: [#5839](https://github.com/OrchestratorInc/agent-orchestrator/pull/5839) (→ 39.8.10) and [#6060](https://github.com/OrchestratorInc/agent-orchestrator/pull/6060) (→ 41.10.6). Both target lines that are already end-of-life (39 on 2026-05-05, 41 on 2026-08-24). The supported lines are currently 42, 43 and 44, and 44 is supported until 2027-03-02.

**What could happen:** the embedded browser renders arbitrary web pages with Chromium 130, which no longer receives security fixes. A malicious or compromised page opened there, for example a link from an issue, a PR description or agent output, could use a publicly known Chromium/V8 bug to take over the renderer and, chained with a sandbox escape, run code with the app's privileges. That process can reach the user's repositories, agent sessions, API keys and tokens, and browser cookies imported into the embedded browser. New Chromium bugs of this kind are found regularly, and on Electron 33 their fixes no longer arrive.

### 2. GHSA-v3j7-r9gq-3gjw applies to the `app://` renderer scheme

The renderer is served from a privileged custom scheme registered in `frontend/src/main.ts` as:

```ts
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
```

[GHSA-v3j7-r9gq-3gjw](https://github.com/electron/electron/security/advisories/GHSA-v3j7-r9gq-3gjw) (high, CVSS 7.4) describes this exact configuration: on affected Electron versions, a page from another origin in the same session can `fetch()` the scheme and read the response. It is fixed in 39.8.10, 40.9.3, 41.4.0 and 42.0.0. Practical impact depends on whether untrusted content can ever load in the default session. In the upstream code the embedded browser uses separate session partitions, while `app://` is registered on the default session only. The safe fix either way is to run an Electron version that enforces CORS for the scheme. The reproduction in [`evidence/cors-check/`](evidence/cors-check/) confirms that 33.4.11 is affected (see the table [below](#why-corsenabled-is-deliberately-not-added)).

**What could happen:** if a page from another origin ever runs in the default session, for example through a future change in how links or previews are opened, its script could `fetch()` `app://` URLs and read the responses: the renderer's code and anything else the `app://` handler serves. The app's own same-origin boundary would not hold. Today this needs such a page to reach the default session, so it is a latent weakness rather than a known attack path.

### 3. No Electron fuses are set

`npx @electron/fuses read` on the binary from the v0.13.5 `.deb` (full output in [`evidence/fuses-v0.13.5-release.txt`](evidence/fuses-v0.13.5-release.txt)):

```
RunAsNode is Enabled
EnableCookieEncryption is Disabled
EnableNodeOptionsEnvironmentVariable is Enabled
EnableNodeCliInspectArguments is Enabled
EnableEmbeddedAsarIntegrityValidation is Disabled
OnlyLoadAppFromAsar is Disabled
LoadBrowserProcessSpecificV8Snapshot is Disabled
GrantFileProtocolExtraPrivileges is Enabled
```

With `RunAsNode` enabled, `ELECTRON_RUN_AS_NODE=1 agent-orchestrator -e '…'` turns the app binary into a general-purpose Node.js interpreter. On v0.13.5 this prints `v20.18.3`. Together with `NODE_OPTIONS` and `--inspect`, this lets other local code run under the app's identity and inherit any OS-level trust or permissions granted to it. Electron's [fuses guide](https://www.electronjs.org/docs/latest/tutorial/fuses) recommends turning these off for apps that do not need them.

**What could happen:** malware or a malicious package already running as the user, for example a compromised `postinstall` script in a repository an agent works on, starts the trusted app binary with `ELECTRON_RUN_AS_NODE=1` or `NODE_OPTIONS=--require …` and runs its own code under the app's identity. On macOS that code inherits what the user has granted the app, including access to its "Agent Orchestrator Safe Storage" Keychain item, which Chromium uses to encrypt the app's local data such as cookies, among them any imported into the embedded browser. Separately, with ASAR integrity validation and `OnlyLoadAppFromAsar` off, anyone who can write to the app's files can modify or replace `app.asar`, and the modified code loads silently on the next start. These scenarios need local code execution first. The fuses stop the trusted app from being used as a vehicle for it.

### 4. Vulnerable dependencies that actually ship

`npm audit --omit=dev` in `frontend/` on the base reports 7 packages (1 critical, 2 high, 1 moderate, 3 low). These are bundled into the app. The assessment below is a best-effort reading of how each package is used, not a full audit:

| Package (version) | Advisories | How it ships | Assessment |
| --- | --- | --- | --- |
| seroval 1.5.4 | GHSA-p6vx-979v-rg4c (critical), GHSA-jp82-f5mq-hwhp (high) | `@tanstack/router-core` | Both concern deserialization (`fromJSON` and JSON deserialization). The renderer is a client-side SPA, and we found no path that feeds untrusted serialized data to seroval. Probably not reachable, but not exhaustively verified. |
| js-yaml 4.2.0 | GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh (high, CPU DoS) | `electron-updater` | Parses update metadata (`latest*.yml`) fetched over HTTPS from the release feed. Only whoever controls that feed can supply input, and the impact is denial of service. |
| brace-expansion | several DoS advisories (high) | transitive | Needs attacker-controlled glob or brace patterns. Not believed reachable. |
| fflate 0.4.8 | GHSA-px8p-9vwx-vf98 (moderate) | `posthog-js` | The advisory is about `unzipSync` parsing malformed ZIP64 archives. posthog-js uses fflate to compress outgoing payloads, so this is not believed reachable. |
| dompurify 3.4.14 | GHSA-p98j-92pf-mc4p, GHSA-6688-9rhm-gjv2 (low) | direct; also used by `mermaid` and `posthog-js` | Both affect only the `IN_PLACE` mode. The app's own source does not use it, and the bundled consumers were not audited. |
| katex 0.16.47 (and mermaid, via katex) | GHSA-238p-pmpm-9mq7 (low) | `mermaid` | Requires pre-existing prototype pollution. |

**What could happen:** for the specific advisories above, the realistic impact is low, mostly denial of service or preconditions that the app does not meet. The broader point is that these libraries process content an attacker can influence: Markdown, Mermaid diagrams and math from repository files and agent output, and update metadata from the release feed. A crafted file in a repo, or agent output that echoes it, could hit a sanitizer or parser bug and cause XSS in the renderer, which talks to the main process over IPC. A tampered update feed could hang the updater. Keeping these parsers patched is cheap insurance.

The other findings in `npm audit` without `--omit=dev` are build-time only. See [Remaining audit findings](#remaining-audit-findings).

## What the patches change

### 0001: `chore(deps): update vulnerable dependencies shipped in the desktop app`

- `dompurify` 3.4.14 → 3.4.16.
- npm `overrides`: `js-yaml` `^4.3.2` (resolves to 4.3.2) and `katex` `^0.18.2` (resolves to 0.18.10). The latest mermaid release still declares `katex ^0.16`, so an override is the only way to pick up the fix without a major bump.
- `npm audit fix` without `--force` in `frontend/`, `packages/product-ui/` and `packages/cloud-client/`. This moves seroval, fflate, brace-expansion, undici, @xmldom/xmldom and other transitive packages to patched versions within their declared ranges.
- Result: `npm audit --omit=dev` in `frontend/` drops from 7 to 0, and `npm audit` in `product-ui` and `cloud-client` drops to 0.

### 0002: `chore(electron): upgrade Electron from 33.4.11 (end-of-life) to 44.7.0`

- `electron` `^33.0.0` → `^44.7.0`.
- **Clipboard.** Electron 44 rearchitected the clipboard module into an async, W3C-style API:
  - `clipboard.writeText(text, "selection")` becomes `clipboard.selection.writeText(text)`, and both writes are awaited.
  - `clipboard.writeImage()` was removed. The browser view host keeps its narrow `writeImage(image)` dependency, and `main.ts` adapts it to `clipboard.write([new ClipboardItem({ "image/png": Blob })])`. The existing unit-test fakes are unchanged.
- `app.dock` is typed as optional in Electron 44, so the call becomes `app.dock?.setIcon(...)`.
- Removes the `allowScripts` entry for `electron@33.4.11`. Since Electron 42 the npm package has no install script.
- Refreshes `node-abi` in the lockfile. Without this, `@electron/rebuild`, which upstream's `prePackage` hook uses to rebuild `better-sqlite3`, fails with `Could not detect abi for version 44.7.0 and runtime electron`.
- The other breaking changes between 34 and 44 were checked against the code: `clearStorageData` quotas, `plugin-crashed`, `getBitmap`, `showHiddenFiles`, `ELECTRON_OZONE_PLATFORM_HINT`, renderer clipboard access and others. No other usages were found. The positional arguments of the `console-message` event in `browser-view-host.ts` are deprecated since Electron 35 but still work.

### 0003: `build(electron): harden the packaged binary with Electron fuses`

Adds `@electron-forge/plugin-fuses` 7.11.2 (same version as the rest of Forge) and `@electron/fuses` 1.8.0. The fuses are flipped at package time:

| Fuse | Value |
| --- | --- |
| `RunAsNode` | `false` |
| `EnableNodeOptionsEnvironmentVariable` | `false` |
| `EnableNodeCliInspectArguments` | `false` |
| `EnableEmbeddedAsarIntegrityValidation` | `true` |
| `OnlyLoadAppFromAsar` | `true` |
| `GrantFileProtocolExtraPrivileges` | `false` |

- `git grep` finds no use of `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS`, `--inspect`, `child_process.fork` or `utilityProcess` in the app, and the ACP runtime ships its own Node binary.
- `electron-forge start` and the Playwright e2e launch the unfused `node_modules/electron` binary, so they are unaffected.
- For unsigned macOS arm64 builds, the Forge plugin resets the ad-hoc signature after flipping fuses.
- `EnableCookieEncryption` is left unchanged. It deserves a separate decision, because turning it on is a one-way change for existing cookie stores.

## Why `corsEnabled` is deliberately not added

An earlier version of GHSA-v3j7-r9gq-3gjw suggested adding `corsEnabled: true` as a workaround. The advisory was corrected on 2026-09-03: `corsEnabled: true` **permits** cross-origin reads of the scheme rather than restricting them (see also [electron/electron#53408](https://github.com/electron/electron/pull/53408)). We verified this with [`evidence/cors-check/main.js`](evidence/cors-check/main.js). A page on `http://127.0.0.1:<port>` calls `fetch("app://renderer/secret")`:

| Electron | `corsEnabled` | Result |
| --- | --- | --- |
| 33.4.11 | `false` (as shipped) | `READ:SECRET`, cross-origin read succeeds |
| 44.7.0 | `false` (as shipped) | `BLOCKED: Failed to fetch`, handler not invoked |
| 44.7.0 | `true` | `READ:SECRET`, cross-origin read succeeds |

The fix is the Electron upgrade (patch 0002), with the scheme registration left as it is.

## How to apply

Prerequisites are the same as for upstream's own build: Node 24, npm 11, and the Go toolchain required by upstream's `go.work` for the bundled daemon.

```sh
git clone https://github.com/OrchestratorInc/agent-orchestrator.git
cd agent-orchestrator
git switch -c security-updates 6eb6c096741877bfdf12a8e0c4a462bf2cb92df8
git am /path/to/agent-orchestrator-security-patches/patches/000*.patch

cd frontend
npm ci
npx install-electron     # optional: download the Electron 44 binary now instead of on first run
npm run typecheck
npx vitest run
npm run package          # or your usual make/publish command
npx @electron/fuses read --app "out/Agent Orchestrator-linux-x64/agent-orchestrator"
# macOS arm64: npx @electron/fuses read --app "out/Agent Orchestrator-darwin-arm64/Agent Orchestrator.app"
```

Notes:

- **Electron binary download.** Electron ≥ 42 no longer downloads its binary in `postinstall`. The binary is fetched on the first `electron` run, or explicitly with `npx install-electron`. Offline or cached CI setups may need adjusting, for example via `ELECTRON_CACHE` or a mirror.
- **node-abi.** If you regenerate the lockfile yourself, make sure the `node-abi` copy used by `@electron/rebuild` knows Electron 44 (4.37.0 or newer for the 4.x line). Otherwise packaging fails with `Could not detect abi for version 44.7.0`.
- **better-sqlite3 and vitest.** `npm run package` rebuilds `better-sqlite3` for Electron in place in `node_modules`. If you run `vitest` after packaging, the native module has the Electron ABI and the `browser-profile-import` tests fail to load it. Restore a Node build first, for example by running `npx prebuild-install -r node` inside `node_modules/better-sqlite3`. This is upstream behavior and is not changed by the patches.

## Before you switch to a patched build

- **Version string.** A build from `main` carries the version from `frontend/package.json`, currently `0.13.0`, because upstream only bumps it at release time. The in-app updater therefore treats the patched build as older than the latest official release and offers to update to it (v0.13.5 at the time of writing). Accepting that update replaces the patched build and brings back Electron 33.
- **No safe downgrade.** The SQLite migrations only run forward. Going back to an older official release after running a newer build is not guaranteed to work. Upstream notes in [`auto-updater.ts`](https://github.com/OrchestratorInc/agent-orchestrator/blob/6eb6c096741877bfdf12a8e0c4a462bf2cb92df8/frontend/src/main/auto-updater.ts#L163-L164) that "an older binary cannot safely read a database already migrated by this one". **Back up `~/.ao`** (and keep a copy of your current app) before switching in either direction.

## Testing done

### Linux x64

Environment: Linux x64 (Debian trixie container), Node 24.21.0, npm 11.19.0, Go 1.27.1, Xvfb. Everything was run on the upstream base first, then with the patches applied, using the same commands.

| Check | Base | With 0001–0003 |
| --- | --- | --- |
| `npm run typecheck` / `npm run typecheck:e2e` (frontend) | pass | pass |
| `npx vitest run` (frontend) | 6554 passed, 7 skipped | 406 files, 6554 passed, 7 skipped |
| `packages/product-ui`: typecheck + tests | pass, 156 tests | pass, 156 tests |
| `packages/cloud-client`: typecheck + tests | pass | pass, 28 tests |
| `npm run package` | pass | pass |
| `electron-forge make --targets @electron-forge/maker-deb` | pass | pass |
| `better-sqlite3` loads from the packaged `app.asar` | not run | yes (Electron 44.7.0, NODE_MODULE_VERSION 149, SQLite 3.53.2) |
| App launch under Xvfb, 45 s | home screen renders, daemon starts | home screen renders, daemon starts, no new errors (only the GPU and D-Bus noise that is also present on the base) |
| Fuse readout of the built binary and `.deb` | all defaults | as in the table above ([evidence](evidence/fuses-patched-build.txt)) |
| `ELECTRON_RUN_AS_NODE=1 … -e` | runs as Node | ignored, the app starts normally |
| Cross-origin `fetch()` to `app://` | readable | blocked |

During development the same checks (typecheck, vitest, package, deb, launch) were also run cumulatively after each patch: 0001, then 0001+0002, then 0001–0003.

### macOS arm64

Environment: Apple Silicon Mac, macOS 27.0, Node 24. The app was packaged with `electron-forge` and ad-hoc signed (not notarized).

- The three patches applied cleanly to the same base commit, with no changes.
- The installed app reports **Electron 44.7.0**.
- `npx @electron/fuses read` on the installed `.app`, for the six fuses set by patch 0003:
  ```
  RunAsNode is Disabled
  EnableNodeOptionsEnvironmentVariable is Disabled
  EnableNodeCliInspectArguments is Disabled
  EnableEmbeddedAsarIntegrityValidation is Enabled
  OnlyLoadAppFromAsar is Enabled
  GrantFileProtocolExtraPrivileges is Disabled
  ```
- The build is in daily use against an existing data directory (`~/.ao`, several GB) previously used by official v0.13.4. The SQLite migrations ran forward on first start. Projects, sessions, project rules and instructions, agent launches, hooks and the embedded browser all keep working, with no functional differences observed compared with v0.13.4.
- The full test suite was not re-run on macOS. The test results above are from Linux.

## Not tested

- **macOS:** Developer ID signing, notarization, the Squirrel.Mac and differential updater paths, and the macOS-specific `app.dock` behavior. The macOS build above was ad-hoc signed only.
- **ASAR integrity:** `EnableEmbeddedAsarIntegrityValidation` is only enforced on macOS and Windows, so it is a no-op in the Linux build. The ad-hoc-signed macOS build runs normally with it enabled. It still needs validation with properly signed macOS builds and on Windows.
- **Windows:** the NSIS installer and Squirrel/update flow.
- **Linux packaging other than `.deb`:** rpm could not be built in the test environment (rpm 4.20 incompatibility of the rpm maker, also present on the base). AppImage was not rebuilt with the patches.
- **Agents and logins:** on Linux, no agent sessions were exercised. On macOS, agent launches and hooks work (see above). GitHub login and other account flows were not specifically checked.
- **Clipboard image copy** (the screenshot-to-clipboard actions of the embedded browser) through the UI. It is covered only by unit tests and type checks.
- **`file://` pages in the embedded browser** with `GrantFileProtocolExtraPrivileges` disabled.
- **Mermaid math rendering** with KaTeX 0.18.
- `packages/mobile` (Expo) was not touched.

## Remaining audit findings

With all three patches, `npm audit` in `frontend/` still reports 40 findings (1 critical, 29 high, 7 moderate, 3 low), and `npm audit --omit=dev` reports **0**. All remaining findings are in build-time tooling, mainly the Electron Forge 7 toolchain. The critical one is `tar` 6.2.1, pulled in by `@electron/rebuild` 3.x through `@electron-forge/cli`, `core` and `shared-types`. Clearing these most likely needs a move to Electron Forge 8, a major upgrade that is out of scope here.

## Upstream

- Issue: [OrchestratorInc/agent-orchestrator#6446](https://github.com/OrchestratorInc/agent-orchestrator/issues/6446)
- The patches are split so that each one can become its own small PR, following upstream's one-issue-per-PR rule.

## About this work

The analysis and patches were prepared with AI assistance and then verified on Linux x64 and macOS arm64 as described above. Every number and readout in this README comes from an actual run. If you find a mistake, please open an issue.

## License

[Apache License 2.0](LICENSE), the same license as upstream.
