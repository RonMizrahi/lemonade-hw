import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/**
 * Serialized structural snapshot of a flow definition (metadata only — the executable
 * predicates live in code). Shape is intentionally open; M2 fills in question metadata.
 */
export interface FlowDefinitionSnapshot {
  version: number;
  questionIds: string[];
}

/**
 * Snapshot metadata for a versioned flow definition. Sessions pin the `flow_version_id`
 * they started under so in-flight sessions stay stable across flow changes (spec §4).
 */
@Entity({ name: 'flow_version' })
@Unique('uq_flow_version_version', ['version'])
export class FlowVersion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'int' })
  version!: number;

  /** Serialized structural snapshot; executable predicates live in code (spec §5). */
  @Column({ type: 'jsonb' })
  definition!: FlowDefinitionSnapshot;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
