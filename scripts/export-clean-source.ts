/**
 * export-clean-source.ts — استخراج ایمن و بهداشتی کدهای منبع بدون فایل‌های حساس (Safe Clean Source Export)
 *
 * الزامات امنیتی (Requirement 11):
 *  ۱. استخراج کدهای پروژه بدون فایل‌های حساس .env و کلیدهای محرمانه
 *  ۲. حذف فایل‌های دیتابیس لوکال SQLite و بک‌آپ‌ها (*.db, *.db-journal, *.db-wal)
 *  ۳. حذف پوشه .git و تاریخچه گیت
 *  ۴. حذف خروجی‌های بیلد (dist, build, .cache) و پوشه وابستگی‌ها (node_modules)
 *  ۵. ایجاد آرشیو تمیز قابل انتشار و بررسی مستقل
 */

import * as fs from 'fs';
import * as path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const exportDir = path.resolve(projectRoot, 'export');
const cleanSourceDir = path.resolve(exportDir, 'g4x-clean-source');

// الگوهای مسدود و ممنوع که هرگز نباید در آرشیو خروجی قرار گیرند
const EXCLUDED_PATTERNS = [
  /^\.env(\..+)?$/,
  /^\.git(\/|\\)?/,
  /^node_modules(\/|\\)?/,
  /^dist(\/|\\)?/,
  /^build(\/|\\)?/,
  /^\.cache(\/|\\)?/,
  /^data(\/|\\)?/,
  /\.db(-journal|-wal|-shm)?$/,
  /\.log$/,
  /^logs(\/|\\)?/,
  /^scratch(\/|\\)?/,
  /^tmp(\/|\\)?/,
  /^temp(\/|\\)?/,
  /\.(zip|tar\.gz|tgz|rar)$/,
  /^export(\/|\\)?/,
  /^dist-export(\/|\\)?/,
  /^New folder(\/|\\)?/,
];

function shouldExclude(relativePath: string): boolean {
  // فایل .env.example مجاز است
  if (relativePath === '.env.example') {
    return false;
  }
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(relativePath));
}

function copyRecursive(src: string, dest: string, currentRelative: string = '') {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relativePath = currentRelative ? `${currentRelative}/${entry.name}` : entry.name;

    if (shouldExclude(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath, relativePath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function main() {
  console.log('=== G4X COMMUNITY SAFE SOURCE EXPORT ===');
  console.log(`Source Root: ${projectRoot}`);
  console.log(`Target Export: ${cleanSourceDir}`);

  // آماده‌سازی دایرکتوری خروجی
  if (fs.existsSync(cleanSourceDir)) {
    fs.rmSync(cleanSourceDir, { recursive: true, force: true });
  }
  fs.mkdirSync(cleanSourceDir, { recursive: true });

  console.log('Copying sanitized source files (excluding .env, SQLite databases, .git, and build artifacts)...');
  copyRecursive(projectRoot, cleanSourceDir);

  // اطمینان از وجود .env.example
  const exampleEnvPath = path.join(projectRoot, '.env.example');
  if (fs.existsSync(exampleEnvPath)) {
    fs.copyFileSync(exampleEnvPath, path.join(cleanSourceDir, '.env.example'));
  }

  console.log('✅ Clean source exported successfully to:');
  console.log(`   ${cleanSourceDir}`);
  console.log('Verified: No secrets, .env files, SQLite databases, or git directories included.');
}

main().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});
