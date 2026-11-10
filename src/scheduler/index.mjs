const schedules = {
  collection: "0 21 * * *",
  smoke: "*/5 * * * *",
};

export default {
  async scheduled(controller, env) {
    const mode = env.SCHEDULER_MODE;
    const cron = schedules[mode];
    const scheduledAt = new Date(controller.scheduledTime).toISOString();

    // Cron changes can take time to propagate between deployments.
    if (!cron || controller.cron !== cron) {
      console.log({ event: "cron_ignored", cron: controller.cron, scheduledAt });
      return;
    }

    const job = {
      version: 1,
      jobId: `${mode}:${scheduledAt}`,
      mode,
      scheduledAt,
    };

    await env.COLLECTION_QUEUE.send(job, { contentType: "json" });
    console.log({ event: "collection_job_enqueued", ...job });
  },
};
