declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      ASSETS: Fetcher;
      SHOP_TIMEZONE: string;
      SHOPIFY_SHOP_DOMAIN: string;
      /** Secret: verifies that webhooks really came from Shopify. */
      SHOPIFY_WEBHOOK_SECRET: string;
      /** Secret: one-time token for creating the first admin login. */
      SETUP_TOKEN?: string;
    }
  }
}

export type Env = Cloudflare.Env;
