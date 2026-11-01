# OTA Lab — iPhone installation research

**Status: experimental. No bypass and no confirmed real-device installation.**

This experiment prepares an OTA installation request using a hosted XML manifest. The iOS device makes the installation and trust decision. The website does not sign an IPA or confirm the result.

## What was built

- **ota-engine.js**: creates a basic OTA XML manifest and builds an iOS itms-services installation URL.
- **ota-lab.html**: responsive user-facing experiment, opened directly in Safari.
- **ota-lab.js**: checks browser environment, generates and exports a manifest, optionally fetches a hosted public manifest with CORS, requests iOS installation after explicit authorization acknowledgement, and exports a minimal JSON report.
- **ota-lab.css**: mobile styling consistent with the IPA Manager.
- All IPA preparation is local. There is no IPA upload, signing server, credential collection, or certificate verification.

## Distribution prerequisites and limits

Apple documents over-the-air distribution of **proprietary in-house applications**. This method requires a correctly signed and provisioned IPA, a plist manifest, HTTPS delivery, and a certificate that the intended device trusts. Enterprise/in-house distribution is **not** a legitimate public app marketplace.

Other methods, including Ad Hoc, TestFlight, App Store, and authorized marketplaces, have separate permission and eligibility requirements. A syntactically valid OTA manifest does **not** make an arbitrary IPA installable.

On iOS 18 or newer, Apple explains that a manually installed proprietary in-house app (not installed with MDM) may need a device restart to complete trust of its provisioning profile.

## Real iPhone test procedure

1. In iPhone Safari, open https://pedroh0309.github.io/IPA-Manager/ota-lab.html . Do not run this experiment inside the PWA installed to the home screen.
2. Review environment diagnostics. Browser, iOS, and HTTPS can be checked locally; Apple signature trust cannot.
3. Obtain a legitimately OTA-distributable IPA **already signed and approved for its intended audience**, hosted at a public HTTPS URL. IPA Manager does not supply or sign this archive.
4. Enter the IPA URL, its actual Bundle ID, version, and name. Generate and save the XML manifest.
5. Host the resulting manifest on a public HTTPS endpoint, separate from the IPA. The IPA referenced within must also be accessible. Do not use an HTML download page, authentication wall, or broken redirects.
6. Paste the hosted manifest URL into the OTA lab and optionally run its browser reachability test. A CORS failure is **inconclusive**: browser fetch and iOS installation use different networking paths.
7. Confirm you have authority to distribute the app, then tap **Solicitar instalação ao iOS**. The browser passes an itms-services download-manifest URL to the OS.
8. Inspect the iPhone screen and its Apps. Return to Safari, select what actually happened, and record the system error text if applicable.
9. Export or copy the local diagnostic JSON. It deliberately omits IPA URL, manifest URL, tokens, Apple ID, UDID and certificates.

**No on-device success claim is possible without performing step 7 on a real iPhone with an eligible test IPA.**

## Failure investigation matrix

| Symptom | Possible cause | Check |
|---|---|---|
| Nothing happens | iOS refuses or does not handle the URL scheme in this context | Open directly in Safari, use a direct tap and check the manifest link |
| Download error | Manifest / IPA unavailable, TLS, redirects, MIME problems | Check public HTTPS and actual response |
| Verification / installation failure | Signature, profile, expired or revoked certificate, wrong eligible audience | Ask the legitimate distributor to verify IPA, profile and device eligibility |
| App present but won't open | Provisioning trust, OS compatibility, expiration or execution restriction | Review exact iOS message and distribution requirements |
| Browser cannot fetch .plist | CORS policy or a network failure | Mark as inconclusive; not proof the installer cannot fetch |
| Manifest generated and accessible | Basic structure and reachability only | **Not** proof of iOS installation permission |

## Manual validation checklist

- QA-01: HTTPS Safari page opens on a real iPhone.
- QA-02: A known example produces a well-formed XML manifest; the file saves.
- QA-03: HTTP and localhost URLs, invalid Bundle IDs and invalid extensions are rejected.
- QA-04: An accessible test manifest can be parsed, with CORS limitations explicitly described.
- QA-05: A user-triggered install intent opens the native iOS flow for an authorized signed app, if supported.
- QA-06: The observed outcome is recorded, and report export contains no URLs or credentials.

**QA-01, QA-04, QA-05 and QA-06 require a real-device test. Automated CI must not mark those as passed.**

## Safety and privacy

No private credentials, Apple ID, signing keys, UDIDs, certificates or private IPA URLs are needed. The browser only fetches a URL when you explicitly request it. User-entered IPA and manifest URLs are not saved to app history or exported diagnostic reports. The XML manifest necessarily contains the IPA URL, so use only a URL you are allowed to distribute.

## Official references

- Apple, in-house app distribution: https://support.apple.com/guide/deployment/depce7cefc4d/web
- Apple, marketplace eligibility in Brazil: https://developer.apple.com/support/alternative-app-marketplace-br/
- Apple, regional alternative distribution: https://developer.apple.com/documentation/marketplacekit/participating-in-alternative-distribution-for-specific-regions
