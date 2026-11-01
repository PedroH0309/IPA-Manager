# IPA Manager — Preview 0.1.0

A Progressive Web App (PWA) built for iPhone and modern browsers, designed to inspect and manage iOS application packages (`.ipa`) locally. It also supports browsing public GitHub releases and importing application catalogs compatible with the AltStore JSON format.

## Features

- **Local IPA Import:** Import `.ipa` files directly through the browser's native file picker.
- **ZIP Archive Inspection:** Read ZIP directory structures using STORE and Deflate compression methods without uploading files to any server.
- **Property List Parsing:** Read `Payload/*.app/Info.plist` files in both XML and binary plist formats.
- **Application Metadata:** Display bundle identifier, app version, build number, application name, minimum iOS version, and archive structure.
- **Individual File Extraction:** Extract individual files from an IPA package and share them through the native sharing interface when supported.
- **CRC-32 Verification:** Validate an archive entry's CRC-32 checksum when extracting it.
- **SHA-256 Hashing:** Calculate SHA-256 hashes and compare them against reference values.
- **Signature Indicators:** Detect the presence of `CodeResources` and `embedded.mobileprovision` files. These indicators do not constitute cryptographic signature validation.
- **GitHub Release Browser:** Browse public GitHub repository releases and discover available `.ipa` and `.zip` assets.
- **AltStore Sources:** Import AltStore-compatible JSON repositories over HTTPS, including application metadata, versions, and download links.
- **Local Library and History:** Store application metadata and inspection history locally using `localStorage`.
- **Offline Support:** Cache the application shell through a service worker after the initial visit.

## Security and Platform Limitations

IPA Manager is a browser-based Progressive Web App. Due to iOS platform restrictions and browser security policies, a PWA cannot independently sign applications, install arbitrary IPA packages, or bypass Apple's application trust mechanisms.

The application does not request or collect:

- Apple ID credentials or passwords.
- Device UDIDs.
- Private signing certificates.
- Personal provisioning profiles.

Installing an IPA requires a compatible distribution method, such as:

- The Apple App Store.
- An Apple-authorized alternative marketplace or web distribution channel, where available.
- A sideloading tool that has already been configured by the user and supports importing shared IPA files.

Importing an AltStore-compatible JSON source only retrieves application metadata and download links. It does not imply Apple approval, marketplace authorization, or installation compatibility.

### Code Signature Detection

The inspection interface identifies files commonly associated with iOS application signatures. However, IPA Manager does not perform complete cryptographic validation, including:

- CMS signature verification.
- CodeDirectory validation.
- Certificate revocation checks.
- Apple notarization verification.
- Online Apple trust validation.

The presence of signature-related files must never be interpreted as proof that an IPA is valid, trusted, or installable.

## Deployment

IPA Manager can be hosted as a static website using any hosting provider that supports HTTPS, including GitHub Pages and Cloudflare Pages.

All project files must remain in the deployment directory. Do not remove `manifest.webmanifest`, `sw.js`, or `icon.svg`.

### Deploying with GitHub Pages

1. Create a new, empty public GitHub repository.
2. Upload all project files to the repository root.
3. Navigate to **Settings → Pages**.
4. Under **Build and deployment**, select **Deploy from a branch**.
5. Select the `main` branch and the `/ (root)` directory.
6. Save your configuration and wait for GitHub Pages to deploy the website.
7. Open the generated HTTPS URL in Safari on your iPhone.
8. In Safari, tap **Share → Add to Home Screen**.
9. Enable **Open as Web App**, then tap **Add**.

The application will then be accessible from your iPhone's Home Screen.

## iPhone Compatibility and Testing

- The native file picker supports selecting `.ipa` files through the iOS Files app.
- ZIP decompression uses the browser's native `DecompressionStream('deflate-raw')` API, supported by Safari on iOS 16.4 and later.
- Large archives may consume significant memory. The recommended initial file size is up to 500 MB.
- Individual file exports use the browser's Blob API and may open the native sharing interface or Downloads, depending on the Safari version.
- External repository and catalog requests depend on network availability and the target service's CORS configuration.

For the best experience on iPhone, use an up-to-date version of Safari and access the application through HTTPS or localhost.

## Project Structure

| File | Description |
|---|---|
| `index.html` | Application layout and interface screens. |
| `styles.css` | Responsive styling and visual presentation. |
| `app.js` | ZIP parsing, plist decoding, CRC-32, SHA-256, GitHub integration, source importing, and local library management. |
| `sw.js` | Service worker responsible for caching the application shell. |
| `manifest.webmanifest` | PWA manifest and application configuration. |
| `icon.svg` | Vector application icon. |

## Browser Compatibility

IPA Manager requires a modern browser supporting the following web technologies:

- `DecompressionStream`
- `crypto.subtle`
- `Blob`
- `File`
- `DOMParser`

For iPhone and iPad, use an up-to-date version of Safari.

The application must be served through HTTPS or localhost to enable the required browser APIs and Progressive Web App functionality.

## Known Limitations — Preview 0.1.0

The current preview release has the following technical limitations:

- ZIP64 archives are not supported.
- Multi-volume ZIP archives are not supported.
- Encrypted ZIP entries are not supported.
- IPA inspection is blocked for packages larger than 700 MB.
- Individual file extraction is limited to entries smaller than or equal to 250 MB.
- SHA-256 calculation is limited to files smaller than or equal to 300 MB to reduce memory exhaustion risks.
- The interface displays up to 700 archive entries at a time. Search functionality can refine results across the complete entry collection.
- Local history stores application metadata, not the original IPA packages.
- The service worker caches only application interface resources, not downloaded IPA packages.
- ZIP directory structures and application metadata are inspected, but the application is not intended to replace forensic analysis tools or Apple's official application validation mechanisms.

## Version

**IPA Manager — Preview 0.1.0**

This is an early preview release. Features, compatibility, and performance may change in future versions.
