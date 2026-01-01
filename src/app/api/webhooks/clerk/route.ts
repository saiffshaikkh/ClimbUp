import { Webhook } from "svix";
import { headers } from "next/headers";
import { WebhookEvent } from "@clerk/nextjs/server";
import { upsertUser, deleteUser } from "../../../../features/users/db";
import { env } from "../../../../data/env/server";

export async function POST(req: Request) {
  console.log("--- Webhook Request Started ---");

  const SIGNING_SECRET = env.CLERK_WEBHOOK_SIGNING_SECRET;

  if (!SIGNING_SECRET) {
    console.error("Error: CLERK_WEBHOOK_SIGNING_SECRET is missing");
    throw new Error(
      "Error: Please add CLERK_WEBHOOK_SIGNING_SECRET from Clerk Dashboard to .env"
    );
  }

  const wh = new Webhook(SIGNING_SECRET);

  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  console.log("Headers received:", {
    "svix-id": svix_id,
    "svix-timestamp": svix_timestamp,
    "svix-signature": svix_signature ? "***" : "missing",
  });

  if (!svix_id || !svix_timestamp || !svix_signature) {
    console.error("Error: Missing Svix headers");
    return new Response("Error: Missing Svix headers", {
      status: 400,
    });
  }

  const payload = await req.json();
  const body = JSON.stringify(payload);

  let evt: WebhookEvent;
  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
    console.log("Webhook verified successfully. Function:", evt.type);
  } catch (err) {
    console.error("Error: Verification failed:", err);
    return new Response("Error: Verification error", {
      status: 400,
    });
  }

  try {
    switch (evt.type) {
      case "user.created":
      case "user.updated":
        console.log("Processing user.created/updated:", evt.data.id);
        const clerkData = evt.data;
        const email = clerkData.email_addresses.find(
          (e) => e.id === clerkData.primary_email_address_id
        )?.email_address;

        if (email == null) {
          console.error("Error: No primary email found");
          return new Response("No Primary Email Found", { status: 400 });
        }

        await upsertUser({
          id: clerkData.id,
          name: `${clerkData.first_name} ${clerkData.last_name}`,
          email,
          imageUrl: clerkData.image_url,
          createdAt: new Date(clerkData.created_at),
          updatedAt: new Date(clerkData.updated_at),
        });
        console.log("User upserted successfully");
        break;
      case "user.deleted":
        console.log("Processing user.deleted:", evt.data.id);
        if (evt.data.id == null) {
          return new Response("No user ID found", { status: 400 });
        }

        await deleteUser(evt.data.id);
        console.log("User deleted successfully");
        break;
    }
  } catch (dbError) {
    console.error("Database error:", dbError);
    return new Response("Internal Server Error: Database failure", {
      status: 500,
    });
  }

  console.log("--- Webhook Request Finished ---");
  return new Response("Webhook received", { status: 200 });
}
