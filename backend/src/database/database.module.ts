import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/configuration';
import { ALL_ENTITIES } from './entities';

/**
 * Registers the TypeORM connection from validated config (`synchronize:false` — schema is
 * migration-owned, spec §2, §5). Consumed by both the API and worker entrypoints.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const db = config.get('database', { infer: true });
        return {
          type: 'postgres',
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.name,
          entities: ALL_ENTITIES,
          synchronize: false,
          autoLoadEntities: false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
