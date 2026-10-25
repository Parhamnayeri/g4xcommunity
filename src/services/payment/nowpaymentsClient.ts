/**
 * nowpaymentsClient.ts — کلاینت رسمی ارتباط با API سرویس NOWPayments
 *
 * مراجع رسمی:
 *  - Postman Documentation: https://documenter.getpostman.com/view/7907941/2s93JusNJt
 *  - Official API: https://documenter.nowpayments.io/
 *
 * اصول امنیتی:
 *  ۱. استفاده انحصاری از Payments API (عدم پیاده‌سازی Payouts API).
 *  ۲. آدرس‌های معتبر: Sandbox و Production.
 *  ۳. اعتبارسنجی مقادیر سروری (نه کلاینتی).
 *  ۴. عدم افشای API Key در خروجی‌ها یا لاگ‌ها.
 *  ۵. قابلیت Mock شدن برای اجرای تست‌های واحد ایزوله.
 */

import axios, { AxiosInstance } from 'axios';
import { getNowpaymentsConfig, NowpaymentsPaymentDetails } from './paymentTypes';

export interface CreatePaymentParams {
  priceAmount: number;
  priceCurrency?: string; // default "usd"
  payCurrency: string; // e.g. "btc", "usdtbsc"
  orderId: string;
  orderDescription: string;
  ipnCallbackUrl?: string;
  isFixedRate?: boolean;
  isFeePaidByUser?: boolean;
}

export interface MinAmountResponse {
  currency_from: string;
  currency_to: string;
  min_amount: number;
  fiat_equivalent?: number;
}

export interface EstimatePriceResponse {
  currency_from: string;
  amount_from: number;
  currency_to: string;
  estimated_amount: number;
}

export class NowpaymentsClient {
  private axiosInstance: AxiosInstance;
  private baseUrl: string;
  private apiKey: string;

  constructor(customBaseUrl?: string, customApiKey?: string) {
    const config = getNowpaymentsConfig();
    this.baseUrl = customBaseUrl || config.baseUrl;
    this.apiKey = customApiKey || config.apiKey;

    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      timeout: 15000,
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * ۱. بررسی دسترسی‌پذیری سرویس (API Availability Check)
   * GET /v1/status
   */
  async getStatus(): Promise<{ message: string }> {
    try {
      const res = await this.axiosInstance.get('/status');
      return res.data;
    } catch (err: any) {
      throw this.handleApiError(err, 'getStatus');
    }
  }

  /**
   * ۲. دریافت لیست ارزهای پشتیبانی‌شده
   * GET /v1/currencies?fixed_rate=true
   */
  async getAvailableCurrencies(fixedRate: boolean = true): Promise<string[]> {
    try {
      const res = await this.axiosInstance.get('/currencies', {
        params: { fixed_rate: fixedRate },
      });
      return res.data?.currencies || [];
    } catch (err: any) {
      throw this.handleApiError(err, 'getAvailableCurrencies');
    }
  }

  /**
   * ۳. استعلام حداقل مبلغ مجاز برای پرداخت
   * GET /v1/min-amount
   */
  async getMinimumAmount(
    payCurrency: string,
    currencyFrom: string = 'usd'
  ): Promise<MinAmountResponse> {
    try {
      const res = await this.axiosInstance.get('/min-amount', {
        params: {
          currency_from: currencyFrom.toLowerCase(),
          currency_to: payCurrency.toLowerCase(),
          fiat_equivalent: 'usd',
          is_fixed_rate: true,
          is_fee_paid_by_user: false,
        },
      });
      return res.data;
    } catch (err: any) {
      throw this.handleApiError(err, 'getMinimumAmount');
    }
  }

  /**
   * ۴. برآورد قیمت تبدیل (Estimated Price)
   * GET /v1/estimate
   */
  async getEstimatedPrice(
    amount: number,
    currencyTo: string,
    currencyFrom: string = 'usd'
  ): Promise<EstimatePriceResponse> {
    try {
      const res = await this.axiosInstance.get('/estimate', {
        params: {
          amount,
          currency_from: currencyFrom.toLowerCase(),
          currency_to: currencyTo.toLowerCase(),
        },
      });
      return res.data;
    } catch (err: any) {
      throw this.handleApiError(err, 'getEstimatedPrice');
    }
  }

  /**
   * ۵. ایجاد پرداخت کریپتو (Create Payment)
   * POST /v1/payment
   */
  async createPayment(params: CreatePaymentParams): Promise<NowpaymentsPaymentDetails> {
    const config = getNowpaymentsConfig();
    const payload = {
      price_amount: params.priceAmount,
      price_currency: (params.priceCurrency || 'usd').toLowerCase(),
      pay_currency: params.payCurrency.toLowerCase(),
      ipn_callback_url: params.ipnCallbackUrl || config.ipnCallbackUrl,
      order_id: params.orderId,
      order_description: params.orderDescription,
      is_fixed_rate: params.isFixedRate ?? true,
      is_fee_paid_by_user: params.isFeePaidByUser ?? false,
    };

    try {
      const res = await this.axiosInstance.post('/payment', payload);
      return res.data;
    } catch (err: any) {
      throw this.handleApiError(err, 'createPayment');
    }
  }

  /**
   * ۶. دریافت وضعیت پرداخت از سرور موثق NOWPayments
   * GET /v1/payment/:payment_id
   */
  async getPaymentStatus(paymentId: string | number): Promise<NowpaymentsPaymentDetails> {
    try {
      const res = await this.axiosInstance.get(`/payment/${paymentId}`);
      return res.data;
    } catch (err: any) {
      throw this.handleApiError(err, 'getPaymentStatus');
    }
  }

  private handleApiError(err: any, operation: string): Error {
    if (err.response) {
      const status = err.response.status;
      const data = err.response.data;
      const errorMsg = data?.message || data?.error || (typeof data === 'string' ? data : JSON.stringify(data));
      return new Error(`NOWPAYMENTS_API_ERROR (${operation} - HTTP ${status}): ${errorMsg}`);
    }
    if (err.request) {
      return new Error(`NOWPAYMENTS_NETWORK_ERROR (${operation}): Provider endpoint unreachable or timed out`);
    }
    return new Error(`NOWPAYMENTS_CLIENT_ERROR (${operation}): ${err.message}`);
  }
}

// کلاینت پیش‌فرض سراسری قابل تعویض در تست‌ها
let defaultClientInstance: NowpaymentsClient | null = null;

export function getNowpaymentsClient(): NowpaymentsClient {
  if (!defaultClientInstance) {
    defaultClientInstance = new NowpaymentsClient();
  }
  return defaultClientInstance;
}

export function setCustomNowpaymentsClient(client: NowpaymentsClient | null): void {
  defaultClientInstance = client;
}
