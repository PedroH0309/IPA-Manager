# IPA Manager Architecture

## Current state

The deployed product remains a static, dependency-free PWA. The existing HTML/CSS/JavaScript interface, catalog, GitHub release browser, local history, plist decoder, archive explorer, export, and rebuild workflows are preserved.

The current repository is not yet a React/Vite application, does not contain a backend, and does not contain an iOS Xcode target. Those layers are introduced only when a specific requirement justifies them; the existing PWA must continue working during the transition.

## Current module boundaries

- index.html: application shell and views.
- styles.css: responsive visual system.
- app.js: UI state, application workflows, plist decoding, catalog and release browsing, local library.
- zip-engine.js: ZIP central-directory parsing, bounded entry reading, path validation, and CRC-32.
- provisioning-engine.js: bounded extraction of XML plist payloads from embedded provisioning profiles and privacy-preserving metadata diagnostics.
- download-engine.js: HTTPS-only public archive downloads, streamed size enforcement, cancellation, progress callbacks, and ZIP signature checks.
- feature-flags.js: default-off distribution capability flags.
- sw.js: PWA shell cache.

The ZIP and download engines are isolated from DOM/UI code so they can be tested with Node.js and later moved into Web Workers without changing their public contracts. Remote in-app downloads require CORS and use a capped browser Blob; direct browser links remain the fallback.

## Target architecture

### Web application

React + TypeScript + Vite + Tailwind CSS are the intended web stack once the application grows beyond the current single-file UI controller. Keep the PWA installable and preserve local-first IPA processing. Use IndexedDB for structured metadata and file handles where browser support permits; use Web Workers for CPU- and memory-intensive work.

### Native iOS application

The marketplace client will be a separate Swift/SwiftUI application with WebKit only where embedding web functionality is appropriate. MarketplaceKit, AppLibrary, and ActionButton must be invoked from native code and must follow Apple's entitlement and user-consent requirements.

A secure JavaScript bridge must expose a narrow allowlist of operations. Never expose signing keys, App Store Connect credentials, license secrets, or arbitrary native method invocation to web content.

### Backend

The intended backend is Node.js/NestJS for application APIs, PostgreSQL for users/catalog/version metadata, Redis for transient jobs and rate limits, and S3-compatible object storage behind a CDN. The Swift App License Delivery SDK is a separate Swift server component for Apple's license endpoints.

No backend endpoint should accept arbitrary user-controlled URLs and fetch them without strict SSRF controls. Remote package ingestion should use allowlisted domains, DNS/IP validation, redirect revalidation, size limits, MIME/signature checks, and isolated workers.

## Distribution feature flags

All managed distribution flags are off in feature-flags.js. They must remain off until all required Apple capabilities, native code, and production services have been implemented and verified.

- appleMarketplaceEntitlement
- nativeMarketplaceApp
- appLicenseDelivery
- managedInstallation
- installedAppLibrary
- automaticUpdates

These flags are not security controls. The server and signed native application must independently enforce authorization and entitlement availability. Editing a frontend JavaScript file cannot grant Apple permissions.

## Build strategy

The current PWA can be developed and deployed from Windows, Linux, or macOS with a static HTTP server. Native iOS compilation, signing, provisioning, and MarketplaceKit testing require macOS with a supported Xcode version and an Apple Developer account. A macOS CI runner can be added after a native Xcode project exists.

## Future API boundaries

No API endpoints are implemented yet. Planned contracts should keep these responsibilities separate:

- Catalog API: app listings, developer relationships, versions, release state.
- Artifact API: authenticated package metadata and signed download URLs.
- License service: App License Delivery SDK endpoints implemented in Swift.
- Native bridge: read-only installation state and user-initiated marketplace actions.
- Audit events: privacy-conscious records of download, install, update, restore, and moderation actions.
