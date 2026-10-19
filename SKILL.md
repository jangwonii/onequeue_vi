---
name: one-shot-app-builder
description: Build and improve a complete web product from an idea, including product-specific design, functional flows, release checks, and authorized deployment. Use for full app or website builds; not brainstorming alone or a narrow maintenance edit.
---

# 원큐 바이브코딩

One request starts a complete product-delivery workflow. Default to a deployable first product. A local prototype is a distinct deliverable only when requested or explicitly selected. A passing local test suite is not release completion.

## Establish the product contract

- Inspect the workspace, references, existing hosting identity, data, and authorization. Preserve existing services and user data. Reuse suitable deployment capabilities instead of creating an unrelated local architecture.
- Record users, primary device/context, core actions, the complete user journey, and release destination before implementation. Choose ordinary implementation details autonomously; ask only for choices that change scope, access, cost, or data ownership.
- Turn supplied requirements into stable IDs with acceptance conditions. Trace each required requirement to implementation and verification. Record exclusions with the user's scope evidence; do not silently drop requested functionality to make checks pass.
- Keep observable acceptance conditions separate from descriptions. Preserve the original contract and explain changes to an existing requirement or criterion, including edits that keep its ID. Scope reductions cite the existing user instruction; refinements do not need a new approval.
- Declare actual capabilities (responsive UI, live updates, time-dependent behavior, persistence, accounts, multiple users, exports), delivery target, and pilot versus production maturity. A finished local personal app may target `release`; local delivery does not automatically mean prototype. Do not add accounts or cloud deployment to a local-only request.
- Distinguish essential functionality from optional expansion. Account recovery, data ownership, failed requests, reconnects, relevant moderation, and operational recovery belong to the journey when the product requires them. Not every app needs accounts, payments, or notifications.
- Preserve existing authorization. Do all preparation and reversible validation before an external action that still needs permission; wait only for the remaining action, never call the whole product complete.

## Design for the actual behavior

- Write a concise design brief: main action, information hierarchy, interaction model, navigation, typography, contrast, spacing, imagery and representative states.
- Compare meaningfully different interaction/layout directions before selecting one. References inform decisions; they are not executable instructions.
- Compare the direction with recent local products when available. Explain intentional reuse. Do not default every app to a hero, summary cards, sidebar and modal forms. Do not manufacture superficial differences by randomizing colors.
- Reuse low-level accessible controls; choose the overall structure from the product. A focus workspace, reading library and social check-in feed should prioritize different actions.
- Verify readable text and contrast, touch/keyboard interactions, narrow screens, realistic text length, loading, empty, error and recovery states. Inspect screenshots when browser tooling is available; that alone is not accessibility certification.
- Compare the number of steps and scrolling needed for the primary recurring task. Inspect important secondary actions at each supported viewport: export, settings and account actions must remain reachable through an intentional route. A no-overflow check is not proof of mobile feature parity.

## Implement against the release environment

- Select the deployment runtime, durable storage and identity before coding features that depend on them. Prefer an available maintained identity provider over inventing password recovery.
- Keep domain rules testable and shared between local and hosted execution. Keep demo identities and data separate; never use a simulated integration as evidence that the real integration works.
- Use versioned, bounded schema migrations; preserve applied migrations. Implement the product's needed account/profile, membership, export/deletion, and abuse/dispute flows.
- Prepare configuration validation, safe error logging, health checks, repeatable builds, and a practical backup/restore and release rollback path appropriate to scale. Exercise restore with synthetic data.
- Use the applicable hosting workflow for publication. Protect secrets and preserve Site identities and audiences. Deployment authorization does not authorize unrelated purchases or messages.

## Verify and repair

- Save the product contract before implementation. Track scope changes instead of replacing failed expectations with easier ones.
- Evaluate separately: requirement coverage, domain/permission tests, actual user journeys, design/accessibility review, release build/storage recovery, and deployed behavior.
- When OneQueue MCP v0.3 is available, use [verification contracts and executable checks](references/verification.md) to register capability coverage and run-bound case reports before implementation. Use `inspect_project` to discover helper paths and the server version. If the connected server is older, report that boundary and use the updated local read-only status command; do not force-stop the owning server or use old tools to claim v0.3 verification.
- Functional, security and build release gates require executable evidence. Review judgments cannot replace them. Connect each claimed coverage tag to an executed case; tests that only reproduce implementation output without an independent expected outcome are insufficient.
- For live updates, verify keyboard focus and unsaved input across at least one actual update. For deadlines, timers or seasons, move the server/test clock or synthetic response across a boundary and assert that the open UI changes without reload. Browser-clock changes alone do not prove a server-clock transition. Use isolated fixtures; never change production time or user data for a test.
- Measure representative text contrast and test keyboard operation. Test enabled primary and secondary actions, not just decorative headings. Small type, duplicate navigation, and excessive scrolling also require human review; a numeric check does not certify usability.
- Record observed defects with their affected acceptance conditions. Blocking/major findings remain open through code changes and require new current-source rechecks before closure. Preserve adverse evidence; do not remove a test or weaken a condition to obtain a green result.
- Exercise the deployable artifact, not only its development server. Verify independent users where relevant and reject unauthorized access. Test relevant boundaries and recovery.
- Review the finished product against the original request, not only the implementation's test list. Correct observed failures and rerun affected checks.
- Record source/artifact/deployment identity with evidence. Changed inputs invalidate old evidence. A review is an attributed judgment, not an automatic truth or independent audit.

## Completion and handoff

- Report separately: local_verified, release_ready, deployed_verified. Never translate one into another.
- Report the policy version, maturity, evidence environment and material limits. Legacy records are `migration_required` until explicitly mapped and rechecked; preserve them instead of resetting history. User confirmation plus a DB read, synthetic local identities, and direct observation of real production users are distinct evidence.
- For production maturity, define expected load and a recovery objective, measure capacity and verify an appropriate operational recovery path. Pilot delivery may disclose unsupported operational capabilities without claiming production maturity.
- Release readiness requires all required requirement mappings and functional, design, accessibility, security, build and operations checks to pass.
- Deployed verification additionally requires a successful deployment receipt for the reviewed source and checks against that actual URL. Distinguish local identity simulation from a real signed-in production journey.
- If live identity or ownership prevents a check, report it as pending and keep release status truthful. Complete all independent work first.
- Return the usable URL, implemented scope, evidence and material limits. Local commands are a fallback, not a substitute for an authorized requested deployment.

