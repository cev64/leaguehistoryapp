// Stripe → Supabase: keeps plans in step with what's been paid for.
//   - Pro, for one member ($10/month): their own subscription, from the
//     Payment Link the account page opens (client_reference_id is their
//     Supabase user id). Its status is kept on their profile.
//   - League Pass, for a whole league ($20 per member a year): a
//     subscription the league-pass function starts, marked
//     metadata.kind = "league" with the pass's id. Its status, seats and
//     renewal date are kept on the pass.
// Either way the member's plan is then worked out by refresh_plan()
// (supabase/migrations/20261004000000_league_pass.sql): Pro if their own
// subscription is paid, if they're a comp, or if they have a seat on a
// paid-up League Pass. Nothing else writes a plan.
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_…
// then in Stripe ▸ Developers ▸ Webhooks add
//   https://<project>.supabase.co/functions/v1/stripe-webhook
// listening for checkout.session.completed and customer.subscription.*.

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

const isLeague = (meta: Stripe.Metadata | null | undefined) => meta?.kind === "league" && Boolean(meta?.pass_id);
const customerOf = (c: string | Stripe.Customer | Stripe.DeletedCustomer | null) =>
  !c ? null : typeof c === "string" ? c : c.id;
function periodEnd(sub: Stripe.Subscription) {
  const end = (sub as unknown as { current_period_end?: number }).current_period_end
    ?? sub.items?.data?.[0]?.current_period_end;
  return end ? new Date(end * 1000).toISOString() : null;
}
const check = ({ error }: { error: unknown }) => { if (error) throw error; };

// A member's own Pro subscription.
async function applySolo(sub: Stripe.Subscription) {
  const { data, error } = await admin
    .from("profiles")
    .update({ plan_status: sub.status, stripe_subscription_id: sub.id, current_period_end: periodEnd(sub) })
    .eq("stripe_customer_id", customerOf(sub.customer))
    .select("id");
  if (error) throw error;
  for (const row of data ?? []) check(await admin.rpc("refresh_plan", { p_user_id: row.id }));
}

// A League Pass: its status, seats and renewal date, then everyone on it.
async function applyLeague(sub: Stripe.Subscription) {
  const passId = sub.metadata.pass_id;
  check(await admin
    .from("league_passes")
    .update({
      status: sub.status,
      seats: sub.items?.data?.[0]?.quantity ?? undefined,
      stripe_subscription_id: sub.id,
      stripe_customer_id: customerOf(sub.customer),
      current_period_end: periodEnd(sub),
    })
    .eq("id", passId));
  check(await admin.rpc("refresh_pass_plans", { p_pass_id: passId }));
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
        const customer = customerOf(session.customer);
        if (!userId || !customer) break;
        // The buyer's Stripe customer, so their later events find them.
        check(await admin.from("profiles").update({ stripe_customer_id: customer }).eq("id", userId).is("stripe_customer_id", null));
        if (session.subscription) {
          const id = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(id);
          if (isLeague(sub.metadata)) await applyLeague(sub);
          else {
            check(await admin.from("profiles").update({ stripe_customer_id: customer }).eq("id", userId));
            await applySolo(sub);
          }
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        if (isLeague(sub.metadata)) await applyLeague(sub);
        else await applySolo(sub);
        break;
      }
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
