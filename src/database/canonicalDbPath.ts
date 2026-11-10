/**
 * src/database/canonicalDbPath.ts
 *
 * Canonical SQLite Database Path Resolver for G4X Community.
 *
 * PRISMA COMPATIBILITY INVARIANT:
 *  Prisma CLI interprets relative SQLite database URLs (e.g. `file:./dev.db`)
 *  relative to the directory containing `schema.prisma` (i.e. `<repoRoot>/prisma/`),
 *  NOT relative to `process.cwd()`.
 */

import fs from 'fs';
import path from 'path';

export interface CanonicalDatabaseTarget {
  canonicalPath: string;
  canonicalUrl: string;
  source: 'cli_arg' | 'env_var' | 'matched_both';
  rawInput: string;
}

export function findPrismaSchemaDir(): string {
  const candidate = path.resolve(process.cwd(), 'prisma');
  if (fs.existsSync(path.join(candidate, 'schema.prisma'))) {
    return candidate;
  }
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

function resolveSinglePath(
  rawInput: string,
  source: 'cli_arg' | 'env_var',
  schemaDir: string,
  allowMissingFile?: boolean
): CanonicalDatabaseTarget {
  let cleanPath = rawInput;
  if (cleanPath.startsWith('file:')) {
    cleanPath = cleanPath.slice(5);
  }

  let resolvedPath: string;
  if (path.isAbsolute(cleanPath)) {
    resolvedPath = path.normalize(cleanPath);
  } else {
    if (source === 'env_var') {
      resolvedPath = path.normalize(path.resolve(schemaDir, cleanPath));
    } else {
      resolvedPath = path.normalize(path.resolve(process.cwd(), cleanPath));
    }
  }

  if (fs.existsSync(resolvedPath)) {
    try {
      resolvedPath = fs.realpathSync(resolvedPath);
    } catch {}
  } else if (!allowMissingFile) {
    throw new Error(
      `[CRITICAL SAFETY ERROR] Resolved target SQLite database file does not exist at '${resolvedPath}' (Source: ${source}, Raw: '${rawInput}'). Refusing to operate on non-existent database.`
    );
  }

  const canonicalUrl = `file:${resolvedPath.replace(/\\/g, '/')}`;

  return {
    canonicalPath: resolvedPath,
    canonicalUrl,
    source,
    rawInput,
  };
}

/**
 * Resolves database configuration, rejecting conflicting CLI and ENV configurations.
 */
export function resolveCanonicalDatabaseTarget(options?: {
  databaseUrl?: string;
  args?: string[];
  allowMissingFile?: boolean;
}): CanonicalDatabaseTarget {
  const args = options?.args || process.argv.slice(2);
  const schemaDir = findPrismaSchemaDir();

  let cliInput: string | undefined;
  const dbIndex = args.indexOf('--database');
  if (dbIndex !== -1 && args[dbIndex + 1]) {
    cliInput = args[dbIndex + 1].trim();
  }

  const envInput: string | undefined = options?.databaseUrl || process.env.DATABASE_URL?.trim();

  // If both are provided, verify they resolve to the exact same canonical file
  if (cliInput && envInput) {
    const cliTarget = resolveSinglePath(cliInput, 'cli_arg', schemaDir, options?.allowMissingFile);
    const envTarget = resolveSinglePath(envInput, 'env_var', schemaDir, options?.allowMissingFile);

    if (cliTarget.canonicalPath.toLowerCase() !== envTarget.canonicalPath.toLowerCase()) {
      throw new Error(
        `[CRITICAL SAFETY ERROR] Conflicting database configurations detected: CLI argument '--database' resolves to '${cliTarget.canonicalPath}' while environment variable DATABASE_URL resolves to '${envTarget.canonicalPath}'. Both sources must point to the exact same canonical target or only one must be provided.`
      );
    }

    return {
      canonicalPath: cliTarget.canonicalPath,
      canonicalUrl: cliTarget.canonicalUrl,
      source: 'matched_both',
      rawInput: `cli:${cliInput} | env:${envInput}`,
    };
  }

  if (cliInput) {
    return resolveSinglePath(cliInput, 'cli_arg', schemaDir, options?.allowMissingFile);
  }

  if (envInput) {
    return resolveSinglePath(envInput, 'env_var', schemaDir, options?.allowMissingFile);
  }

  throw new Error(
    '[CRITICAL SAFETY ERROR] Missing database configuration. Explicit DATABASE_URL environment variable or --database <path> argument is REQUIRED. Default path guessing is strictly prohibited.'
  );
}
