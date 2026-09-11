/**
 * The whole schema. Split by the same areas as `docs/data-model.md`, which is the
 * document this file is a translation of — read that for the reasoning; the comments
 * here carry only what a reader of the code needs at the point of use.
 *
 * Not everything lives here. Two pieces of DDL are hand-written migrations because
 * drizzle-kit cannot express them:
 *
 *   - the DEFERRABLE self-referential foreign key putting the PIC inside their own
 *     Group (Drizzle has no `deferrable` on foreign keys, only on transactions), and
 *   - the **foreign key** from `better_auth.user.person_id` to `public.person`, which
 *     drizzle-kit will not write because it crosses Postgres schemas. The column
 *     itself is declared here with everything else.
 *
 * Both are in `migrations/`, and drizzle-kit leaves them alone because they are not
 * in its snapshot.
 *
 * ## These files may import `@sugt/domain`, for types only
 *
 * Twelve `text` columns carry a CHECK naming a fixed set that `@sugt/domain` already
 * declares. Each one carries `$type<>()` off that declaration, so a reader of a Session
 * gets `SessionMode` rather than `string` and no caller has to assert the difference.
 * `packages/db` already depends on the package and `src/queries/` imports it freely, so
 * the arrow is one that exists — this only extends it to the layer under the queries.
 *
 * **Five more carry a single literal, not a set.** `session.online_pic_role`,
 * `perjadin.pic_role`, `story.written_by_role` and the two `filed_by_role` columns are each
 * CHECKed against **one** value — `'Staff'`, or `'Teaching Team'` on the now-dead
 * `class_record.filed_by_role` — so each reads back as
 * that literal via `$type<"Staff">()` rather than `string`, the guarantee the composite
 * foreign key into `person (id, role)` rests on. These need no `@sugt/domain` import: a single
 * value has no name in the vocabulary, so it is written out here exactly as the CHECK spells
 * it. As with the set columns, `$type<>()` comes before `.default()` so the default is checked
 * against it too.
 *
 * **The import is `import type`, and value imports stay out of these files.** Building a
 * `check()` out of `SESSION_MODES` would compose a different constraint string from the
 * literal one the snapshot holds, and drizzle-kit would emit DDL to reconcile the two.
 * The CHECK lists therefore stay written out, character for character, exactly as
 * `docs/data-model.md` describes them — the drift between a fixed set and the constraint
 * that pins it is meant to be visible by reading the two side by side.
 */
export * from "./reference";
export * from "./people";
export * from "./auth";
export * from "./travel";
export * from "./delivery";
export * from "./evaluations";
export * from "./stories";
export * from "./monitoring";
