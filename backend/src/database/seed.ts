import { AppDataSource } from './data-source';
import { FlowVersion } from './entities';
import { ACTIVE_FLOW_VERSION } from '../flow-engine/flow-definition';

/**
 * Registers the active {@link FlowVersion} row idempotently (spec §11). Safe to run on every
 * boot and via `npm run seed`. M2 expands the serialized `definition` snapshot.
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
        definition: { version: ACTIVE_FLOW_VERSION, questionIds: [] },
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
