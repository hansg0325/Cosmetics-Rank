# Automatic ranking collection

At 06:00 KST (21:00 UTC), the `cosmetics-rank-scheduler` Worker enqueues an all-category collection job in `cosmetics-rank-collection`. Windows Task Scheduler checks the queue every minute from 05:55 through 06:30 in the PC's local time, then stops polling. The collector saves snapshots through the site's existing authenticated API.

The PC must be awake and the Windows user who configured the collector must be signed in during the polling window. Locking the screen is fine. The PC's time zone must be Korea Standard Time. If it comes online before 06:30 KST, the queued job can still run that day; after the polling window, it waits for the next day's window. Previous dates are discarded because the collector reads live rankings. On Workers Free the queue retains messages for 24 hours.

## One-time setup

1. Create `cosmetics-rank-collection` using `bash ./pnpmw exec wrangler queues create cosmetics-rank-collection --config wrangler.scheduler.jsonc`. Enable HTTP Pull with `bash ./pnpmw exec wrangler queues consumer http add cosmetics-rank-collection --config wrangler.scheduler.jsonc --batch-size 1 --visibility-timeout-secs 120`. Find the queue ID with `wrangler queues info cosmetics-rank-collection`.
2. Create a Cloudflare API token with `Account → Queues → Edit`, scoped to the queue's account. Have the existing upload credentials ready: `COLLECTION_API_KEY`, `CF_ACCESS_CLIENT_ID`, and `CF_ACCESS_CLIENT_SECRET`.
3. On the collector PC, open PowerShell in the repository and run `python scripts/queue-collection.py --configure --account-id ACCOUNT_ID --queue-id QUEUE_ID` using the Python executable you will register for the task. It prompts for each secret and saves them encrypted for the current Windows account under `%LOCALAPPDATA%\CosmeticsRank`. Add `--smoke-only` if you only have the queue token. Rerun without `--smoke-only` before enabling production collection.
4. From the same Windows account, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\register-queue-collector.ps1 -PythonExe 'C:\path\to\python.exe'`. The script checks for Python and Selenium, then registers **Cosmetics Rank Queue Collector**. The task polls every minute from 05:55 through 06:30 local time, only while that Windows user is signed in. It does not open a console or overlap an active collection.

To update an already-configured collector PC, pull the latest `main` and rerun the same registration command. It replaces the existing task schedule; the encrypted credentials remain in place.

## Verify and enable the schedule

1. Deploy `bash ./pnpmw exec wrangler deploy --config wrangler.scheduler.jsonc --env smoke`. The Worker enqueues a log-only job every five minutes. Cloudflare can take up to 15 minutes to propagate a Cron Trigger change.
2. Confirm the Worker logged `collection_job_enqueued` and `%LOCALAPPDATA%\CosmeticsRank\queue-collector.log` has a matching `queue_job_completed` entry with a `smoke:` job ID.
3. Deploy `bash ./pnpmw exec wrangler deploy --config wrangler.scheduler.jsonc --env=""` to activate the 06:00 KST collection schedule. Confirm the next job starts and saves all categories in the local log and site collection history.

The Windows collector saves the job locally before acknowledging it. If the PC shuts down mid-run, the next poll can restart that job on the same day. Completed job IDs prevent later redelivery from starting an already recorded attempt. The log includes the collector's output and the exit code for each completed attempt.

On the deployed site, sign in as an administrator and select **관리자 → 데이터 수집** to enqueue an all-category job in the same Cloudflare queue. If the request is made from 05:55 through 06:30 local time, the Windows collector picks it up on its next poll; otherwise it waits for the next day's polling window. The GitHub `workflow_dispatch` entry remains available as a fallback.

To pause automatic collection, deploy `--env setup` and disable the Windows task if it must stop consuming existing messages.
