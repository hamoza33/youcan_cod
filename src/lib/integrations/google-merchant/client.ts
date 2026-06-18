import { GoogleAuth } from 'google-auth-library';
import { LogSource } from '@prisma/client';
import { requestJson } from '@/lib/http/client';
import { getConfig } from '@/lib/settings/config';

export type MerchantPrice = {
  amountMicros: string;
  currencyCode: string;
};

export type MerchantProductInput = {
  offerId: string;
  contentLanguage: string;
  feedLabel: string;
  productAttributes: {
    title: string;
    description: string;
    link: string;
    imageLink: string;
    additionalImageLinks?: string[];
    availability: 'IN_STOCK' | 'OUT_OF_STOCK';
    price: MerchantPrice;
    condition: 'NEW';
    googleProductCategory?: string;
    customLabel0?: string;
    customLabel1?: string;
    shipping?: Array<{ country: string; service?: string; price?: MerchantPrice }>;
  };
};

export type MerchantProductResponse = {
  name?: string;
  product?: string;
  offerId?: string;
  productStatus?: unknown;
  destinationStatuses?: unknown;
  [key: string]: unknown;
};

export class GoogleMerchantClient {
  private readonly accountId?: string;
  private readonly dataSourceId?: string;
  private readonly auth: GoogleAuth;

  private constructor(config: { accountId?: string; dataSourceId?: string; serviceAccountJson?: string; applicationCredentials?: string }) {
    this.accountId = config.accountId;
    this.dataSourceId = config.dataSourceId;
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/content'],
      keyFilename: config.applicationCredentials || undefined,
      credentials: config.serviceAccountJson ? JSON.parse(config.serviceAccountJson) : undefined,
    });
  }

  static async create() {
    const env = await getConfig();
    return new GoogleMerchantClient({
      accountId: env.GOOGLE_MERCHANT_ACCOUNT_ID,
      dataSourceId: env.GOOGLE_MERCHANT_DATA_SOURCE_ID,
      serviceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON,
      applicationCredentials: env.GOOGLE_APPLICATION_CREDENTIALS,
    });
  }

  async insertProduct(input: MerchantProductInput) {
    const { accountId, dataSourceId } = this.requireIds();
    const token = await this.getAccessToken();
    const url = `https://merchantapi.googleapis.com/products/v1/accounts/${accountId}/productInputs:insert?dataSource=accounts/${accountId}/dataSources/${dataSourceId}`;
    return requestJson<MerchantProductResponse>(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
      source: LogSource.GMC,
    });
  }

  async getProductStatus(productId: string) {
    const { accountId } = this.requireIds();
    const token = await this.getAccessToken();
    const encodedProductId = encodeURIComponent(productId);
    const url = `https://merchantapi.googleapis.com/products/v1/accounts/${accountId}/products/${encodedProductId}`;
    return requestJson<MerchantProductResponse>(url, {
      headers: { Authorization: `Bearer ${token}` },
      source: LogSource.GMC,
    });
  }

  buildProductId(input: { contentLanguage: string; feedLabel: string; offerId: string }) {
    return `${input.contentLanguage}~${input.feedLabel}~${input.offerId}`;
  }

  private requireIds() {
    if (!this.accountId || !this.dataSourceId) {
      throw new Error('GOOGLE_MERCHANT_ACCOUNT_ID and GOOGLE_MERCHANT_DATA_SOURCE_ID are required for Google Merchant Center sync.');
    }
    return { accountId: this.accountId, dataSourceId: this.dataSourceId };
  }

  private async getAccessToken() {
    const client = await this.auth.getClient();
    const token = await client.getAccessToken();
    if (!token.token) throw new Error('Could not obtain Google Merchant API access token.');
    return token.token;
  }
}

export function priceToMicros(amount: number) {
  return String(Math.round(amount * 1_000_000));
}
