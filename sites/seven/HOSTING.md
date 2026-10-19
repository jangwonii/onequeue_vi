# SEVEN hosted app

This directory is the source of the Sites-hosted SEVEN challenge application. The site identity is retained in `.openai/hosting.json`; do not create another Site for updates.

## Runtime

- Vinext / Cloudflare Workers with a persistent D1 binding named `DB`.
- Platform-owned ChatGPT sign-in. `getChatGPTUser()` obtains the verified gateway identity; clients cannot choose their user ID. The public landing page is anonymous; rooms and all writes require sign-in.
- A separate display name is saved once at first sign-in. Email addresses are never saved in room documents or returned to other members.
- `lib/challenge.ts` holds challenge rules. The API updates one versioned room document with `UPDATE ... WHERE version=?` and retries conflicts against a fresh document. Joining, starting, reviewing and recording cannot silently overwrite concurrent changes.
- Invite tokens are 256 random bits, revocable by the host. Only participants see records; the host alone can retrieve the current invite token. The invite token is retained in sessionStorage during the top-level login redirect and cleared when joining succeeds.
- Authentication is supplied by the hosting platform. Never expose this built Worker directly behind an untrusted proxy that forwards arbitrary `oai-authenticated-user-*` headers.

## Development and publishing

Follow the installed Sites skill for dependency installation, build, source push, packaging and publication. Apply generated SQL migrations to local D1 before previewing. Hosted migrations are applied by Sites at deploy time. Local test records are never included in the archive.

The maintained root-workspace helper `scripts/prepare-hosted-ui.mjs` copies the existing UI and adapts authentication for this deployment. The hosted UI is in `public/client-app.js`, `public/styles.css`, and `app/route.ts`.

For a built local preview use `npm start -- --port 4174`. `tests/hosted-browser.mjs` verifies two independent users, invite-only access, mutual approval, shared start, live record updates, concurrent D1 writes, post-start goal locking and mobile layout. It targets only loopback and simulates the trusted dispatch identity headers; it does not automate an actual person's ChatGPT login. Set `PLAYWRIGHT_MODULE` to a Playwright module path if not installed locally.

Deployment entry URL: https://seven-routine-club.weun2002.chatgpt.site

The local Node app's SQLite accounts and records are not copied to D1. Text records are self-reported; there is no photo verification or money transfer. ChatGPT sign-in is required for every participant. The app currently has no account deletion, name editing, member removal, or public matchmaking flow.
