CREATE INDEX "group_member_person_id_idx" ON "group_member" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "perjadin_teacher_perjadin_id_idx" ON "perjadin_teacher" USING btree ("perjadin_id");--> statement-breakpoint
CREATE INDEX "transaction_perjadin_id_idx" ON "transaction" USING btree ("perjadin_id");--> statement-breakpoint
CREATE INDEX "transaction_evidence_transaction_id_idx" ON "transaction_evidence" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "session_perjadin_id_idx" ON "session" USING btree ("perjadin_id");--> statement-breakpoint
CREATE INDEX "session_school_id_idx" ON "session" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "story_photo_story_id_idx" ON "story_photo" USING btree ("story_id");--> statement-breakpoint
CREATE INDEX "preparation_checklist_item_card_id_idx" ON "preparation_checklist_item" USING btree ("card_id");