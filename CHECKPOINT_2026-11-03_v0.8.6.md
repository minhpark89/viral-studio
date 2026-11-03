# Viral Studio v0.8.6 — automatic hidden DreamFace login

## What this release fixes

v0.8.6 makes **Đăng nhập & giải CAPTCHA ẩn** work without opening the profile window: the app fills the saved email/password, solves the DreamFace reCAPTCHA inside the profile's own browser, and waits for DreamFace to confirm the session.

The original blocker was not 2Captcha. Playwright's headless browser exposed `HeadlessChrome/...` and `navigator.webdriver=true` (also inside reCAPTCHA's cross-site iframes), so Google kept returning new image rounds and DreamFace always answered `THS12140000001` ("Failed to pass Google Captcha"). 2Captcha tokens solved outside the profile are rejected by DreamFace, so the fix keeps the solve in-page:

- Every profile launch passes `--disable-blink-features=AutomationControlled`.
- Headless sessions normalize the user agent at context level (CDP `Network.setUserAgentOverride`, extra HTTP header and a `Navigator.prototype` override) so reCAPTCHA iframes see a normal Chrome UA.
- reCAPTCHA grids are solved with the 2Captcha **GridTask** API (`imgType: "recaptcha"`, dynamic rounds use `previousId`); clicks are applied inside the profile page.
- All Playwright `evaluate`/screenshot calls in the solver are bounded (8 s). A wedged iframe now returns a reason instead of hanging for minutes.
- 2Captcha HTTP calls retry transient network drops up to 3 times, so a long paid solve is not lost mid-round.
- Only a login response after the app's own verify click can finish a solve. `THS12140000001` is reported as `rejected` and stops further paid attempts immediately.

## Account creation and UI

- **Thêm tài khoản** again creates N DreamFace profiles from a count, numbered from the prefix; each slot gets generated email/password saved in the secret store.
- Hidden login fills and submits those credentials automatically, including when the CAPTCHA widget appears late.
- CAPTCHA progress (submit / processing / grid round) is shown on the account row.
- A profile confirmed `ready` has stale `gmailStatus` values normalized on startup, so the list no longer shows a verification error next to a working profile.

## Verification performed

- **336/337** automated tests passed. The only failure is the known environmental `tests/dreamface-references.test.js` case that expects `C:/Program Files/Google/Chrome/Application/chrome.exe`; run the suite with `--test-force-exit`.
- New coverage: hidden credential fill, late CAPTCHA widget, token callback without a second "Log in" click, `THS12140000001` stop, no-key message, generated credentials, 2Captcha network retry.
- Live headless login on profile 16: `status:"ready"` in ~18 s with **$0** 2Captcha spend after the UA/webdriver fix. A fresh hidden reopen returned `ready` with `renderReady:true`.
- Installed app after upgrade: 17 accounts, 16 ready, 0 verification errors; `/api/health` returned 200.
- Installer `release/Viral.Studio.Setup.0.8.6.exe` (173,452,024 bytes, SHA-256 `a3a5132a88056b12369b4affa591888ca6767a75b091a57379d15155e3ee7211`) was installed over the existing app and the packaged asar was checked for this version and the fix markers.
- User data backup before install: `E:\OPENCLAW\VIRAL STUDIO\backups\before-install-0.8.6-20261103-153049` (`studio.json`, `private/`, `studio.sha256`).
- Total paid 2Captcha spend during diagnosis/verification: about **$0.02**.

## Known pitfalls for the next session

- Launching `Viral Studio.exe` from Qoder's Git Bash fails silently because the shell exports `ELECTRON_RUN_AS_NODE=1`. Clear `ELECTRON_RUN_AS_NODE` and `ELECTRON_NO_ATTACH_CONSOLE` first, or launch from Explorer.
- Build installers with `NODE_OPTIONS=--experimental-require-module` and `node node_modules/electron-builder/out/cli/cli.js ...`; plain `npm run pack:installer` hits `ERR_REQUIRE_ESM` in `@noble/hashes`.
- Do not re-run live CAPTCHA solves against a `rejected` profile without changing proxy/IP or solving manually: DreamFace rejects the next token too and it costs money.
- The full test suite needs `--test-force-exit`; one Chrome-path test fails on this PC because that exact install path is absent.

## Rollback

Reinstall the previous installer from `release/Viral.Studio.Setup.0.8.5.exe` (or the last published release). Restore `studio.json` and `private/` from the backup path above only if workspace data itself was damaged.

## Release

Git tag `v0.8.6` on `fix/dreamface-mc-readiness`; assets: Installer, Portable, blockmap, `SHA256SUMS.txt`, release notes and this checkpoint. `release/`, `.verification/`, `.studio/` and user data stay out of git.
