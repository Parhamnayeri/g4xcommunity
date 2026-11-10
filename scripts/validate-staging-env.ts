/**
 * scripts/validate-staging-env.ts
 *
 * CLI wrapper and re-export for validateStagingEnvironment.
 */

export * from '../src/web/staging/validateStagingEnv';
import { validateStagingEnvironment } from '../src/web/staging/validateStagingEnv';

// CLI Execution
if (require.main === module) {
  const result = validateStagingEnvironment();
  if (!result.valid) {
    console.error('\n❌ [StagingEnvValidator] Staging environment validation FAILED:');
    result.errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  } else {
    console.log('✅ [StagingEnvValidator] Staging environment is valid and strictly isolated.');
    process.exit(0);
  }
}
