/**
 * sessionStore.ts — پایدارسازی نشست‌های Express در SQLite از طریق Prisma
 *
 * قابلیت‌ها:
 *  - پیاده‌سازی کامل Store برای express-session
 *  - ذخیره‌سازی نشست‌ها در جدول `sessions` با فیلد انقضا (expires_at)
 *  - پاک‌سازی دوره‌ای نشست‌های منقضی‌شده
 */

import session from 'express-session';
import { PrismaClient } from '@prisma/client';

export class PrismaSessionStore extends session.Store {
  private prisma: PrismaClient;
  private cleanupInterval?: NodeJS.Timeout;

  constructor(prisma: PrismaClient, cleanupIntervalMs: number = 15 * 60 * 1000) {
    super();
    this.prisma = prisma;

    // اجرای دوره‌ای پاک‌سازی نشست‌های منقضی
    this.cleanupInterval = setInterval(() => {
      this.clearExpired().catch((err) => {
        console.error('[SessionStore] Error clearing expired sessions:', err);
      });
    }, cleanupIntervalMs);

    // Unref timer so it does not block Node process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  public async get(
    sid: string,
    callback: (err?: any, session?: session.SessionData | null) => void,
  ): Promise<void> {
    try {
      const record = await this.prisma.session.findUnique({
        where: { sid },
      });

      if (!record) {
        return callback(null, null);
      }

      // بررسی تاریخ انقضا
      if (new Date() > record.expiresAt) {
        await this.destroy(sid);
        return callback(null, null);
      }

      const data = JSON.parse(record.data) as session.SessionData;
      callback(null, data);
    } catch (error) {
      callback(error);
    }
  }

  public async set(
    sid: string,
    sessionData: session.SessionData,
    callback?: (err?: any) => void,
  ): Promise<void> {
    try {
      const maxAge = sessionData.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires)
        : new Date(Date.now() + maxAge);

      const serializedData = JSON.stringify(sessionData);

      await this.prisma.session.upsert({
        where: { sid },
        create: {
          sid,
          data: serializedData,
          expiresAt,
        },
        update: {
          data: serializedData,
          expiresAt,
        },
      });

      if (callback) callback(null);
    } catch (error) {
      if (callback) callback(error);
    }
  }

  public async destroy(
    sid: string,
    callback?: (err?: any) => void,
  ): Promise<void> {
    try {
      await this.prisma.session.deleteMany({
        where: { sid },
      });
      if (callback) callback(null);
    } catch (error) {
      if (callback) callback(error);
    }
  }

  public async touch(
    sid: string,
    sessionData: session.SessionData,
    callback?: (err?: any) => void,
  ): Promise<void> {
    try {
      const maxAge = sessionData.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      const expiresAt = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires)
        : new Date(Date.now() + maxAge);

      await this.prisma.session.updateMany({
        where: { sid },
        data: { expiresAt },
      });

      if (callback) callback(null);
    } catch (error) {
      if (callback) callback(error);
    }
  }

  public async clearExpired(): Promise<number> {
    const result = await this.prisma.session.deleteMany({
      where: {
        expiresAt: {
          lt: new Date(),
        },
      },
    });
    return result.count;
  }

  public stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}
