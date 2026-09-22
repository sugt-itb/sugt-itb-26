import type { StoryKind, Stream } from "@sugt/domain";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { person } from "./people";
import { school } from "./reference";

/**
 * Stories: the public narrative, authored here by Staff and read by `@sugt/public`. The full
 * argument is in `docs/data-model.md` §Stories and [ADR-0015](../../../docs/adr/0015-story-bodies-are-markdown-and-the-editor-schema-is-the-allowlist.md);
 * the comments here carry only what a reader of the code needs at the point of use.
 */

/**
 * `written_by_role` is pinned to 'Staff' so the composite foreign key into `person (id, role)`
 * makes **publishing is Staff-only** unbreakable, the same way `perjadin.pic_role` does for the
 * PIC — the seventh target of `person`'s `unique (id, role)`.
 *
 * `stream` is nullable **here and nowhere else**: a Story about a whole visit is about both
 * Streams, so "neither" is a real answer rather than a missing one.
 *
 * `cover_photo_id` references `story_photo` while `story_photo.story_id` references back — a
 * cycle. It needs no deferral because it is nullable: the Story is inserted with a null cover,
 * the photographs land, and the cover is set in a second statement. `on delete set null` means
 * deleting the cover photograph clears the field rather than blocking the delete.
 *
 * `published_at` NULL is a draft; there is no status enum. Setting it publishes, clearing it
 * takes the Story down — and each calls the revalidation route on `@sugt/public`.
 */
export const story = pgTable(
  "story",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => school.id),
    // `story_stream_check` and `story_kind_check` name exactly the values `STREAMS` and
    // `STORY_KINDS` hold; `$type<>()` reads them back as those unions. `stream` stays nullable,
    // so it is `Stream | null`.
    stream: text("stream").$type<Stream>(),
    kind: text("kind").$type<StoryKind>().notNull().default("field"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // `AnyPgColumn` breaks the type cycle: `story` references `story_photo`, which references
    // `story` back. The runtime reference is unchanged; the annotation only stops the inference
    // from chasing its own tail.
    coverPhotoId: uuid("cover_photo_id").references((): AnyPgColumn => storyPhoto.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),

    writtenByPersonId: uuid("written_by_person_id").notNull(),
    writtenByRole: text("written_by_role").$type<"Staff">().notNull().default("Staff"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("story_stream_check", sql`${t.stream} in ('STEM', 'Research')`),
    check("story_kind_check", sql`${t.kind} in ('field', 'final_project')`),
    check("story_written_by_role_check", sql`${t.writtenByRole} = 'Staff'`),
    foreignKey({
      name: "story_written_by_staff",
      columns: [t.writtenByPersonId, t.writtenByRole],
      foreignColumns: [person.id, person.role],
    }),
  ],
);

/**
 * A Story's photographs, in the public `public-media` bucket. **Mirrors `transaction_evidence`**
 * column for column — same `storage_path unique`, `content_type`/`byte_size`, uploader and
 * timestamp — so there is one upload pattern to build and one to learn. The only column it adds
 * is `caption`. Keys are `story/{story_id}/{uuid}`.
 *
 * There is no `position`: the gallery orders by `uploaded_at` tie-broken by `id`, and the cover
 * is `story.cover_photo_id`, not "whichever is first". `uploaded_by_person_id` references
 * `person` alone, not the pair — uploading is not role-gated; the Story it hangs off carries the
 * Staff constraint.
 */
export const storyPhoto = pgTable(
  "story_photo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references((): AnyPgColumn => story.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull().unique(),
    contentType: text("content_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    caption: text("caption"),
    uploadedByPersonId: uuid("uploaded_by_person_id")
      .notNull()
      .references(() => person.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // A Story's gallery loads its photographs by `story_id` — the editor read (`cerita.ts`) and the
  // public aggregate (`aggregates.ts`) — and the FK is not auto-indexed (#270).
  (t) => [index("story_photo_story_id_idx").on(t.storyId)],
);
