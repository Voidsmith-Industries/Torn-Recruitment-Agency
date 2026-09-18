# Torn Recruitment Agency

R4G3RUNN3R's Recruitment Agency **v4.8.3** is a streamlined Torn recruitment workspace built around a simple default flow: Search → Results → Last Online → Message. Search now actively acquires candidates from configured Torn recruitment forum feeds and Torn's official v2 user search instead of merely filtering browser-local rows. Company and Faction recruitment remain isolated workflows over one shared Player Intelligence identity, while the deeper pipeline, Scout, Smart Match, campaign, analytics, and operational workspaces remain optional features that users can enable from Settings.

The Scout, Results, Global Intelligence, Smart Match, Forum Discovery, Company Recruitment, and Faction Recruitment modules are clean-room implementations. They do not call, authenticate against, or depend on `rs.dnonetwork.com` or another proprietary Recruit Scout grading backend.

## v4.8.3 Voidsmith website distribution

**v4.8.3** is a distribution-only patch. Recruitment behavior is unchanged from v4.8.2. The public bundled userscript now installs and checks for future updates through https://voidsmithindustries.com/torn/install/recruitment-agency.user.js rather than a GitHub raw URL. GitHub remains the public source/contribution repository, not the userscript distribution authority.

## v4.8.2 sortable results and recruitment filters

**v4.8.2** keeps the simplified v4.8 Search & Results workflow while making the candidate list substantially faster to work.

- Player, END, MAN, INT and Last Online headers are clickable and toggle their approved sort direction. Missing or unknown values remain at the bottom in either direction.
- Search adds exact Online / Idle / Offline filtering plus partial, case-insensitive Current Company or Current Faction matching.
- Company and Faction presence can be filtered as Any, None or Has. Missing membership facts remain Unknown rather than being falsely treated as None.
- Results now show Current Company or Current Faction. Known IDs without names render as Company #ID or Faction #ID.
- Sorting is local-only and never performs a Torn API or forum request. Search remains the explicit acquisition action.
- Last Online continues to prefer an exact activity timestamp, falling back to Torn's Online / Idle / Offline state when no timestamp is available.
- Repeated navigation to the already-active workspace is idempotent; on mobile it only closes the open sidebar, removing the userscript-world replacement race without adding timing sleeps.
- Company/Faction workflow isolation, the shared Player Intelligence fact boundary, fresh membership verification and manual final Send remain unchanged.

## v4.8.1 active forum and API Search hotfix

**v4.8.1** restores Search as an acquisition action rather than a local-list filter.

- Company Search synchronizes the configured Company Forum and Train Buyer feeds; Faction Search synchronizes the configured Faction Forum feed.
- Name searches call Torn v2 `user/search`; numeric player IDs resolve through the exact Torn v2 player profile endpoint. An empty search uses Torn's recent-last-action search filter to seed active public users.
- Torn user-search observations are stored only in the selected recruitment domain while public identity facts are merged into shared Player Intelligence. Company and Faction workflow state remains isolated.
- Explicit MAN, INT and END values written in forum posts are parsed again, including comma-separated values and `k` / `m` / `b` suffixes. Existing known values are never overwritten by forum parsing, and missing values remain unknown.
- Torn's public user-search response does not expose another player's work stats, so API-only results never fabricate MAN, INT or END. They reuse legitimate known local/shared values when available.
- Last Online prefers an exact known activity timestamp; when the search response supplies only Torn's Online / Idle / Offline state, that state is shown instead of an invented timestamp.
- Forum and Torn user-search requests continue through the shared Recruitment Agency API scheduler and its existing pacing limits.

## v4.8.0 simplified Recruitment Agency

**v4.8.0** returns the default interface to the core recruitment job rather than exposing every advanced workflow at once.

- Company and Faction each open on a dedicated **Search & Results** workspace.
- Search keeps the practical **END / MAN / INT minimum filters** plus player name / ID.
- Results show player identity, END, MAN, INT, the last known **Last Online** value from Player Intelligence, and a direct **Message** action.
- Message preserves the existing safe private-chat workflow: it performs the fresh official Torn membership check, uses the separately configured Company or Faction message template, prepares Torn private chat, and leaves the final **Send** entirely manual.
- Company and Faction use a compact mode switch instead of two permanently expanded navigation trees.
- Existing advanced workspaces remain intact but are disabled from normal navigation by default. Settings → **Optional Features** controls which additional Company, Faction, Scout, Smart Match, Global Intelligence, Data, Logs, pipeline, campaign, follow-up, opportunity, timeline and related workspaces appear.
- Existing IndexedDB stores and recruitment history are preserved. This release changes presentation and feature visibility rather than destructively migrating recruitment data.
- The default shell now uses Voidsmith Industries graphite surfaces, restrained red accents, high-contrast text and a simplified branded title bar.

## v4.7.6 private-chat Recruit workflow

**v4.7.6** adds a clear **Recruit** action to Company and Faction candidate rows. Recruit performs a fresh official Torn v2 membership check before preparing contact: Company recruitment checks the target's current job/company, while Faction recruitment checks current faction membership. If the player already belongs to the relevant organization type, recruitment stops and reports that membership.

Company and Faction recruitment templates are separate, browser-local settings. Company supports `{name}`, `{company_name}`, and `{company_type}`; Faction supports `{name}` and `{faction_name}`. The defaults are editable and saved for reuse.

Recruitment contact uses **Torn private chat**, not Torn Messages/Mail. For an eligible player, the script opens the target profile, opens the Torn private-chat surface, inserts the prepared text, and focuses the chat input. The final Torn **Send** remains a manual player action: v4.7.6 does not click Send, synthesize Enter, auto-submit a chat, or mutate recruitment stage merely because a draft was prepared. Do Not Contact protections remain in force with the existing deliberate override path.

The feature keeps DB15 unchanged, preserves strict Company/Faction workflow isolation, uses the shared official Torn v2 scheduler, and does not expand the Global Intelligence whitelist. A real-Chrome regression verifies the private-chat draft handoff and explicitly asserts zero Send clicks and zero Enter submissions.

## v4.7.5 dark-theme readability hotfix

**v4.7.5 hotfix:** the public shell now protects Recruitment Agency text contrast from Torn-host CSS rules that can otherwise turn table and Settings text black on the application's near-black dark panels. Company and Faction table body text uses the bright green accent, secondary IDs/details remain muted but readable, table controls retain bright text, Settings section headings/labels/form values use the bright green accent, and the Danger Zone remains red.

The contrast rules are scoped beneath `#ra-app` and use explicit high-priority shell overrides only where the host page can win the cascade. This is a shell-only release: all **29** application modules remain immutably pinned to reviewed source commit `999a2f9eafd28891dc5de461f08b1d29bbd41eea`, and the core runtime remains **v4.7.4**. The v4.7.5 public wrapper reports its own shell version in the title bar while still requiring the reviewed v4.7.4 application runtime.

## v4.7.4 bootstrap ownership hotfix

**v4.7.4 hotfix:** the public bootstrap no longer silently yields when the shared Torn document is already owned by an older Recruitment Agency version. A mismatched owner now gets one clean reload to flush stale in-memory code. If the older owner returns after that reload, the current build reports the exact conflicting version instead of allowing two script versions to run together or pretending the update succeeded. This addresses the failure mode where newer route fixes could be installed yet never become the active runtime in the current Torn page.

## v4.7.3 navigation ownership hotfix

**v4.7.3 hotfix:** Recruitment Agency navigation now binds only to controls inside its own `#ra-nav` sidebar. v4.7.2 still used document-global `[data-page]` / `[data-nav-toggle]` selectors, so Torn-owned controls could be claimed by the Recruitment Agency router. When one of those controls supplied a value that was not a Recruitment Agency route, the old live router normalized it to Company Overview. v4.7.3 also rejects invalid live route requests instead of converting them to Company Overview. Startup restoration still safely normalizes legacy persisted routes.

Regression coverage now reproduces the exact `faction-candidates -> company-overview` fallback using a foreign Torn-style `data-page="2"` control, verifies the Torn control keeps its own click handler, verifies invalid live routes leave the current Recruitment Agency page untouched, and exercises Faction Requirements in-page controls through both the public bootstrap and a Tampermonkey-like isolated userscript world.

## v4.7.2 routing hotfix (historical)

v4.7.2 made the central route state synchronous and added stale asynchronous-render protection. Those changes remain valid, but user testing proved they did **not** eliminate the live Company Overview snapback because a separate document-global navigation ownership defect still existed. v4.7.3 supersedes v4.7.2 for that live defect.

## v4.7 Faction Recruitment release

**v4.7.1 historical hotfix:** Faction page controls were changed to retain the route the recruiter selected during local control rerenders. That fix addressed one downstream symptom, but it did not eliminate the underlying split route-authority race later fixed in v4.7.2.

The v4.7 release family adds the complete Faction Recruitment slice alongside the existing Company Recruitment workflow without merging their private state.

- IndexedDB now upgrades additively through **DB15**. DB13 owns `playerIntelligence`, `companyRecruitment`, and `factionRecruitment`; DB14 adds `companyVacancies`, `companyCampaigns`, `companyRecruitmentConfig`, and `companyRecruitmentSessions`; DB15 adds `factionSpecialistProfiles`, `factionCampaigns`, `factionRecruitmentConfig`, and `factionRecruitmentSessions`. No prior object store is deleted.
- One Torn player ID maps to one shared Player Intelligence identity. Company and Faction stages, notes, follow-ups, campaigns, waivers, matching context, and workflow history remain separate and local.
- Company Recruitment keeps its dedicated Overview, Today, Discover, Candidates, Pipeline, Vacancies, Campaigns, Follow-ups, Timeline, Stage Aging, Contact Outcomes, Recruitment Sessions, Talent Pool, Reactivation, Opportunity Queue, and Compare routes.
- Faction Recruitment adds dedicated Overview, Today, Discover, Candidates, Pipeline, Requirements, Campaigns, Follow-ups, Timeline, Stage Aging, Contact Outcomes, Recruitment Sessions, Reactivation, Opportunity, and Compare routes.
- Faction Baseline Hard failures block only **Invite Ready** unless individually waived. Specialist Hard failures affect only that specialist profile and never block Invite Ready when the baseline is eligible. Manual specialist pins are never silently overwritten.
- Faction waiver management records baseline or specialist scope, reason, review date, Active/Resolved state, and resolution history while keeping the failed underlying requirement visible. DNC remains a separate explicit flag and recruitment messaging remains manual-send only.
- Scout and recruitment observations update shared Player Intelligence only through the approved fact-field boundary; recruitment-private fields never enter Global Intelligence through the generic merge path.
- The public userscript pins all **29** runtime modules immutably to reviewed v4.7.6 source commit `9475f00745f81173a114bb87451f654769b3d32a`. Its release regression suite fetches the exact pinned `v45-app.js` and verifies that its `SCRIPT_VERSION` equals the installer's expected runtime version before publication.

## What's new in v4.5

v4.5 replaces the older multi-window recruitment workflow with one managed, movable, resizable application shell and routed workspace.

### Recruitment

- **Overview** with Active, High Match, Shortlisted, and Replied KPIs
- **Discover** for Company Forum, Faction Forum, and explicit Train Buyer discovery
- **Candidates** as the single authoritative local candidate workspace
- **Pipeline** with exactly six stages:
  - Not Contacted
  - Contacted
  - Replied
  - Shortlisted
  - Hired
  - Rejected
- Add Candidate for direct Torn player IDs
- Fill Companies for sequential current-company enrichment
- Candidate detail drawer, reusable hover intelligence, context menu, keyboard access, inline stage changes, and Table/Card views
- Local recruitment-message preparation with approved placeholders and manual Torn compose only

### Intelligence

- **Scout** with direct player-ID scouting, queue/progress controls, pause/cancel, local cache/history, Fit, provisional Fit, and Trend
- **Smart Match** with local Match Profile management and zero Torn API calls for scoring
- **Global Intelligence** with strict sanitized field sharing and local retry queue

### Application

- **Settings** as a real routed page opened from the title bar without a duplicate sidebar entry
- **Data** for local store counts and CSV export
- **Logs** for sanitized local diagnostics in Advanced mode
- Simple/Advanced interface modes
- Responsive layout, saved normal-window geometry, collapsible sidebar, Torn Information launcher, and floating fallback launcher
- Routed content scrolls inside the managed window with a visible scrollbar while the title bar, page header, and sidebar remain in place
- **Maximize / Restore** fills the browser viewport without using browser fullscreen and restores the previous normal window geometry
- Centralized contextual help anchored to the relevant panel or section
- Dark theme with protected high-contrast green/off-white text, plus a light theme with black/dark text
- Proper **NUKE IT ALL!** Danger Zone reset scoped only to Recruitment Agency browser-local data

## Candidate workspace

A single Torn player ID maps to one local candidate record. Forum discovery, manual editing, Scout data, Match data, and company enrichment all compose into that candidate view without creating a second authoritative candidate database.

The v4.8.2 core Search & Results surface shows:

`Player | END | MAN | INT | Last Online | Current Company/Faction | Message`

Its core filters are player name / ID, Online / Idle / Offline status, current Company/Faction and membership presence, plus minimum END, MAN and INT. Thresholds accept plain values and compact `k`, `m`, or `b` suffixes. Pressing Search first refreshes the selected recruitment forum sources and queries Torn user search, then applies the filters to the combined local candidate intelligence. Last Online uses the most recent exact activity observation when known, otherwise the current Torn Online / Idle / Offline state when supplied by user search, and otherwise `Unknown`.

The previous deeper candidate, pipeline, Match, Scout and workflow views remain available as optional workspaces and retain their richer filters and controls when enabled.

Opening a Torn profile, forum source, candidate detail view, or message compose window **does not change pipeline stage**.

## Forum Discovery

Forum Discovery uses Torn's official v2 API only.

Discovery supports:

- Company Forum
- Faction Forum
- explicit Train Buyer posts
- manual candidate entry

The import sequence is intentionally safe:

1. Fetch the forum page.
2. Validate/normalize posts.
3. Persist forum source observations locally.
4. Merge into the single local candidate record.
5. Persist counters.
6. Persist the sanitized continuation checkpoint **last**.

If a page fails or the user cancels, already-saved work remains intact and the safe checkpoint is not advanced past unsaved candidate data.

Continuation URLs are accepted only from `api.torn.com` v2 paths and credential-shaped query parameters such as `key` and `comment` are removed before persistence.

## Legacy Message Player workflow

The older generic **Message Player** action remains available separately from the v4.7.6 Recruit action. It prepares a local message and opens Torn's message-compose page; it is not the v4.7.6 private-chat Recruit handoff. Neither path sends automatically.

Supported placeholders for the legacy Message Player action are:

`{name}`, `{player_id}`, `{looking_for}`, `{company_name}`, `{current_company}`, `{match_score}`, `{fit_score}`

The legacy workflow is:

1. Prepare/edit the message locally.
2. Optionally save it as the single global default recruitment message.
3. Copy the prepared text.
4. Open Torn's message compose page addressed to the player.
5. The user manually sends the message in Torn.

Opening message compose does **not** automatically move a candidate to Contacted.

## Smart Match

**Fit** and **Match** answer different questions.

- **Fit** is the general Scout activity/value signal calculated from player activity data.
- **Match** is suitability for the currently active local vacancy profile.

A Match Profile can enable any combination of MAN, INT, END, EE, Fit, Activity 30d, Xanax 30d, Refills 30d, Attacks 30d, RW Hits 30d, company, role, salary, and availability.

Numeric criteria scale linearly up to their target and then cap at full credit. Salary receives full credit at or below budget and degrades proportionally above it. Known categorical mismatches score zero for that criterion.

Unknown candidate-specific values are **excluded from the denominator** rather than treated as zero. If none of the enabled criteria are known, Match is **Unmeasured**, not `0`.

Smart Match remains deliberately local:

- Match Profiles stay in browser IndexedDB.
- Desired Company, Desired Role, Expected Salary, Availability, and Recruiter Note stay local.
- Match Score and Match breakdown are calculated locally.
- Editing a candidate or Match Profile recalculates Match with **zero Torn API calls**.

## Scout

Scout collects current Torn player intelligence through the same shared scheduler used by every Recruitment Agency Torn API request.

It supports:

- direct Torn player IDs / profile URLs
- current Personal Stats totals
- 7-day and 30-day historical windows where available
- Fit and provisional Fit
- weighted Trend
- local Scout cache/history
- configurable workers and per-run request budget
- pause and cancel controls

### API pacing

The application enforces a hard maximum of **75 Torn API calls per minute** and a minimum spacing of **800 ms** between Recruitment Agency Torn API calls.

Workers cannot bypass the shared scheduler. Forum Discovery, Fill Companies, Scout, and other Torn enrichment all pass through the same gate.

Smart Match scoring, local filtering/sorting, contextual help, and Google Apps Script traffic do not consume Torn API calls.

## Fit model

Default 30-day targets:

| Metric | Target | Weight |
|---|---:|---:|
| Xanax | 60 | 20 |
| Activity | 120 hours | 20 |
| Refills | 25 | 20 |
| Attacks | 200 | 20 |
| Ranked War hits | 40 | 20 |

Each component is linear and capped at its normalized weight:

`component = min(actual / target, 1) * normalizedWeight`

Weights are normalized to 100 automatically.

## Global Intelligence

Global Intelligence optionally contributes and reuses sanitized historical Torn player observations through a Google Apps Script web app backed by a private Google Sheet.

The shared schema is deliberately strict. Only these fields are eligible to leave the browser:

`playerId, name, observedAt, level, ee, activity30, xanax30, refills30, attacks30, rwHits30, networth, fit, fitType, lastActive, scoutStatus, sourceVersion`

The following remain local and are not part of the Global Intelligence schema:

- Torn API key
- forum text
- forum source URLs/history
- pipeline stage
- recruiter notes
- salary/pay negotiations
- availability overrides
- Smart Match Profiles
- Match Score and Match breakdown
- prepared/default recruitment messages
- local workflow state
- Google credentials

Fresh Scout measurements are stored locally first. Sanitized observations may then be queued for Global Intelligence. A Global Intelligence failure does not turn a successful local Scout measurement into a failure.

The reproducible Apps Script service lives in [`global/google-apps-script/`](global/google-apps-script/). Follow [`global/google-apps-script/README.md`](global/google-apps-script/README.md) to deploy it and configure the `/exec` endpoint under **Settings → Global Intelligence**.

The userscript remains functional without a Global Intelligence endpoint.

## Local storage and DB15

The current v4.8 application uses IndexedDB version **15** with additive migration only. DB13 introduces the shared/domain foundation, DB14 adds Company support stores, and DB15 adds Faction support stores. Existing stores are preserved.

Legacy v4.5 recruitment stores remain part of the additive upgrade path and include:

- `candidateLocal`
- `forumSources`
- `forumSyncState`
- Scout latest/history stores
- Global latest/history/queue stores
- Match Profiles
- sanitized application logs
- application settings/layout metadata

The upgrade path does not delete existing object stores.

### NUKE IT ALL!

The Danger Zone hard reset clears Recruitment Agency browser-local data, including candidate/forum data, Scout cache/history, Global cache/queue, Match Profiles, settings, layouts, local logs, default message, and workflow state.

It does **not** touch Torn account data, unrelated browser storage, or other userscripts.

## Settings

v4.8 Settings keeps the default interface small and moves advanced surfaces behind explicit configuration:

1. General
2. Optional Features
3. Recruitment
4. Scout
5. Candidates
6. Smart Match
7. Global Intelligence
8. Data & Reset
9. Danger Zone

**Optional Features** controls which additional Company, Faction, Scout, Smart Match, Global Intelligence, Data, Logs and workflow workspaces appear in normal navigation. Search & Results remains available regardless of optional-module choices. Advanced mode is still required for Logs and other diagnostic controls.

## Install

Install [`R4G3RUNN3R-Recruitment-Agency.user.js`](R4G3RUNN3R-Recruitment-Agency.user.js) in Tampermonkey or another compatible userscript manager.

The public userscript metadata and runtime version are **4.8.3**. The bundled public release is self-contained, while the source wrapper retains immutable module pinning for development/review. `@updateURL` and `@downloadURL` point to https://voidsmithindustries.com/torn/install/recruitment-agency.user.js; GitHub remains the source/history and contribution repository rather than the install/update authority.

A Torn API key is stored only in the browser database used by Recruitment Agency. Torn API requests are made directly from the browser through the application scheduler.

## Testing

The repository test workflow runs:

```bash
npm test
npm run syntax
```

The v4.8 release regression suite covers Company/Faction workflow isolation, the exact domain stage contracts, additive DB11→DB15 upgrades, Faction waivers and specialist matching, shared Player Intelligence boundaries, the Global Intelligence whitelist, API pacing, manual messaging, private-chat Recruit preparation with zero automated Send/Enter submission, routed UI/browser interaction, immutable userscript dependency order, exact pinned-runtime version integrity, state-first Company/Faction route ownership, stale asynchronous render rejection, dark-theme computed-style protection against hostile Torn CSS, and JavaScript syntax.

## Version history

- **v4.8.2** - adds local sortable Player/END/MAN/INT/Last Online results, Online/Idle/Offline and current organisation filters, explicit None vs Unknown membership semantics, Current Company/Faction visibility, and race-free active-route navigation; all 29 runtime modules pin to immutable v4.8.2 source `76a95ba6e009dc16682cc8ef2ef689394f65edf8`
- **v4.8.1** - restores active Search: selected-domain forum discovery plus Torn v2 user search, explicit forum MAN/INT/END extraction, domain-isolated API candidate persistence, shared known-stat reuse and Online/Idle/Offline fallback; all 29 runtime modules pin to immutable v4.8.1 source `a80b594603d414821b80a3a24587ed7002169686`
- **v4.8.0** - simplifies the default Recruitment Agency to Search & Results with END/MAN/INT filters, Last Online, safe Company/Faction Message actions, a compact domain switch, premium Voidsmith styling, and opt-in advanced workspaces; production wrapper runtime modules pin to immutable source `bf9ea64a64df23c5426f4be1a1e75f1cb392f2fd`
- **v4.7.6** - adds the private-chat Recruit workflow with fresh official Torn v2 Company/Faction membership checks, separate browser-local templates, draft insertion/focus, and strictly manual final Send; all 29 runtime modules pin to immutable v4.7.6 source `9475f00745f81173a114bb87451f654769b3d32a`
- **v4.7.5** - protects dark-theme Company/Faction tables and Settings text from Torn host CSS, using neon-green primary text, readable muted/bright controls, and preserved red Danger Zone styling while retaining the immutable v4.7.4 core
- **v4.7.4** - detects stale/duplicate bootstrap ownership, performs one clean recovery reload, and reports persistent older-owner conflicts instead of silently yielding
- **v4.7.3** - scopes Recruitment Agency navigation ownership to its own sidebar, preserves Torn-owned controls, rejects invalid live routes instead of falling back to Company Overview, and adds public-bootstrap/isolated-world in-page regressions
- **v4.7.2** - central state-first route authority and stale asynchronous-render protection; valid but incomplete for the live Company Overview snapback, which still had a separate document-global navigation ownership cause
- **v4.7.1** - Faction route-control hotfix and complete Faction Recruitment workflow; later found incomplete for the broader live route-authority race fixed in v4.7.2
- **v4.6.0** - Company Recruitment foundation and complete Company workflow slice (publication later superseded by v4.7.1 after an immutable runtime-pin mismatch was detected)
- **v4.5.4** - internal routed-content scrolling, duplicate Settings navigation cleanup, viewport Maximize/Restore with normal-geometry preservation
- **v4.5.0** - routed recruitment application, Forum Discovery pipeline, unified candidate CRM, six-stage Pipeline, messaging workflow, DB12, Scout/Smart Match/Global pages, Settings/Data/Logs, privacy and release hardening
- **v4.4** - Smart Match and Settings/contextual-help improvements
- **v4.3** - optional Global Intelligence shared-history layer
- **v4.2+** - Results Intelligence, filtering/sorting, Scout integration and workflow hardening

## Notes

Recruit Scout was used only to understand observable behavior and Torn API usage patterns. This project implements its own scoring, storage, UI, scheduling, forum discovery, candidate workflow, history, sorting/filtering, Smart Match, global sanitization, and shared-history service.
