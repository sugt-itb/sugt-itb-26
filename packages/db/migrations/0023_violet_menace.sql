CREATE TABLE "preparation_card" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"jenis" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preparation_card_title_not_empty" CHECK (length(trim("preparation_card"."title")) > 0),
	CONSTRAINT "preparation_card_jenis_check" CHECK ("preparation_card"."jenis" in ('Teknis', 'Kurikulum', 'LAPI', 'Pimpinan'))
);
--> statement-breakpoint
CREATE TABLE "preparation_checklist_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "preparation_checklist_item_label_not_empty" CHECK (length(trim("preparation_checklist_item"."label")) > 0)
);
--> statement-breakpoint
ALTER TABLE "preparation_checklist_item" ADD CONSTRAINT "preparation_checklist_item_card_id_preparation_card_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."preparation_card"("id") ON DELETE cascade ON UPDATE no action;