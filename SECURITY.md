# Security Policy

## Supported versions

Security fixes are prioritized for the latest preview version on the main branch. Older preview builds may not receive security updates.

## Reporting a vulnerability

Please do not disclose security vulnerabilities in public GitHub issues or discussions.

Use GitHub's **Private vulnerability reporting** feature on this repository when it is enabled. If that feature is unavailable, contact the repository owner through the contact information on the GitHub profile and request a private disclosure channel.

Include:

- A clear description of the issue and its potential impact.
- The affected file, feature, browser, and version.
- Reproduction steps or a proof of concept that does not expose real user data.
- Any suggested mitigation.

Do not send Apple Account passwords, private signing keys, provisioning profiles, UDIDs, or private IPA files.

## Security design notes

IPA Manager processes selected archives locally in the browser. Treat IPA files, plist values, catalog metadata, repository release text, and URLs as untrusted input. The project does not provide code signing, notarization, or Apple trust validation.
