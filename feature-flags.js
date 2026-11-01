(function configureIPAManagerFeatures(root) {
  'use strict';

  // Deliberately false until the native MarketplaceKit app, Apple entitlement,
  // and production license-delivery service have been implemented and approved.
  // Changing these frontend values does not grant iOS installation privileges.
  root.IPAManagerFeatureFlags = Object.freeze({
    appleMarketplaceEntitlement: false,
    nativeMarketplaceApp: false,
    appLicenseDelivery: false,
    managedInstallation: false,
    installedAppLibrary: false,
    automaticUpdates: false
  });
})(typeof window !== 'undefined' ? window : globalThis);
