/**
 * Whether this process should run the async-lookup WORKER side (BullMQ queue connection,
 * the LookupProcessor consumer, and the OutboxRelay poll loop).
 *
 * The API process only PRODUCES lookups (it writes outbox rows via LookupTriggerService and
 * never touches Redis), so it must NOT register the consumer — otherwise @nestjs/bullmq's
 * explorer would start a second Worker competing with the dedicated worker process and the
 * blocking sim would run inside the HTTP event loop (spec §2, §7).
 *
 * Detection: an explicit `LOOKUP_WORKER` env flag wins (used by tests); otherwise the worker
 * is inferred from the entrypoint filename (`main.worker`).
 * @returns true in the worker process (or when forced on), false in the API process
 */
export function isLookupWorkerContext(): boolean {
  const flag = process.env.LOOKUP_WORKER;
  if (flag === 'true') {
    return true;
  }
  if (flag === 'false') {
    return false;
  }
  const entrypoint = process.argv[1] ?? '';
  return entrypoint.includes('main.worker');
}
