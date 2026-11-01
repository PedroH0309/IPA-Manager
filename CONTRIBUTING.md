# Contributing

Thank you for considering a contribution to IPA Manager.

## Before you start

- Search existing issues and pull requests to avoid duplicate work.
- For significant changes, open an issue first to discuss the scope.
- Keep changes focused. Prefer small pull requests that are easy to review.
- Never include Apple Account credentials, private certificates, provisioning profiles, personal device identifiers, or private IPA files.

## Development setup

The project is a static Progressive Web App built with vanilla HTML, CSS, and JavaScript. No npm dependencies or build step are required.

~~~bash
git clone https://github.com/PedroH0309/IPA-Manager.git
cd IPA-Manager
python -m http.server 8000
~~~

Open http://localhost:8000 in a modern browser. Use HTTPS or localhost when testing service workers and secure browser APIs.

## Code guidelines

- Use descriptive names and consistent indentation.
- Keep the application dependency-free unless a new dependency is justified.
- Prefer browser APIs that are available in supported browsers.
- Validate untrusted filenames, URLs, archive paths, and external metadata.
- Preserve local-first behavior: never upload a selected IPA unless a clearly explained, explicit user action is added and documented.
- Do not claim that an IPA is installable based only on ZIP structure or the presence of signature-related files.
- Keep installation hand-off code explicit about the role of SideStore, AltStore, iOS OTA distribution, signing, and provisioning.
- Update the README and known limitations when behavior changes.

## Validation checklist

Before opening a pull request:

1. Run **node --check app.js**.
2. Confirm **manifest.webmanifest** is valid JSON.
3. Test the affected feature in a modern desktop browser.
4. When changing file handling, test with a small sample archive and confirm that errors are reported safely.
5. When changing iOS behavior, test on a real iPhone where possible and document any platform-specific limitation.
6. Verify that service-worker cache names are updated when cached shell files change.

## Pull requests

Use the pull request template. Include a concise summary, motivation, test results, and screenshots or a short recording for visual changes. Explain any known limitations.
