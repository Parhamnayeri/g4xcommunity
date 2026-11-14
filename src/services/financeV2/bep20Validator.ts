/**
 * bep20Validator.ts — اعتبارسنجی قطعی آدرس‌های BNB Smart Chain (BEP-20) و چکسام EIP-55
 *
 * الزامات امنیتی Finance V2.1:
 *  ۱. بررسی دقیق طول داده هگزادسیمال: دقیقاً ۲۰ بایت (۴۰ کاراکتر هگز پس از 0x)
 *  ۲. رد کامل کاراکترهای نامعتبر غیرهگز
 *  ۳. اعتبارسنجی دقیق استاندارد چکسام EIP-55 برای آدرس‌های با حروف بزرگ و کوچک (Mixed-case)
 *  ۴. پذیرش آدرس‌های تمام‌کوچک یا تمام‌بزرگ به عنوان آدرس معتبر بدون چکسام
 *  ۵. مسدودی آدرس صفر (Zero/Burn Address) جهت جلوگیری از سوختن وجوه
 *  ۶. تفکیک صریح میان فرمت ساختاری EVM و شبکه انتخابی کاربر (منحصراً BSC_BEP20)
 *  ۷. عدم درخواست یا دریافت کلید خصوصی یا عبارت بازیابی تحت هر شرایطی
 */

import { keccak256 } from 'js-sha3';

export interface Bep20ValidationResult {
  isValid: boolean;
  normalizedAddress: string; // آدرس تمام حروف کوچک
  checksumAddress: string;   // آدرس با استاندارد چکسام EIP-55
  error?: string;
}

/**
 * تبدیل آدرس به فرمت چکسام استاندارد EIP-55
 */
export function toChecksumAddress(address: string): string {
  const clean = address.toLowerCase().replace(/^0x/, '');
  const hash = keccak256(clean);
  let ret = '0x';
  for (let i = 0; i < clean.length; i++) {
    if (parseInt(hash[i], 16) >= 8) {
      ret += clean[i].toUpperCase();
    } else {
      ret += clean[i];
    }
  }
  return ret;
}

/**
 * اعتبارسنجی همه‌جانبه آدرس مقصد برداشت تتر روی شبکه BEP-20
 */
export function validateBep20Address(
  address: string,
  network: string = 'BSC_BEP20'
): Bep20ValidationResult {
  // ۱. بررسی انطباق شبکه
  const normalizedNetwork = network ? network.trim().toUpperCase() : '';
  if (normalizedNetwork !== 'BSC_BEP20' && normalizedNetwork !== 'BEP20' && normalizedNetwork !== 'BNB_SMART_CHAIN_BEP20') {
    throw new Error(
      `UNSUPPORTED_PAYOUT_NETWORK: Only BNB Smart Chain (BSC BEP-20) is supported for USDT withdrawals, received '${network}'`
    );
  }

  // ۲. بررسی وجود و نوع داده
  if (typeof address !== 'string' || !address) {
    throw new Error('INVALID_ADDRESS: Destination address must be a non-empty string');
  }

  const trimmed = address.trim();

  // ۳. بررسی پیشوند 0x و طول دقیق ۴۲ کاراکتر (۲۰ بایت هگز)
  if (!trimmed.startsWith('0x') && !trimmed.startsWith('0X')) {
    throw new Error('INVALID_BEP20_PREFIX: Destination address must begin with 0x prefix');
  }

  if (trimmed.length !== 42) {
    throw new Error(
      `INVALID_BEP20_LENGTH: Destination address must be exactly 42 characters (20 hex bytes), got ${trimmed.length}`
    );
  }

  // ۴. بررسی کاراکترهای معتبر هگزادسیمال
  const hexPart = trimmed.substring(2);
  if (!/^[0-9a-fA-F]{40}$/.test(hexPart)) {
    throw new Error('MALFORMED_HEX_CHARACTERS: Address contains non-hexadecimal characters');
  }

  // ۵. جلوگیری از واریز به آدرس صفر (Burn Address)
  if (hexPart.toLowerCase() === '0000000000000000000000000000000000000000') {
    throw new Error('ZERO_ADDRESS_REJECTED: Payouts to the zero address (0x000...000) are strictly rejected');
  }

  // ۶. اعتبارسنجی چکسام EIP-55 برای آدرس‌های با حروف بزرگ و کوچک (Mixed-case)
  const hasUpper = /[A-F]/.test(hexPart);
  const hasLower = /[a-f]/.test(hexPart);
  const checksumAddress = toChecksumAddress(trimmed);

  if (hasUpper && hasLower) {
    if (trimmed !== checksumAddress) {
      throw new Error(
        `EIP55_CHECKSUM_INVALID: Mixed-case address failed EIP-55 checksum verification. Expected '${checksumAddress}'`
      );
    }
  }

  return {
    isValid: true,
    normalizedAddress: trimmed.toLowerCase(),
    checksumAddress,
  };
}
