# Third-party acknowledgments

Thank you to the maintainers and contributors behind the projects Codes uses and learns from. The lockfile records resolved npm versions and dependency relationships. [Dependency lockfile](../package-lock.json)

## Design references

- Covro's self-hosted Codex workspace and settings informed the Codes web interface. [yuzheng14/covro](https://github.com/yuzheng14/covro)
- 1Panel's settings organization and quick-start documentation informed the settings categories and installation flow. [1Panel-dev/1Panel](https://github.com/1Panel-dev/1Panel)

## Runtime and brand

| Component | Used for                                                     | License                                                                             |
| --------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Codex CLI | Native session history and task execution through App Server | [Apache-2.0](https://github.com/openai/codex/blob/rust-v0.172.0/LICENSE)            |
| Node.js   | Service runtime included in Linux release bundles            | [MIT and third-party notices](https://github.com/nodejs/node/blob/v24.22.3/LICENSE) |
| SQLite    | Workspace metadata, queues, and receipts through Node.js     | [Public domain](https://www.sqlite.org/copyright.html)                              |
| Inter     | Typeface used to create the Codes wordmark                   | [OFL-1.1](OFL-Inter.txt)                                                            |

## Application libraries

| Component           | Used for                                        | License and upstream project                                                                                                         |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| React and React DOM | Browser interface and rendering                 | [MIT · React](https://github.com/react/react)                                                                                        |
| react-markdown      | Rendering conversation Markdown                 | [MIT · react-markdown](https://github.com/remarkjs/react-markdown)                                                                   |
| remark-gfm          | GitHub Flavored Markdown support                | [MIT · remark-gfm](https://github.com/remarkjs/remark-gfm)                                                                           |
| image-size          | Reading dimensions for image preview validation | [MIT · image-size](https://codeberg.org/image-size/image-size) · [npm release metadata](https://registry.npmjs.org/image-size/2.1.0) |
| jose                | Verifying Cloudflare Access JWTs                | [MIT · jose](https://github.com/panva/jose)                                                                                          |
| word-extractor      | Extracting text for Word previews               | [MIT · word-extractor](https://github.com/morungos/node-word-extractor)                                                              |
| yauzl               | Reading ZIP structures in DOCX files            | [MIT · yauzl](https://github.com/thejoshwolfe/yauzl)                                                                                 |
| Zod                 | Validating API requests and native responses    | [MIT · Zod](https://github.com/colinhacks/zod)                                                                                       |

## Development tools

| Component                 | Used for                                            | License and upstream project                                                                                          |
| ------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Vite and its React plugin | Building and developing the browser client          | [MIT · Vite](https://github.com/vitejs/vite) · [MIT · Vite React plugin](https://github.com/vitejs/vite-plugin-react) |
| TypeScript                | Type checking and building the server               | [Apache-2.0 · TypeScript](https://github.com/microsoft/TypeScript)                                                    |
| DefinitelyTyped           | Type declarations for Node.js, React, and React DOM | [MIT · DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped)                                           |
| tsx                       | Running TypeScript development and test scripts     | [MIT · tsx](https://github.com/privatenumber/tsx)                                                                     |
| Vitest                    | Unit and integration tests                          | [MIT · Vitest](https://github.com/vitest-dev/vitest)                                                                  |
| Playwright                | Browser acceptance tests                            | [Apache-2.0 · Playwright](https://github.com/microsoft/playwright)                                                    |
| Prettier                  | Source and documentation formatting                 | [MIT · Prettier](https://github.com/prettier/prettier)                                                                |

Linux release bundles carry the Node.js license and notices in `runtime/LICENSE`, the notices supplied by npm packages in `node_modules`, and the Inter license in `LICENSES/OFL-Inter.txt`.
