# GitHub Actions daily collection

The `cosmetics-rank-scheduler` Cloudflare Worker requests collection at 06:00 KST (21:00 UTC). GitHub Actions then assigns the job to an online self-hosted Windows runner with the `cosmetics-rank` label. The runner needs Python and Chrome access and its PC must remain awake until collection finishes. The website and D1 remain on Cloudflare.

## Configure the collector

1. Generate a random 32-byte COLLECTION_API_KEY locally. Never commit it.
2. Run `pnpm exec wrangler secret put COLLECTION_API_KEY` and enter that value. Build and deploy this Worker using `pnpm build` and `pnpm exec wrangler deploy`.
3. Cloudflare Zero Trust > Access controls > Service credentials: create a service token for the collector. Save its client ID and secret.
4. In the existing Access application, protect `/api/imports` and `/api/imports/*` and keep the Service Auth policy for this token. The Worker separately checks `COLLECTION_API_KEY` for import writes. This credential does not grant administrator permissions in the Worker.
5. Repository Settings > Secrets and variables > Actions: register COLLECTION_API_KEY, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET.
6. Add the local Windows PC as a repository self-hosted runner with the `cosmetics-rank` label. Confirm its service is running and can launch Chrome.
7. Push the workflow to the default branch. Actions > Daily ranking collection > Run workflow. Confirm all categories succeeded and check administrator collection history.

## Configure the Cloudflare scheduler

1. Deploy the scheduler without a Cron Trigger using `bash ./pnpmw exec wrangler deploy --config wrangler.scheduler.jsonc --env setup`.
2. Create a fine-grained GitHub token for `hansg0325/Cosmetics-Rank` with the repository permission `Actions: Read and write`. In the scheduler Worker's Settings, save it as a secret named `GITHUB_DISPATCH_TOKEN`.
3. Deploy the test schedule using `bash ./pnpmw exec wrangler deploy --config wrangler.scheduler.jsonc --env smoke`. It dispatches the log-only workflow every five minutes. Cron configuration may take up to 15 minutes to propagate.
4. Check the Worker's `github_dispatch_accepted` log and the corresponding **Schedule smoke test** run in GitHub. Confirm both the hosted and Windows jobs print `SCHEDULE_TEST_OK`. The GitHub event is `workflow_dispatch` because Cloudflare triggers it through the API.
5. Switch the same Worker to the daily schedule using `bash ./pnpmw exec wrangler deploy --config wrangler.scheduler.jsonc --env=""`. This dispatches **Daily ranking collection** with `category=all` at 06:00 KST. The scheduler ignores events for a previous Cron Trigger during configuration propagation.

The Worker log records the requested time and GitHub run ID when available. Check the GitHub run and collection history to confirm that the runner actually collected and saved the data. An offline runner can delay the start after GitHub accepts the request. To pause automatic collection, deploy `--env setup` again. Replace the GitHub token secret before it expires.

Manual collection remains available from GitHub Actions. Logs print category results without credentials or product payloads. Failed snapshots are not published, and successfully collected categories remain available if another category fails. The job times out after 300 minutes.
