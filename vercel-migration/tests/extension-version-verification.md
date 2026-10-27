# Extension 0.4.23 version synchronization

## Cause and change

Studio's phase3-manager-presence branch advertised ZIP 0.4.21 and accepted 0.4.22. Its descendant phase3-identity-monitor-preview installed manifest 0.4.23, while web_bridge.js deliberately rewrote 0.4.23 to 0.4.22. That rewrite is removed. Installed version, bridge status, latest-version hint and downloaded ZIP now agree on 0.4.23.

The preview retains its Manager identity/presence implementation. Production retains its own Studio UI. Neither is replaced with main or an obsolete UI. Extension 0.4.23 is the common bundle.

Build now runs scripts/package-extension.mjs. ZIP filename, enclosing directory, manifest and generated src/extensionRelease.ts all derive from extension/manifest.json. The archive contains only the eight production extension files, never test scripts. The build rejects inconsistent runtime version literals. The archive is deterministic and has valid standard ZIP CRCs. Old version archives remain historical downloads; current buttons point only to the current release.

## Verification

- Both preview and production builds passed (1,595 modules).
- Release contract tests: 3 passed. Covers unchanged 4.23 status forwarding, ZIP/source byte identity, generated release URL, reproducible packaging, CRC32 reference vector and rejection of a mismatched future manifest.
- Python zipfile independently verifies CRCs, manifest, one enclosing folder and all source file bytes.
- Existing 0.4.23 identity heartbeat and content ping tests passed.
- JavaScript syntax checks passed.
- No direct test in the user's authenticated Windows browser. Unpacked extension files require copying/reloading, followed by F5 of both tabs; merely reloading the Studio page cannot replace the old content script.

## Existing legacy test fixture limitations

The broad Node suite was run: 36 passed, 35 failed. Failures are in background-delivery.test.mjs, extension-flow.test.mjs, image-capture.test.mjs, image-transfer.test.mjs, stop-all-extension.test.mjs and transcript-bridge.test.mjs. These older VM fixtures do not provide the Chrome tabs.onUpdated/alarms APIs or MutationObserver used by the already-existing Manager extension and still hard-code older ping versions. They do not establish a real-browser failure. The dedicated release/0.4.23 identity tests above pass; this release does not claim the whole legacy suite passes.
