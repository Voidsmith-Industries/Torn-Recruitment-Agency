# Voidsmith Torn Tool Suite: UI Standard (draft)

Status: implemented first in Recruitment Agency, not yet deployed suite-wide.

## Identity
- Preserve existing product names and stable userscript namespace/update URLs.
- Public author: Voidsmith Industries.
- Footer: **Part of the Voidsmith Industries Torn Tool Suite**.
- Player identity R4G3RUNN3R [3877028] appears only for optional donations/payment destinations.
- Independent third-party Torn disclaimer in About. Keep lawful historical contributor/license attribution.

## Shared UI foundation
- Compact graphite panels, purple-accent Voidsmith shell, restrained gradients, soft layered shadows.
- Consistent buttons, tabs, form controls, modal structure, focus rings, disabled and hover states.
- Keyboard-accessible About dialog, responsive layout, reduced-motion support.
- Settings: General, Appearance, script-specific tools, Data & Privacy, About & Support. Never show inert settings.
- CSS and components bundled within each isolated userscript. No cross-script shared runtime or remote stylesheet dependency.

## Theme variants
- Default: dark graphite, violet highlights; light mode preserves contrast.
- Halloween Companion: pumpkin-orange, deep plum, aged gold, subtle effects while retaining branded shell, settings structure, About and footer.
- Theme variants must not change security, persistence, requests, API authority or workflow logic.

## Release requirements
- Per-repository regression/build/security review, exact-head independent review and protected checks.
- Device/browser testing including TornPDA and keyboard navigation before publication.
- Verify installer metadata, update path, catalogue and live readback. Do not publish unapproved Alpha/Beta builds.
