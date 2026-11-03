# Viral Studio v0.8.6

Hidden DreamFace login now completes automatically: credentials are filled, the CAPTCHA is solved inside the profile's own browser, and the account becomes ready without opening a window.

- **Hidden login works headlessly.** Playwright previously exposed a `HeadlessChrome` user agent and `navigator.webdriver=true`, including inside reCAPTCHA's cross-site iframes. Google responded with endless image rounds, so DreamFace rejected every token with `THS12140000001`. v0.8.6 disables the automation-controlled fingerprint, normalizes the user agent at browser-context level, and keeps the CAPTCHA solve inside the profile browser.
- **2Captcha GridTask solving.** reCAPTCHA image grids are sent to 2Captcha as `GridTask` and clicked in-page; dynamic rounds are re-solved with `previousId`. Tokens minted outside the profile are rejected by DreamFace, so the app never substitutes an external token.
- **No more solver hangs.** All page reads/screenshots in the solver are bounded to 8 seconds, with a deadline for grid rounds, so a wedged iframe returns an error instead of blocking a profile.
- **Fewer lost paid solves.** Transient 2Captcha connection failures retry up to three times before aborting. A DreamFace `THS12140000001` rejection is detected after the app's own verify click and stops further paid attempts for that profile.
- **Account creation restored.** Adding DreamFace accounts by count again creates numbered slots and generates/saves an email and password for each. The hidden login fills them automatically, including when the CAPTCHA widget appears late.
- **Clearer account state.** CAPTCHA progress is shown per account, and profiles confirmed ready no longer keep a stale verification badge from an earlier hidden run.

Verification for this build: 336/337 automated tests passed (one known environmental Chrome-path test failure); a live hidden login reached `ready` in about 18 seconds at $0 2Captcha cost after the fingerprint fix; a fresh hidden reopen returned `ready` with the editor loaded; the installed app reported 17 accounts, 16 ready and no verification errors.

Download the Installer for a normal upgrade. Back up data and close the app/profiles before upgrading. See the attached checkpoint and SHA-256 checksums.
