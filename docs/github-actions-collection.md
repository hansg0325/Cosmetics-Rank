# GitHub Actions daily collection

The standard Ubuntu runner collects all configured categories at 06:00 KST (21:00 UTC). Product detail visits retain the existing two-second interval. The website and D1 remain on Cloudflare. No Browser Run binding or paid browser service is used.

## One-time activation

1. Generate a random 32-byte COLLECTION_API_KEY locally. Never commit it.
2. Run `pnpm exec wrangler secret put COLLECTION_API_KEY` and enter that value. Build and deploy this Worker using `pnpm build` and `pnpm exec wrangler deploy`.
3. Cloudflare Zero Trust > Access controls > Service credentials: create a service token for the collector. Save its client ID and secret.
4. In the Access application protecting cosmetics-rank, add a Service Auth policy with Include > Service Token set to this token. Keep existing email Allow policies. The Worker separately checks COLLECTION_API_KEY and only permits import paths and reading keyword rules for this credential.
5. Repository Settings > Secrets and variables > Actions: register COLLECTION_API_KEY, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET.
6. Push the workflow to the default branch. Actions > Daily ranking collection > Run workflow. Confirm all categories succeeded and check administrator collection history.

Scheduled runs can be delayed or dropped by GitHub. Public repositories disable schedules after 60 days without repository activity. Re-enable the workflow when required. GitHub runner IPs may be refused by the source website; a successful cloud collection must be confirmed before relying on the schedule.

The workflow only runs on schedule or manual dispatch; it does not expose credentials to pull request workflows. The deployed collect button links administrators to the Actions page. Logs print category results without credentials or product payloads. Failed snapshots are not published; successfully collected categories remain available if another category fails. GitHub cancels jobs after 300 minutes to stay within the hosted job limit.
