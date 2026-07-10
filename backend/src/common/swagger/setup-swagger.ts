import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * The path Swagger UI is served under.
 */
export const SWAGGER_PATH = 'docs';

/**
 * Mounts Swagger/OpenAPI UI at `/docs` and the JSON at `/docs-json` (spec §6, §11 bonus).
 * @param app the Nest application instance
 */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Onboarding API')
    .setDescription('Lemonade-style dynamic onboarding wizard API')
    .setVersion('1.0')
    .addTag('onboarding')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document, {
    jsonDocumentUrl: `${SWAGGER_PATH}-json`,
  });
}
