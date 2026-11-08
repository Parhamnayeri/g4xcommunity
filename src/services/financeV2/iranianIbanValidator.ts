/**
 * iranianIbanValidator.ts — اعتبارسنجی شماره شبای بانکی ایران بر اساس استاندارد ISO 13616 و ISO 7064 Mod 97-10
 *
 * الزامات اعتبارسنجی:
 *  ۱. شروع الزامی با پیشوند IR (بدون حساسیت به حروف بزرگ/کوچک)
 *  ۲. طول دقیق ۲۶ کاراکتر (IR + ۲۴ رقم عددی)
 *  ۳. چکسام ریاضی Mod 97-10:
 *      - انتقال ۴ کاراکتر اول به انتهای رشته (IR + ۲ رقم کنترلی)
 *      - جایگزینی حروف انگلیسی با عدد (I = 18, R = 27)
 *      - محاسبه باقیمانده بر ۹۷؛ باقیمانده معتبر باید دقیقاً برابر ۱ باشد.
 *  ۴. ماسک کردن شماره شبا در لاگ‌ها و پیش‌نمایش‌های معمولی
 */

export interface IranianIbanValidationResult {
  isValid: boolean;
  normalizedIban: string;
  maskedIban: string;
  bankCode?: string;
  error?: string;
}

/**
 * ماسک کردن امن شماره شبا برای حفظ حریم خصوصی: نمایش ۴ کاراکتر اول و ۴ رقم آخر
 * مثال: IR98...3003
 */
export function maskIban(iban: string): string {
  if (!iban || typeof iban !== 'string') return '';
  const clean = iban.trim().toUpperCase().replace(/\s+/g, '');
  if (clean.length < 8) return '****';
  return `${clean.substring(0, 4)}...${clean.substring(clean.length - 4)}`;
}

/**
 * ماسک کردن آدرس کیف پول رمز ارز: نمایش ۶ کاراکتر اول و ۴ کاراکتر آخر
 * مثال: 0x1234...5678
 */
export function maskCryptoAddress(address: string): string {
  if (!address || typeof address !== 'string') return '';
  const clean = address.trim();
  if (clean.length <= 10) return clean;
  return `${clean.substring(0, 6)}...${clean.substring(clean.length - 4)}`;
}

/**
 * اعتبارسنجی قطعی شماره شبای ایران
 */
export function validateIranianIban(iban: string): IranianIbanValidationResult {
  if (!iban || typeof iban !== 'string') {
    return {
      isValid: false,
      normalizedIban: '',
      maskedIban: '',
      error: 'IBAN is required and must be a non-empty string',
    };
  }

  // حذف فواصل احتمالی و استانداردسازی حروف بزرگ
  const clean = iban.trim().toUpperCase().replace(/\s+/g, '');

  if (!clean.startsWith('IR')) {
    return {
      isValid: false,
      normalizedIban: clean,
      maskedIban: maskIban(clean),
      error: 'Iranian IBAN (Sheba) must begin with IR prefix',
    };
  }

  if (clean.length !== 26) {
    return {
      isValid: false,
      normalizedIban: clean,
      maskedIban: maskIban(clean),
      error: `Iranian IBAN must be exactly 26 characters (IR + 24 digits), got ${clean.length}`,
    };
  }

  const digitsOnly = clean.substring(2);
  if (!/^\d{24}$/.test(digitsOnly)) {
    return {
      isValid: false,
      normalizedIban: clean,
      maskedIban: maskIban(clean),
      error: 'Iranian IBAN must contain only numeric digits after the IR prefix',
    };
  }

  // استاندارد چکسام ISO 7064 Mod 97-10:
  // ۴ کاراکتر اول را به انتهای رشته منتقل می‌کنیم:
  // e.g. IRkk dddddddddddddddddddddd -> dddddddddddddddddddddd IR kk
  // حرف I برابر 18 و حرف R برابر 27 است، بنابراین IR -> 1827
  const checkDigits = clean.substring(2, 4);
  const accountBody = clean.substring(4);
  const rearranged = `${accountBody}1827${checkDigits}`;

  try {
    const remainder = BigInt(rearranged) % 97n;
    if (remainder !== 1n) {
      return {
        isValid: false,
        normalizedIban: clean,
        maskedIban: maskIban(clean),
        error: 'Invalid IBAN checksum. Please verify the Sheba number digits.',
      };
    }
  } catch {
    return {
      isValid: false,
      normalizedIban: clean,
      maskedIban: maskIban(clean),
      error: 'Failed to compute mathematical IBAN checksum',
    };
  }

  // ارقام ۴ الی ۷ به طور معمول کد بانک هستند
  const bankCode = clean.substring(4, 7);

  return {
    isValid: true,
    normalizedIban: clean,
    maskedIban: maskIban(clean),
    bankCode,
  };
}
