# Contributing

Thank you for considering a contribution to IPA Manager.

## Before you start

- Search existing issues and pull requests to avoid duplicate work.
- For significant changes, open an issue first to discuss the scope.
- Keep changes focused and avoid unrelated refactors.
- Never include Apple Account credentials, private certificates, provisioning profiles, personal device identifiers, or private IPA files.

## Development setup

The current project is a static Progressive Web App. No npm dependencies or build step are required.

~~~bash
git clone https://github.com/PedroH0309/IPA-Manager.git
cd IPA-Manager
python -m http.server 8000
~~~

Open http://localhost:8000 in a modern browser. Use HTTPS or localhost when testing service workers and secure browser APIs.

## Code guidelines

- Use descriptive names and consistent indentation.
- Keep the current static application dependency-free unless a new dependency is justified.
- Validate untrusted filenames, URLs, archive paths, and external metadata.
- Preserve local-first behavior. Do not upload a selected IPA without an explicit, documented user action.
- Do not claim an IPA is installable based only on ZIP structure or signature-related files.
- Keep all Apple marketplace features disabled until authorization and native integration exist.
- Update the README and known limitations when behavior changes.

## Validation checklist

1. Run node --check app.js.
2. Run node --check zip-engine.js and node --test tests/*.test.cjs.
3. Confirm manifest.webmanifest is valid JSON.
4. Test affected features in a modern browser.
5. When changing file handling, test a small sample archive and malformed inputs.
6. When changing iOS behavior, test on a real iPhone where possible and document platform limitations.
7. Verify service-worker cache names are updated when cached files change.

## Pull requests

Use the pull request template. Include a concise summary, motivation, test results, and screenshots or a short recording for visual changes. Explain known limitations.
