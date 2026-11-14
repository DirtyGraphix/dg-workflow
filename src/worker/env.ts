declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      ASSETS: Fetcher;
      /** Proof images and customer uploads. */
      PROOFS: R2Bucket;
      SHOP_TIMEZONE: string;
      SHOPIFY_SHOP_DOMAIN: string;
      /** This app's own web address, used in emails sent by the hourly job (e.g. https://dg-workflow.dirtygraphix.workers.dev). */
      APP_ORIGIN?: string;
      /** Secret: verifies that webhooks really came from Shopify. */
      SHOPIFY_WEBHOOK_SECRET: string;
      /** Secret: one-time token for creating the first admin login. */
      SETUP_TOKEN?: string;
      /** Secret: Klaviyo private API key with Events write access. Emails wait in the outbox until it's set. */
      KLAVIYO_PRIVATE_KEY?: string;
    }
  }
}

export type Env = Cloudflare.Env;
