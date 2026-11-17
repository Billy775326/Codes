# Project conventions

- Use English as the primary language for documentation, UI text, comments, commit messages, and pull requests.
- Keep supplementary Chinese documentation in separate files, with clear links to the English version.
- Distinguish planned features from implemented and verified behavior.
- Work on focused task branches and follow the project's established tools and formatting.
- Keep credentials, local configuration, runtime data, and temporary test artifacts out of commits.
- Report the checks actually performed and any unresolved failures.
- Do not create release tags, publish releases, or deploy without explicit authorization.

## Working on this project

- Use a short-lived task branch; inspect the working tree and compare against the target branch before committing. Preserve unrelated work and shared history.
- Use Node 24.x, `npm ci`, and the checked-in lockfile. Run `npm run format:check`, `npm run check`, `npm test`, and `npm run test:e2e` for implementation changes.
- `npm run test:native` uses an empty temporary Codex home and sends no model prompts. `npm run test:live -- --allow-model-requests` uses the server login and model quota, edits a disposable fixture, and leaves native acceptance conversations; do not run it as part of normal CI.
- Keep task dispatch, native approval callbacks, durable receipts, and browser subscriptions separate. Never automatically resend a task with an uncertain outcome.
- Update `CHANGELOG.md` under Unreleased for user-facing changes. Distinguish local simulator evidence, native metadata checks, live pilot results, and deployment acceptance.
- Use English conventional commits such as `feat(workspace): add conversation recovery`.
