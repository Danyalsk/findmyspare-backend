CREATE TYPE "public"."user_role" AS ENUM('buyer', 'supplier', 'admin', 'super_admin');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('not_submitted', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('active', 'paused', 'out_of_stock', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('placed', 'confirmed', 'shipped', 'in_transit', 'delivered', 'completed', 'disputed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."escrow_status" AS ENUM('held', 'released', 'refund_initiated', 'refund_completed');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'under_review', 'return_approved', 'return_rejected', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."issue_type" AS ENUM('wrong_part', 'damaged', 'not_as_described', 'missing_parts', 'not_delivered', 'other');--> statement-breakpoint
CREATE TYPE "public"."inquiry_status" AS ENUM('pending', 'responded', 'closed');--> statement-breakpoint
CREATE TYPE "public"."bid_status" AS ENUM('pending', 'accepted', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."banner_status" AS ENUM('active', 'draft');--> statement-breakpoint
CREATE TYPE "public"."admin_action" AS ENUM('supplier_approve', 'supplier_reject', 'supplier_request_info', 'user_ban', 'user_unban', 'user_delete', 'user_impersonate', 'message_hide', 'inquiry_hide', 'product_hide', 'flag_action', 'config_update', 'banner_create', 'banner_update', 'banner_delete', 'rejection_reason_create', 'rejection_reason_update', 'rejection_reason_delete');--> statement-breakpoint
CREATE TYPE "public"."flag_content_type" AS ENUM('message', 'inquiry', 'bid', 'product', 'user');--> statement-breakpoint
CREATE TYPE "public"."flag_status" AS ENUM('open', 'reviewed', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TABLE "email_verification_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "login_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" varchar(255) NOT NULL,
	"code_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_login_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "magic_login_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip_address" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255),
	"name" varchar(255),
	"phone" varchar(20),
	"password_hash" text,
	"role" "user_role" DEFAULT 'buyer' NOT NULL,
	"image" text,
	"business_name" varchar(255),
	"business_type" varchar(100),
	"specialization" varchar(255),
	"tax_id" varchar(50),
	"verification_status" "verification_status" DEFAULT 'not_submitted' NOT NULL,
	"gst_number" varchar(20),
	"pan_number" varchar(20),
	"gst_certificate_url" text,
	"gst_verification" jsonb,
	"business_address" jsonb,
	"rejection_reason" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"profile_completed" boolean DEFAULT false NOT NULL,
	"city" varchar(100),
	"pincode" varchar(10),
	"is_active" boolean DEFAULT true NOT NULL,
	"ban_reason" text,
	"ban_expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"last_login_ip" varchar(64),
	"totp_secret" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"name" varchar(500) NOT NULL,
	"description" text,
	"part_number" varchar(100),
	"category" varchar(100),
	"price" numeric(12, 2) NOT NULL,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb,
	"specifications" jsonb DEFAULT '{}'::jsonb,
	"compatible_vehicles" jsonb DEFAULT '[]'::jsonb,
	"warranty_info" text,
	"status" "product_status" DEFAULT 'active' NOT NULL,
	"view_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "order_status" DEFAULT 'placed' NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"shipping_address_id" uuid,
	"tracking_number" varchar(100),
	"courier_service" varchar(100),
	"estimated_delivery" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"auto_close_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" varchar(50) DEFAULT 'Home',
	"line1" varchar(255) NOT NULL,
	"line2" varchar(255),
	"city" varchar(100) NOT NULL,
	"state" varchar(100) NOT NULL,
	"postal_code" varchar(20) NOT NULL,
	"country" varchar(100) DEFAULT 'India' NOT NULL,
	"phone" varchar(20),
	"is_default" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "escrow_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" "escrow_status" DEFAULT 'held' NOT NULL,
	"held_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	CONSTRAINT "escrow_transactions_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"raised_by_id" uuid NOT NULL,
	"issue_type" "issue_type" NOT NULL,
	"description" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb,
	"supplier_response" text,
	"supplier_evidence" jsonb DEFAULT '[]'::jsonb,
	"return_tracking_number" varchar(100),
	"return_confirmed_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"part_name" varchar(255) NOT NULL,
	"make" varchar(100) NOT NULL,
	"model" varchar(100) NOT NULL,
	"year" varchar(10) NOT NULL,
	"description" text,
	"image_url" text,
	"status" "inquiry_status" DEFAULT 'pending' NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inquiry_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"condition" varchar(50) DEFAULT 'oem' NOT NULL,
	"warranty_months" integer DEFAULT 0 NOT NULL,
	"eta_days" integer DEFAULT 3 NOT NULL,
	"notes" text,
	"status" "bid_status" DEFAULT 'pending' NOT NULL,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" text NOT NULL,
	"user_agent" varchar(512),
	"ip_address" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"subtitle" varchar(500),
	"image_url" text,
	"cta_label" varchar(100),
	"cta_href" varchar(500),
	"status" "banner_status" DEFAULT 'draft' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"receiver_id" uuid NOT NULL,
	"content" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" "admin_action" NOT NULL,
	"target_type" varchar(64) NOT NULL,
	"target_id" varchar(64),
	"metadata" jsonb,
	"ip_address" varchar(64),
	"user_agent" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flagged_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_id" uuid,
	"content_type" "flag_content_type" NOT NULL,
	"content_id" varchar(64) NOT NULL,
	"reason" text NOT NULL,
	"status" "flag_status" DEFAULT 'open' NOT NULL,
	"reviewer_id" uuid,
	"reviewed_at" timestamp with time zone,
	"action_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"maintenance_mode" boolean DEFAULT false NOT NULL,
	"waitlist_only" boolean DEFAULT false NOT NULL,
	"signups_open" boolean DEFAULT true NOT NULL,
	"banner_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "rejection_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rejection_reasons_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "magic_login_tokens" ADD CONSTRAINT "magic_login_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_users_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_supplier_id_users_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_address_id_addresses_id_fk" FOREIGN KEY ("shipping_address_id") REFERENCES "public"."addresses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_transactions" ADD CONSTRAINT "escrow_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_id_users_id_fk" FOREIGN KEY ("raised_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inquiries" ADD CONSTRAINT "inquiries_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_inquiry_id_inquiries_id_fk" FOREIGN KEY ("inquiry_id") REFERENCES "public"."inquiries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_supplier_id_users_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_receiver_id_users_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flagged_content" ADD CONSTRAINT "flagged_content_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flagged_content" ADD CONSTRAINT "flagged_content_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_config" ADD CONSTRAINT "platform_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_otps_identifier_idx" ON "login_otps" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_id_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_token_idx" ON "auth_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "products_supplier_idx" ON "products" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_buyer_idx" ON "orders" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "orders_supplier_idx" ON "orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "inquiries_buyer_idx" ON "inquiries" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "inquiries_active_idx" ON "inquiries" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "bids_inquiry_idx" ON "bids" USING btree ("inquiry_id");--> statement-breakpoint
CREATE INDEX "bids_supplier_idx" ON "bids" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_refresh_token_hash_idx" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "messages_sender_idx" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "messages_receiver_idx" ON "messages" USING btree ("receiver_id");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "messages" USING btree ("sender_id","receiver_id");--> statement-breakpoint
CREATE INDEX "admin_actions_actor_idx" ON "admin_actions" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "admin_actions_target_idx" ON "admin_actions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "admin_actions_created_idx" ON "admin_actions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "flagged_content_status_idx" ON "flagged_content" USING btree ("status");--> statement-breakpoint
CREATE INDEX "flagged_content_content_idx" ON "flagged_content" USING btree ("content_type","content_id");