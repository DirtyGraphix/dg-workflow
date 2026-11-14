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
      /** Cloudflare Email Service: sends customer emails (proofs, reminders, replies). */
      EMAIL: SendEmail;
    }
  }
}

export type Env = Cloudflare.Env;
