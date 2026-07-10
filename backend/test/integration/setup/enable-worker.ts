/**
 * Side-effect module: forces the async-lookup WORKER context ON before any Nest module loads,
 * so the integration test's WorkerModule registers the BullMQ queue + LookupProcessor + relay.
 * Must be imported FIRST in the spec (before WorkerModule) so it runs before the module graph
 * evaluates {@link isLookupWorkerContext} at load time.
 */
process.env.LOOKUP_WORKER = 'true';
