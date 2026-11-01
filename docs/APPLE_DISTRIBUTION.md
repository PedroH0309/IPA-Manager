# Apple Alternative Distribution — Readiness Notes

This document records the current integration boundary. It is not a statement that IPA Manager has been approved by Apple.

## Brazil eligibility

Apple's current Brazil support page states that alternative app marketplaces are available on iOS 26.5 and later, require Apple's authorization, and distribute notarized apps. The operator must be enrolled in the Apple Developer Program as an organization and meet ongoing operational requirements.

The page lists extensive responsibilities, including transparent privacy policies, content moderation, anti-fraud monitoring, intellectual-property review and dispute handling, and government takedown handling.

The current published eligibility alternatives include either:
- A standby letter of credit of USD 1,000,000 (or local-currency equivalent) from a qualifying financial institution, maintained for at least six months after distribution starts; or
- At least two continuous years in good standing in the Apple Developer Program and an app with more than one million first annual installs worldwide during the prior calendar year.

Requirements may change. Re-check Apple's official page before submitting any application.

## Required Apple components

- Alternative App Marketplace entitlement: com.apple.developer.marketplace.app-installation.
- A dedicated native iOS marketplace application using MarketplaceKit.
- AppLibrary for marketplace app installation and management APIs.
- ActionButton for user-initiated installation/update actions.
- App License Delivery SDK running in a Swift server.
- A marketplace website and server implementing Apple's expected endpoints.
- App Store Connect relationships, authenticated/notarized packages, and developer participation.

## Current project state

All marketplace-related feature flags remain false. No native iOS target, entitlement profile, Apple distribution key, notarization integration, App Store Connect integration, or App License Delivery service is present in this repository.

The PWA must not render an install action as operational while these components are absent.

## Official documentation

- [Operating an alternative app marketplace in Brazil](https://developer.apple.com/br/support/alternative-app-marketplace-br/)
- [MarketplaceKit](https://developer.apple.com/documentation/marketplacekit)
- [Creating an alternative app marketplace](https://developer.apple.com/documentation/marketplacekit/creating-an-alternative-app-marketplace)
- [Installing apps from an alternative marketplace](https://developer.apple.com/documentation/marketplacekit/installing-apps-from-an-alternative-marketplace)
- [AppLibrary](https://developer.apple.com/documentation/marketplacekit/applibrary)
- [ActionButton](https://developer.apple.com/documentation/marketplacekit/actionbutton)
- [App License Delivery SDK](https://developer.apple.com/documentation/AppLicenseDeliverySDK)
