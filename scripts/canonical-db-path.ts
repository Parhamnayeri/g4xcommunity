/**
 * scripts/canonical-db-path.ts
 *
 * Canonical SQLite Database Path Resolver for G4X Community.
 *
 * PRISMA COMPATIBILITY INVARIANT:
 *  Prisma CLI interprets relative SQLite database URLs (e.g. `file:./dev.db`)
 *  relative to the directory containing `schema.prisma` (i.e. `<repoRoot>/prisma/`),
 *  NOT relative to `process.cwd()`.
 *
 *  This module guarantees that all pre-migration gates, inspection scripts,
 *  reconcilers, and Prisma CLI commands ALWAYS target the exact same canonical
 *  physical SQLite database file, properly handling:
 *   - `DATABASE_URL` environment variables
 *   - `--database <path>` CLI arguments
 *   - Relative vs. absolute paths
 *   - Schema-relative resolution for Prisma compatibility
 *   - Operating system symlinks (via fs.realpathSync)
 *   - Fail-closed validation on missing or non-existent files
 */

import fs from 'fs';
import path from 'path';

export interface CanonicalDatabaseTarget {
  canonicalPath: string;
  canonicalUrl: string;
  source: 'cli_arg' | 'env_var';
  rawInput: string;
}

export function findPrismaSchemaDir(): string {
  // Standard location in G4X Community is <repoRoot>/prisma
  const candidate = path.resolve(process.cwd(), 'prisma');
  if (fs.existsSync(path.join(candidate, 'schema.prisma'))) {
    return candidate;
  }
  // Fallback: search upward if running from a subfolder
  let current = process.cwd();
  for (let i = 0; i < 4; i++) {
    const check = path.join(current, 'prisma', 'schema.prisma');
    if (fs.existsSync(check)) {
      return path.dirname(check);
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(process.cwd(), 'prisma');
}

/**
 * Resolves a raw database URL or file path to its canonical physical location.
 *
 * @param options.databaseUrl - Optional database URL string
 * @param options.args - Optional CLI argument array (defaults to process.argv.slice(2))
 * @param options.allowMissingFile - If true, does not fail if file doesn't exist yet (for fresh DB tests)
 */
export function resolveCanonicalDatabaseTarget(options?: {
  databaseUrl?: string;
  args?: string[];
  allowMissingFile?: boolean;
}): CanonicalDatabaseTarget {
  const args = options?.args || process.argv.slice(2);
  let rawInput: string | undefined = options?.databaseUrl;
  let source: 'cli_arg' | 'env_var' = 'env_var';

  // 1. Check CLI argument: --database <path>
  const dbIndex = args.indexOf('--database');
  if (dbIndex !== -1 && args[dbIndex + 1]) {
    rawInput = args[dbIndex + 1].trim();
    source = 'cli_arg';
  }

  // 2. Check environment variable: DATABASE_URL
  if (!rawInput && process.env.DATABASE_URL) {
    rawInput = process.env.DATABASE_URL.trim();
    source = 'env_var';
  }

  // 3. Strict guard: Fail closed if no configuration was supplied
  if (!rawInput) {
    throw new Error(
      '[CRITICAL SAFETY ERROR] Missing database configuration. Explicit DATABASE_URL environment variable or --database <path> argument is REQUIRED. Default path guessing is strictly prohibited.'
    );
  }

  // 4. Strip `file:` protocol if present
  let cleanPath = rawInput;
  if (cleanPath.startsWith('file:')) {
    cleanPath = cleanPath.slice(5);
  }

  // 5. Schema-relative vs. CWD-relative resolution
  const schemaDir = findPrismaSchemaDir();
  let resolvedPath: string;

  if (path.isAbsolute(cleanPath)) {
    resolvedPath = path.normalize(cleanPath);
  } else {
    if (source === 'env_var') {
      // Prisma interprets relative paths in DATABASE_URL relative to schema.prisma directory!
      resolvedPath = path.normalize(path.resolve(schemaDir, cleanPath));
    } else {
      // CLI arguments are interpreted relative to the operator's current working directory
      resolvedPath = path.normalize(path.resolve(process.cwd(), cleanPath));
    }
  }

  // 6. Existence and canonical symlink resolution
  if (fs.existsSync(resolvedPath)) {
    try {
      resolvedPath = fs.realpathSync(resolvedPath);
    } catch {
      // If realpath fails (e.g. permission or special device), keep normalized resolvedPath
    }
  } else if (!options?.allowMissingFile) {
    throw new Error(
      `[CRITICAL SAFETY ERROR] Resolved target SQLite database file does not exist at '${resolvedPath}' (Source: ${source}, Raw: '${rawInput}'). Refusing to operate on non-existent database.`
    );
  }

  // Standardize SQLite file URL format (forward slashes for Prisma client compatibility)
  const canonicalUrl = `file:${resolvedPath.replace(/\\/g, '/')}`;

  return {
    canonicalPath: resolvedPath,
    canonicalUrl,
    source,
    rawInput,
  };
}
