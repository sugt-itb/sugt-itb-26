-- #292 moves the Jenis category from the Preparation Card down onto each checklist item.
-- drizzle-kit generates a straight `ADD COLUMN "jenis" text NOT NULL`, which aborts on any populated
-- database because existing items have no Jenis yet. Hand-augmented so the steps run in one migration
-- in this order: add the column nullable, backfill each item from its parent card's Jenis, then set
-- NOT NULL and add the four-value CHECK, and only after the backfill drop the card's own `jenis`
-- column and constraint (the backfill reads it, so it must come first). Cards with zero items simply
-- lose their Jenis — nothing to carry — which is expected and acceptable. No-op-safe on an empty or
-- fresh database: the backfill UPDATE touches no rows.
ALTER TABLE "preparation_checklist_item" ADD COLUMN "jenis" text;--> statement-breakpoint
UPDATE "preparation_checklist_item" AS pci
SET "jenis" = pc."jenis"
FROM "preparation_card" pc
WHERE pc."id" = pci."card_id";--> statement-breakpoint
ALTER TABLE "preparation_checklist_item" ALTER COLUMN "jenis" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "preparation_checklist_item" ADD CONSTRAINT "preparation_checklist_item_jenis_check" CHECK ("preparation_checklist_item"."jenis" in ('Teknis', 'Kurikulum', 'LAPI', 'Pimpinan'));--> statement-breakpoint
ALTER TABLE "preparation_card" DROP CONSTRAINT "preparation_card_jenis_check";--> statement-breakpoint
ALTER TABLE "preparation_card" DROP COLUMN "jenis";
