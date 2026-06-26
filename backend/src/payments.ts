/**
 * Stripe payments — one-time "Lifetime Premium" purchase (no subscription,
 * no auto-renewal). Uses Stripe's REST API directly; no SDK dependency.
 *
 * Required env:
 *   STRIPE_SECRET_KEY      sk_live_... / sk_test_...
 *   STRIPE_WEBHOOK_SECRET  whsec_...   (from the webhook endpoint you create)
 *   STRIPE_PRICE_ID        price_...   (one-time price, e.g. £24.99)
 *   APP_URL                https://yourdomain.app (for redirect URLs)
 *
 * Stripe dashboard setup (5 min):
 *   1. Product "muraja'ah Lifetime" → one-time price → copy price_...
 *   2. Developers → Webhooks → add endpoint {APP_URL}/api/billing/webhook
 *      listening to checkout.session.completed → copy whsec_...
 */
import crypto from 'crypto';
import type { FastifyInstance } from 'fastify';

const STRIPE_API = 'https://api.stripe.com/v1';

function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}

async function stripePost(path: string, params: Record<string, string>) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `Stripe ${res.status}`);
  return json;
}

/** Verify a Stripe-Signature header against the raw payload. */
function verifyStripeSignature(payload: Buffer, header: string, secret: string): boolean {
  const parts = Object.fromEntries(
    header.split(',').map(kv => kv.split('=') as [string, string]),
  );
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  // Reject events older than 5 minutes (replay protection)
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${payload.toString('utf8')}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Register billing routes. `db` is the better-sqlite3 handle returned by
 * initDb. If your users table column differs from `tier`, adjust SET_TIER.
 */
export function registerBillingRoutes(app: FastifyInstance, db: any) {
  // Column is_premium INTEGER already defined in initDb schema.
  const SET_TIER = db.prepare('UPDATE users SET is_premium = 1 WHERE user_id = ?');
  const GET_TIER = db.prepare('SELECT is_premium FROM users WHERE user_id = ?');

  // Current tier (frontend uses this to hide Upgrade).
  // Header-auth variant (no id in URL) + legacy path variant.
  const tierHandler = async (req: any, reply: any) => {
    const auth = req.headers['authorization'];
    const userId = (typeof auth === 'string' && auth.startsWith('Bearer '))
      ? auth.slice(7).trim()
      : (req.params?.userId as string | undefined);
    if (!userId) return reply.status(400).send({ error: 'user_id required' });
    const row = GET_TIER.get(userId) as { is_premium?: number } | undefined;
    const tier = row?.is_premium === 1 ? 'premium' : 'free';
    return reply.send({ tier, billing: stripeConfigured() });
  };
  app.get('/api/me/tier', tierHandler);
  app.get('/api/me/:userId', tierHandler);

  // POST /api/billing/checkout — create a Stripe Checkout session
  app.post('/api/billing/checkout', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    if (!stripeConfigured())
      return reply.status(503).send({ error: 'BILLING_DISABLED' });
    const { user_id } = req.body as { user_id?: string };
    if (!user_id || user_id.length > 200)
      return reply.status(400).send({ error: 'user_id required' });

    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    const session = await stripePost('/checkout/sessions', {
      mode: 'payment', // one-time — no subscription, no auto-renewal
      'line_items[0][price]': process.env.STRIPE_PRICE_ID!,
      'line_items[0][quantity]': '1',
      client_reference_id: user_id,
      success_url: `${appUrl}/?upgrade=success`,
      cancel_url: `${appUrl}/?upgrade=cancelled`,
    });
    return reply.send({ url: session.url });
  });

  // POST /api/billing/webhook — Stripe calls this; needs the RAW body.
  // Encapsulated plugin scope so the buffer parser applies only here.
  app.register(async (scope) => {
    scope.addContentTypeParser('application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => done(null, body),
    );
    scope.post('/api/billing/webhook', async (req, reply) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      const sig = req.headers['stripe-signature'];
      const raw = req.body as Buffer;
      if (!secret || typeof sig !== 'string' || !Buffer.isBuffer(raw))
        return reply.status(400).send({ error: 'bad request' });
      if (!verifyStripeSignature(raw, sig, secret))
        return reply.status(400).send({ error: 'invalid signature' });

      const event = JSON.parse(raw.toString('utf8'));
      if (event.type === 'checkout.session.completed') {
        const session = event.data?.object;
        const userId = session?.client_reference_id;
        if (userId && session?.payment_status === 'paid') {
          SET_TIER.run(userId);
          app.log?.info?.(`premium granted: ${userId}`);
        }
      }
      return reply.send({ received: true });
    });
  });
}
