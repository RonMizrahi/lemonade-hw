import { AppDataSource } from './data-source';
import { FlowVersion, FlowDefinitionSnapshot } from './entities';
import { ACTIVE_FLOW_VERSION, FLOW_DEFINITION } from '../flow-engine/flow-definition';

/**
 * Builds the serialized structural snapshot persisted alongside the active version. The
 * executable predicates live in code; the snapshot records the version + declared question ids
 * (presentation order) as metadata for auditing which flow a session was pinned to (spec §5).
 * @returns the snapshot for the active flow definition.
 */
function buildFlowSnapshot(): FlowDefinitionSnapshot {
  return {
    version: FLOW_DEFINITION.version,
    questionIds: FLOW_DEFINITION.questions.map((question) => question.id),
  };
}

/**
 * Registers the active {@link FlowVersion} row idempotently from the real flow definition
 * (spec §11). Safe to run on every boot and via `npm run seed`.
 * @returns resolves once the active version exists.
 */
export async function seed(): Promise<void> {
  const dataSource = AppDataSource.isInitialized ? AppDataSource : await AppDataSource.initialize();

  const repo = dataSource.getRepository(FlowVersion);
  const existing = await repo.findOne({ where: { version: ACTIVE_FLOW_VERSION } });

  if (!existing) {
    await repo.save(
      repo.create({
        version: ACTIVE_FLOW_VERSION,
        definition: buildFlowSnapshot(),
      }),
    );

    console.log(`Seeded flow version ${ACTIVE_FLOW_VERSION}`);
  } else {
    console.log(`Flow version ${ACTIVE_FLOW_VERSION} already present — skipping`);
  }
}

if (require.main === module) {
  seed()
    .then(() => AppDataSource.destroy())
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error('Seed failed:', error);
      process.exit(1);
    });
}
