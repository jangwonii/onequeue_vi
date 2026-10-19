# OneQueue v0.3 verification contracts

Read this when building or changing a product with the OneQueue MCP. The model still designs the tests and chooses representative states. MCP enforces evidence structure and freshness; it cannot prove that arbitrary trusted test code is honest or that a free-text description preserves meaning.

## Establish the contract

Call `inspect_project` and read `serverVersion`, `capabilityChecks`, and `support`. Use the connected host tools rather than starting a second stdio owner for the same projects. If the connected server predates v0.3, a new MCP connection is needed to load the changed tools. `node onequeue-mcp/scripts/status.mjs --project <id>` reads persisted state with the new policy without stealing the running server's lock or modifying existing evidence.

Save stable requirement IDs with `description`, `acceptance` (observable outcomes), and `required`. Set `target` to `prototype`, `release`, or `deployed`; `release` supports a finished local app. Set `maturity` to `pilot` or `production` independently. Declare only applicable `capabilities`:

| Capability | Required executable coverage tags |
| --- | --- |
| responsive | mobile-actions, contrast, keyboard |
| liveUpdates | focus-retention, live-update |
| timeDependent | time-boundary |
| persistence | reload-persistence, recovery |
| accounts | authorization, account-lifecycle |
| multiUser | multi-user, authorization |
| exportsData | export-download |

Combinations must be checked in the same executed case: responsive exports require both `mobile-actions` and `export-download`; time-dependent live updates require both `time-boundary` and `live-update`. Put both tags in that case and its criterion's `covers`. Separate desktop-export and mobile-navigation cases cannot establish mobile export. Separate API-clock and unrelated UI cases cannot establish deadline UI updates. Status exposes these as `requiredScenarios`.

Production maturity also requires `capacity` and `operatingEnvelope` describing expected load and recovery objectives. A shared production product needs direct observation of at least two real users in its production login evidence. Account lifecycle coverage includes applicable profile, export/deletion, membership, and recovery paths; do not treat sign-up alone as completion. Recovery must match the promised operating level, not just JSON export.

Each required criterion specifies `requirementIds`, `category`, `stage`, `covers`, and `verification`. Functional/security gates use `check` or `journey`; build uses `check`. Design and operational judgments can use `review`. Ordinary one-element `browser` assertions are useful checks but cannot alone satisfy a release's functional/security gates or capability coverage.

Existing requirement descriptions/acceptance and criterion descriptions/mappings/verification cannot change silently. Add a `scopeChanges` entry with `subject` (`requirement` or `criterion`), `requirementId`, `impact` (`refinement`, `expansion`, `reduction`), and a concrete `reason`. Reductions also require `userEvidence` quoting or identifying the existing user instruction. Capability removal uses subject `capabilities`, ID `profile`; maturity reduction uses subject `maturity`, ID `profile`. Record the real impact: the schema cannot detect semantic dishonesty. All new brief versions require new evidence. Do not ask again for an already authorized change.

## Register executable case reports

Host configuration in `onequeue-mcp/projects.json` registers a trusted test command and its report:

```json
"ui": {
  "args": ["tests/ui-quality.mjs"],
  "timeoutMs": 120000,
  "reportPath": "test-results/ui-quality.json"
}
```

Use distinct report paths for different checks and keep test scripts within `sources`. At execution, MCP sets `ONEQUEUE_RUN_ID` and `ONEQUEUE_REPORT_PATH`. It rejects reused reports, empty reports, skipped/failed cases and missing files even when the command exits successfully. Evidence stores the report hash; edits invalidate it. Build-only checks can use a successful build exit without a case report; functional/security/capability claims cannot.

Import `createCheckReport` from `inspect_project.support.checkReport` and the helpers from `support.qualityChecks` using normal file URLs. In a registered test that owns an isolated browser and test data:

```js
const report = createCheckReport();
await report.case('mobile-export', ['mobile-actions', 'export-download'], async () => {
  await assertMobileAction(page, {selector: '#export', width: 390});
  await assertDownload(page, '#export');
});
await report.case('polling-focus', ['focus-retention'], async () => {
  await assertFocusSurvives(page, '.task-check', {
    trigger: () => page.waitForResponse(r => r.url().endsWith('/api/state')),
    settleMs: 100
  });
});
await report.case('deadline-open-screen', ['time-boundary', 'live-update'], async () => {
  await assertLiveTransition(page, {
    selector: '.status', before: '예정', after: '미달',
    advance: () => testClock.advancePastDeadline(), timeoutMs: 20000
  });
});
await report.case('readable-description', ['contrast'], () => assertContrast(page, '.description'));
await report.finish();
```

`page` and `testClock` above are application-specific fixtures; implement them for the actual app. Never call a production mutation endpoint to advance a clock. Assert real expected outcomes, not just request completion. Run required cases at each supported layout and relevant user role. A mobile action may be inside an intentional menu: use the helper's `open` callback to open that menu before checking. The download helper checks that a file completes; also parse and validate its contents when export correctness matters.

Contrast uses rendered CSS colors and the normal/large-text thresholds. Background images, filters and opacity effects produce an unsupported result rather than a false pass; use an appropriate specialized measurement for those cases. This is representative text checking, not a full accessibility audit. Review typography, spacing, navigation and task effort separately.

## Native browser journeys

`verification: {kind: "journey", steps: [...]}` executes bounded saved actions with `browser_assert`. Supported steps: `viewport`, `focus`, `press`, `click`, `fill`, `wait`, `reload`, and `assert`. Assertions support `visible`, `text`, `count`, `url`, `reachable`, `focused`, `contrast`, and `no_overflow`.

Example steps for mobile and keyboard access:

```json
[
  {"action":"viewport","width":390,"height":844},
  {"action":"assert","assertion":{"kind":"reachable","selector":"#export"}},
  {"action":"focus","selector":"#search"},
  {"action":"press","key":"Tab"},
  {"action":"assert","assertion":{"kind":"focused","selector":"#export"}},
  {"action":"assert","assertion":{"kind":"contrast","selector":".description"}}
]
```

Coverage is derived from completed steps, not merely the criterion's `covers` labels. Focus retention needs focus, a wait crossing the actual refresh interval, then the same focused element. Live update needs different before/after text without reload. Server-time tests, downloads, multiple user sessions and recovery belong in registered test scripts using appropriate fixtures. Browser traffic remains restricted to the owned loopback preview; arbitrary external navigation/OAuth is not unlocked.

## Findings, production and status

Use `record_finding` with stable `findingId`, affected `criterionIds`, severity, summary and reproduction artifacts. Blocking/major findings prevent completion across source changes. Resolve only after the linked conditions have fresh passing evidence generated after the finding; `resolve_finding` checks this. For a defect found during a manual review, link a concrete executable regression condition before recording the finding.

`record_review.provenance` records `environment` (local/production), `identity` (none/synthetic/real), `actors`, `methods` (inspection/user-confirmation/database-read/observed-browser), and `limitations`. It is an attributed statement, not an independent certification. Production login requires real users plus observed browser use, or user confirmation together with a database read. Report which one was actually obtained. `production-smoke` and, for account apps, `production-login` must be separate production coverage. Health/build identity verification still runs through `verify_deployment`.

`get_project_status` defaults to compact output; `detail: "full"` includes the contract and evidence. `migration_required` means the older contract has not been reviewed under v3, not that the deployed app stopped working. Preserve historical records. Do not rerun a script that replaces the brief just to obtain a newer status. Inspect and record the actual changes first.
