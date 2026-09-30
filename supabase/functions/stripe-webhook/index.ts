// Stripe → Supabase: keeps profiles.plan in step with the $10/month Pro
// subscription. The only thing in the system allowed to write a plan.
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_…
// then in Stripe ▸ Developers ▸ Webhooks add
//   https://<project>.supabase.co/functions/v1/stripe-webhook
// listening for checkout.session.completed and customer.subscription.*.
//
// The account page opens the Payment Link with client_reference_id set to
// the Supabase user id; that is how a checkout is matched to an account.
// Later subscription events are matched on the Stripe customer id saved then.

import Stripe from "https://esm.sh/stripe@16?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  httpClient: Stripe.createFetchHttpClient(),
});
const crypto = Stripe.createSubtleCryptoProvider();
const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } },
);

// Paid-for, or in Stripe's grace period after a failed renewal.
const PAID = new Set(["active", "trialing", "past_due"]);

async function applySubscription(sub: Stripe.Subscription) {
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end
    ?? sub.items?.data?.[0]?.current_period_end;
  const { error } = await admin
    .from("profiles")
    .update({
      plan: PAID.has(sub.status) ? "pro" : "free",
      plan_status: sub.status,
      stripe_subscription_id: sub.id,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    })
    .eq("stripe_customer_id", customer);
  if (error) throw error;
}

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "",
      undefined,
      crypto,
    );
  } catch (err) {
    return new Response(`bad signature: ${(err as Error).message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
        if (!userId || !customer) break;
        const { error } = await admin
          .from("profiles")
          .update({ stripe_customer_id: customer })
          .eq("id", userId);
        if (error) throw error;
        if (session.subscription) {
          const id = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          await applySubscription(await stripe.subscriptions.retrieve(id));
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await applySubscription(event.data.object as Stripe.Subscription);
        break;
    }
  } catch (err) {
    // A 500 makes Stripe retry the event later.
    console.error(err);
    return new Response("update failed", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "content-type": "application/json" },
  });
});
