const repository = "hansg0325/Cosmetics-Rank";
const schedules = {
  collection: {
    cron: "0 21 * * *",
    workflow: "daily-collection.yml",
    inputs: { category: "all" },
  },
  smoke: {
    cron: "*/5 * * * *",
    workflow: "schedule-smoke-test.yml",
  },
};

export default {
  async scheduled(controller, env) {
    const target = schedules[env.SCHEDULER_MODE];
    const scheduledAt = new Date(controller.scheduledTime).toISOString();

    // Cron changes can take time to propagate between deployments.
    if (!target || controller.cron !== target.cron) {
      console.log({ event: "cron_ignored", cron: controller.cron, scheduledAt });
      return;
    }

    if (!env.GITHUB_DISPATCH_TOKEN) {
      throw new Error("Missing GitHub dispatch token (GITHUB_DISPATCH_TOKEN)");
    }

    const response = await fetch(
      `https://api.github.com/repos/${repository}/actions/workflows/${target.workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
          "Content-Type": "application/json",
          "User-Agent": "cosmetics-rank-scheduler",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: JSON.stringify({ ref: "main", inputs: target.inputs }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!response.ok) {
      throw new Error(
        `GitHub rejected ${target.workflow}: HTTP ${response.status} (scheduled at ${scheduledAt})`,
      );
    }

    const run = response.status === 200 ? await response.json().catch(() => null) : null;
    console.log({
      event: "github_dispatch_accepted",
      workflow: target.workflow,
      scheduledAt,
      runId: run?.workflow_run_id,
      runUrl: run?.html_url,
    });
  },
};
