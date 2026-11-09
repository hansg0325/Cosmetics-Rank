# GitHub Actions daily collection

The repository's self-hosted Windows runner on the local PC collects all configured categories at 06:00 KST (21:00 UTC). The PC must be powered on, awake, and signed in, with the runner available. A Windows logon task starts the runner at sign-in. Product detail visits use a three-second interval. The website and D1 remain on Cloudflare. No Browser Run binding or paid browser service is used.

## One-time activation

1. Generate a random 32-byte COLLECTION_API_KEY locally. Never commit it.
2. Run `pnpm exec wrangler secret put COLLECTION_API_KEY` and enter that value. Build and deploy this Worker using `pnpm build` and `pnpm exec wrangler deploy`.
3. Cloudflare Zero Trust > Access controls > Service credentials: create a service token for the collector. Save its client ID and secret.
4. In the Access application protecting cosmetics-rank, add a Service Auth policy with Include > Service Token set to this token. Keep existing email Allow policies. The Worker separately checks COLLECTION_API_KEY and only permits import paths and reading keyword rules for this credential.
5. Repository Settings > Secrets and variables > Actions: register COLLECTION_API_KEY, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET.
6. Add the local Windows PC as a repository self-hosted runner with the `cosmetics-rank` label. Keep the PC awake and signed in for scheduled runs.
7. Push the workflow to the default branch. Actions > Daily ranking collection > Run workflow. Confirm all categories succeeded and check administrator collection history.

Scheduled runs can be delayed or dropped by GitHub. Public repositories disable schedules after 60 days without repository activity. Re-enable the workflow when required. If the self-hosted runner is offline, scheduled jobs cannot run until it reconnects.

The workflow only runs on schedule or manual dispatch; it does not expose credentials to pull request workflows. The deployed collect button links administrators to the Actions page. Logs print category results without credentials or product payloads. Failed snapshots are not published; successfully collected categories remain available if another category fails. GitHub cancels jobs after 300 minutes to stay within the hosted job limit.
