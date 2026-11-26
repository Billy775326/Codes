# Develop and test Codes

Develop on Linux with the Node.js version in [package.json](../package.json). Use an isolated data directory and an available port when a workspace is already running.

## Build and run

```bash
npm ci
npm run build
CODES_RUNTIME=mock CODES_DATA_DIR=.local/dev CODES_PORT=6671 npm start
```

Open [http://127.0.0.1:6671](http://127.0.0.1:6671) and use the token from that instance's data directory. For Vite development, use the same environment with `npm run dev`. Cloudflare Access uses the built server.

The simulator uses synthetic conversations and viewable browser flows. A message containing `[approve]` or `[question]` opens the corresponding interaction. `[slow]` exercises streaming and reconnection, and `[hold]` keeps a test turn open until stopped.

## Checks

| Command                | Purpose                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `npm run format:check` | Prettier formatting                                                        |
| `npm run check`        | TypeScript checking                                                        |
| `npm test`             | Unit and integration tests                                                 |
| `npm run build`        | Client bundle and compiled Node server                                     |
| `npm run test:e2e`     | Build, run the simulator server, and exercise browser workflows            |
| `npm run test:native`  | Inspect a real CLI and its App Server metadata with a temporary Codex home |

Run `npx playwright install chromium` before browser checks or set `CODES_CHROME` to a suitable local Chrome executable. Browser tests use a temporary project, a test token, the simulator, and a local listener on port 19140. Direct Playwright invocations reuse the existing `dist` build.

The [CI workflow](../.github/workflows/checks.yml) runs formatting, types, unit/integration, and browser checks. Native metadata smoke runs separately against CLI 0.166.0, 0.167.0, 0.168.0, and 0.172.0. Codes detects the installed App Server protocol and gates optional operations from reported capabilities. A matrix entry establishes metadata compatibility for that version.

## Real Codex pilots

Run the following commands with the intended server account after authorizing use of its Codex login and model quota.

```bash
npm run test:live -- --allow-model-requests
npm run test:live:ide -- --allow-model-requests
```

The first script uses a disposable project for read/write, queue, branch, and interrupt workflows. The second exercises Plan, same-turn steering, and native review in a disposable read-only workflow. They can leave native conversation records in that account. Ordinary CI uses the simulator and metadata smoke. Use the [acceptance checklist](acceptance.md#live-pilot-checklist) for policy-dependent approvals and deployment.

## Make a change

Start with the [architecture](architecture.md) and [Spec Coding](spec-coding.md). Use the feature module that owns the state and extend the smallest test that can prove the relevant behavior. Describe user-visible changes in [Unreleased](../CHANGELOG.md#unreleased). Follow the repository's collaboration rules for review and integration.
