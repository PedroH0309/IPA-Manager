# IPA Manager

**A local-first Progressive Web App for inspecting, exporting, rebuilding, and handing off iOS IPA packages.**

IPA Manager helps iPhone and desktop users understand what is inside an **.ipa** file before passing the original package to a compatible iOS installer. Archive inspection, metadata parsing, integrity checks, and ZIP export run in the browser; the selected IPA is not uploaded by the inspection workflow.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![PWA](https://img.shields.io/badge/Progressive%20Web%20App-PWA-6f42c1)
![Status](https://img.shields.io/badge/status-preview%200.3.0-orange)
![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20modern%20browsers-lightgrey)

## Preview

![IPA Manager interface preview](assets/preview.svg)

*Illustrative interface preview of the current dark UI. The repository's live interface is the source of truth for current behavior.*

## Why IPA Manager?

An IPA is a ZIP-based application package, but opening or extracting it does not prove that iOS will accept it. Users often need to inspect application metadata, confirm the archive layout, export a bundle for analysis, or hand the original package to a separate signing and installation tool.

IPA Manager brings those local inspection and packaging tasks together in a browser-based interface. It does **not** bypass Apple's signing, provisioning, notarization, or installation requirements.

## Features

- **Local IPA import:** Select an .ipa file from the browser's native file picker.
- **ZIP inspection:** Read STORE and Deflate archive entries without uploading the selected package.
- **Property lists:** Parse Payload/*.app/Info.plist in XML and binary plist formats.
- **Application metadata:** Display the bundle identifier, version, build number, app name, minimum iOS version, and archive structure.
- **App bundle export:** Export the complete Payload/<App>.app/ hierarchy as a ZIP that can be decompressed in the iOS Files app.
- **IPA rebuild:** Rebuild a ZIP-based IPA container from the original entries, with CRC-32 checks and preservation of available timestamps and Unix external attributes.
- **File sharing:** Share the original IPA, rebuilt IPA, exported bundle, or individual entries through the Web Share API when supported.
- **Integrity checks:** Verify an entry's CRC-32 when it is read and calculate a SHA-256 hash for supported file sizes.
- **Signature indicators:** Detect common signature-related files such as CodeResources and embedded.mobileprovision.
- **GitHub releases:** Browse public repository releases and their IPA/ZIP assets.
- **AltStore-compatible sources:** Import public JSON catalogs over HTTPS.
- **SideStore hand-off:** Open direct HTTPS IPA links from GitHub releases and imported catalogs through SideStore's documented URL scheme.
- **Assisted installation:** Share a locally selected original IPA, or hand an already-hosted OTA manifest to iOS.
- **Local history:** Store inspection metadata and activity in browser localStorage.
- **Offline app shell:** Cache the interface with a service worker after the first successful visit.

## Technology stack

| Area | Technology |
|---|---|
| Interface | HTML5, CSS3, vanilla JavaScript |
| Application model | Progressive Web App (PWA) |
| Archive reading | ZIP central-directory parsing, STORE, Deflate |
| Archive writing | Browser Blob and ZIP32 writer |
| Metadata | XML plist parsing, binary plist decoder |
| Integrity | CRC-32 and Web Crypto API (crypto.subtle) |
| File handling | File, Blob, URL and Web Share APIs |
| Offline support | Service Worker and Web App Manifest |
| Release/catalog data | GitHub REST API and AltStore-compatible JSON over HTTPS |
| Hosting | Any static HTTPS host (GitHub Pages, Cloudflare Pages, etc.) |

No package manager, build step, backend, or paid API key is required for the current static version.

## Requirements

- A modern browser with File, Blob, DOMParser, DecompressionStream('deflate-raw'), and crypto.subtle.
- HTTPS for PWA installation, service workers, Web Crypto, and secure browser APIs. localhost is also suitable for local development.
- On iPhone, a recent version of Safari and access to the iOS Files app for selecting and saving packages.

Safari support for DecompressionStream('deflate-raw') is available on iOS 16.4 and later. Actual memory limits depend on the device and the size and structure of the archive.

## Run locally

There is no build system or dependency installation step.

1. Clone the repository:

   ~~~bash
   git clone https://github.com/PedroH0309/IPA-Manager.git
   cd IPA-Manager
   ~~~

2. Start a local static server with Python:

   ~~~bash
   python -m http.server 8000
   ~~~

3. Open http://localhost:8000 in a modern browser.

Alternatively, serve the directory with any static HTTP server. Do not open the HTML file directly with file:// when testing PWA or service-worker behavior.

## Deploy with GitHub Pages

1. Push the project files to the main branch.
2. Open **Settings → Pages** in the repository.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Choose main and /(root), then save.
5. Open the HTTPS URL generated by GitHub Pages.
6. On iPhone, open the site in Safari, tap **Share → Add to Home Screen**, enable **Open as Web App**, and tap **Add**.

Keep manifest.webmanifest, sw.js, and the application icons in the deployed directory.

## How to use

### Inspect an IPA

1. Open **Inspecionar IPA**.
2. Select the original .ipa file using the file picker.
3. Review the application metadata, archive entries, and signature indicators.
4. Calculate the SHA-256 hash when needed and compare it with a trusted reference published by the developer.

### Export the app bundle

1. Import the IPA and wait for inspection to finish.
2. Select **Extrair aplicativo (.app)**.
3. Save or share the generated ZIP.
4. In the iOS Files app, decompress the ZIP to view the <App>.app/ folder.

The .app directory is an extracted bundle, **not an installable file in the Files app**.

### Rebuild an IPA

1. Import the original IPA.
2. Select **Reconstruir IPA**.
3. Save or share the generated .ipa file.

Rebuilding recreates the archive container. It does not sign, re-sign, repair, or provision the app. Keep the original IPA available; use the rebuilt package only when you specifically need a reconstructed archive.

### Hand off an IPA to an installer

- **Local IPA:** use **Enviar IPA ao instalador** to open the iOS share sheet. If the installer is not listed, save the original file in Files and import it from inside the installer.
- **Remote IPA:** for supported GitHub release assets or AltStore-source download URLs, use **Instalar via SideStore**. This opens SideStore's documented sidestore://install?url=... URL scheme. SideStore must already be installed and configured.
- **OTA manifest:** the manifest field can open an itms-services:// request for a public HTTPS manifest.plist. The manifest and referenced IPA must already be hosted and signed/provisioned for a distribution method accepted by iOS. This is not a personal free-signing service.

Useful installer documentation:
- [SideStore URL schema](https://docs.sidestore.io/docs/advanced/url-schema)
- [SideStore prerequisites](https://docs.sidestore.io/docs/installation/prerequisites)
- [SideStore installation](https://docs.sidestore.io/docs/installation/install)
- [AltStore Classic / AltServer](https://faq.altstore.io/altstore-classic/altserver)
- [Apple: app distribution in Brazil](https://developer.apple.com/support/app-distribution-in-brazil/)

## Important platform and security boundaries

IPA Manager is a website/PWA, not an iOS signing service. Public browser APIs do not allow it to install arbitrary IPA files, bypass iOS trust checks, create a signing certificate, or make an unsigned app installable.

- The app does not ask for an Apple Account password, device UDID, private signing certificate, or personal provisioning profile.
- The selected IPA is processed locally during inspection and export. Network activity is initiated for release/catalog lookups, remote downloads, or user-requested hand-offs.
- An imported AltStore-compatible JSON catalog is only a list of metadata and download URLs. It is not automatically an Apple-authorized marketplace.
- SideStore and AltStore Classic are separate installer applications. They are responsible for their own signing and installation workflow and remain subject to Apple's account, provisioning, entitlement, and platform limits.
- In Brazil, alternative marketplaces and web distribution require Apple's authorization and notarized apps. A PWA cannot become an authorized marketplace merely by importing a JSON source.
- The presence of CodeResources or embedded.mobileprovision is only an indicator. It is not cryptographic proof that the IPA is signed correctly or can be installed.

## Known limitations (Preview 0.3.0)

- ZIP64, multi-volume ZIP archives, and encrypted ZIP entries are not supported.
- IPA inspection is blocked for packages larger than 700 MB.
- Individual entry extraction is limited to 250 MB.
- App bundle export and IPA rebuilding are limited to 400 MB of total uncompressed data to reduce memory pressure on mobile devices.
- The archive writer creates ZIP32 files using STORE compression; rebuilt IPAs may be larger than their originals.
- The writer preserves available timestamps and Unix external attributes, but does not preserve arbitrary ZIP extra fields, archive comments, or the source compression method.
- Duplicate paths and unsafe paths (absolute paths, parent-directory traversal, and backslash paths) are rejected during export.
- SHA-256 calculation is limited to files up to 300 MB.
- The interface displays up to 700 archive entries at a time; search can refine the complete entry collection.
- Local history stores metadata, not IPA binaries. The service worker caches interface resources only.
- Signature detection is not a substitute for CMS/CodeDirectory verification, certificate revocation checks, notarization checks, or Apple's online validation.

## Project structure

~~~text
.
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   └── feature_request.yml
│   ├── workflows/
│   │   └── validate.yml
│   └── PULL_REQUEST_TEMPLATE.md
├── assets/
│   └── preview.svg
├── app.js
├── index.html
├── styles.css
├── sw.js
├── manifest.webmanifest
├── icon.svg
├── icon-180.png
├── icon-192.png
├── icon-512.png
├── LICENSE
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── SECURITY.md
└── README.md
~~~

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

For bugs, include browser and OS versions, reproduction steps, the expected result, and the actual result. Do not attach private IPA files, Apple credentials, provisioning profiles, or other sensitive material to public issues.

## Security

Please do not report security vulnerabilities in public issues. Read [SECURITY.md](SECURITY.md) for the responsible disclosure process.

## License

This project is released under the [MIT License](LICENSE).
