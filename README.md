# IPA Manager — Preview 0.2.0

A Progressive Web App (PWA) for iPhone and modern browsers that inspects iOS application packages (`.ipa`) locally, exports app bundles, rebuilds IPA containers, browses public GitHub releases, and imports catalogs compatible with the AltStore JSON format.

## Features

- **Local IPA Import:** Select `.ipa` files through the browser's native file picker.
- **ZIP Archive Inspection:** Read ZIP directory structures using STORE and Deflate compression without uploading the package to a server.
- **Property List Parsing:** Read `Payload/*.app/Info.plist` in XML and binary plist formats.
- **Application Metadata:** Display bundle identifier, app version, build number, application name, minimum iOS version, and archive structure.
- **App Bundle Export:** Extract all entries belonging to `Payload/<App>.app` into a ZIP archive whose root preserves the `<App>.app/` folder hierarchy. On iPhone, use Files to save and decompress the ZIP.
- **IPA Rebuild:** Repackage the complete set of archive entries into a new ZIP-based `.ipa`, checking each entry's CRC-32 and retaining available timestamps and Unix external attributes, including executable and symlink mode bits. The writer uses ZIP STORE compression.
- **Native File Sharing:** Share the original IPA, rebuilt IPA, exported app bundle, or individual files through the Web Share API when the browser and iOS expose file sharing. Otherwise, the app falls back to a browser download.
- **Individual File Extraction:** Extract individual archive entries and share them through the native sharing interface when supported.
- **Integrity Checks:** Validate CRC-32 when entries are read and calculate SHA-256 hashes for the original IPA.
- **Signature Indicators:** Detect `CodeResources` and `embedded.mobileprovision`. These indicators are not cryptographic signature validation.
- **GitHub Release Browser:** Browse public GitHub releases and find `.ipa` and `.zip` assets.
- **AltStore Sources:** Import public AltStore-compatible JSON catalogs over HTTPS.
- **Local Library and History:** Store application metadata and inspection history in `localStorage`.
- **Offline Shell:** Cache the application interface with a service worker after the first visit.

## Security and Platform Limitations

IPA Manager is a browser-based PWA. It cannot sign applications, install arbitrary IPA packages, bypass iOS trust mechanisms, or create arbitrary folders directly in the iOS Files storage. The app does not request Apple ID credentials, passwords, device UDIDs, private signing certificates, or personal provisioning profiles.

### App Bundle Export

The **Extract App (.app)** action creates a ZIP archive containing the app bundle under a top-level folder such as `Nuvio.app/`. This is the portable way for a PWA to deliver a folder hierarchy to iOS. Open the generated ZIP in Files and decompress it to view the folder. The resulting `.app` folder is not directly installable through Files.

### IPA Rebuild

The **Rebuild IPA** action reconstructs a ZIP container from the original archive entries. It verifies CRC-32 for every entry and preserves available Unix external attributes, which can contain executable and symbolic-link metadata. File contents are not intentionally modified. The archive is written using STORE compression, so the rebuilt file can be larger than the source.

Rebuilding the ZIP container does **not** sign or re-sign the application, repair a broken signature, create a provisioning profile, check certificate revocation, or guarantee that iOS will install the package. A structurally valid ZIP-based IPA is not necessarily an installable or trusted app.

### Installer Integration

The app uses the iOS native share sheet through the Web Share API. A compatible installer may appear there if it is already installed and registered to receive the selected file type. Safari does not expose a public API that allows a PWA to enumerate installed installers or force-launch a particular one. IPA Manager therefore does not use undocumented URL schemes or claim that a specific installer is available.

### Signature Detection

The inspection screen identifies files commonly associated with iOS code signing. It does not perform complete CMS signature verification, CodeDirectory validation, certificate revocation checks, notarization checks, or online Apple trust validation. The presence of signature-related files is not proof that an IPA is valid, trusted, or installable.

## Deployment

Host the complete project directory on a static hosting provider with HTTPS, such as GitHub Pages or Cloudflare Pages. Do not remove `manifest.webmanifest`, `sw.js`, or the application icons. No backend is required for local archive inspection or rebuilding.

### Deploying with GitHub Pages

1. Create a public GitHub repository.
2. Upload all files from this directory to the repository root.
3. Open **Settings → Pages**.
4. Select **Deploy from a branch**, choose `main`, and select `/ (root)`.
5. Open the generated HTTPS URL in Safari on your iPhone.
6. In Safari, choose **Share → Add to Home Screen**, enable **Open as Web App**, and tap **Add**.

## iPhone Compatibility and Testing

- The browser file picker can select `.ipa` files through the iOS Files app.
- ZIP decompression uses `DecompressionStream('deflate-raw')`, supported by Safari on iOS 16.4 and later.
- File sharing depends on browser support for `navigator.share()` and `navigator.canShare({ files })`. When unavailable, file downloads are used as a fallback.
- Large archives may consume substantial memory. The recommended initial input size is up to 500 MB.
- App bundle export and IPA rebuilding are limited to 400 MB of total uncompressed content and retain the per-entry extraction ceiling described below.
- External repository and catalog requests depend on network availability and the remote service's CORS policy.

Serve the app through HTTPS or localhost to enable the required browser APIs and PWA functionality.

## Project Structure

| File | Description |
|---|---|
| `index.html` | Application layout and interface screens. |
| `styles.css` | Responsive styling and visual presentation. |
| `app.js` | ZIP parsing and writing, plist decoding, CRC-32, SHA-256, GitHub integration, source importing, and local library management. |
| `sw.js` | Service worker responsible for caching the application shell. |
| `manifest.webmanifest` | PWA manifest and application configuration. |
| `icon.svg`, `icon-180.png`, `icon-192.png`, `icon-512.png` | Application icons. |

## Known Limitations — Preview 0.2.0

- ZIP64 archives, multi-volume ZIP archives, and encrypted ZIP entries are not supported.
- The application blocks inspection of IPA packages larger than 700 MB.
- Individual entry extraction is limited to 250 MB.
- App bundle export and IPA rebuilding are limited to 400 MB of total uncompressed data to reduce memory exhaustion risks on mobile devices.
- The archive writer creates ZIP32 files using STORE compression; rebuilt IPAs may be significantly larger than their source packages.
- The archive writer preserves available timestamps and external attributes but does not preserve arbitrary ZIP extra fields, archive comments, or original compression methods.
- Duplicate paths and unsafe paths (absolute paths, parent-directory traversal, and backslash paths) are rejected during export.
- SHA-256 calculation is limited to files up to 300 MB.
- The interface displays up to 700 archive entries at a time; search can refine the full entry collection.
- Local history stores metadata, not the original IPA packages. The service worker caches only interface resources, not downloaded IPA files.
- The app is not a replacement for forensic analysis tools or Apple's official validation and distribution mechanisms.

## Version

**IPA Manager — Preview 0.2.0**

This is an early preview release. Features, browser compatibility, and performance may change in future versions.


<!-- TESTE GIT -->
