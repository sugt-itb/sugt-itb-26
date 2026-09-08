import type { Role } from "@sugt/domain";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Identity. Better Auth's `user` is a sign-in credential; **`person` is the human**,
 * and every domain foreign key in this schema points at `person.id`.
 *
 * The reason is concrete: a Group is assembled when a Perjadin is planned, and a
 * professor may be named to it months before they first sign in. A domain that
 * FKs into `user` cannot express that.
 */

/**
 * `person` **is** the invite list. There is no separate invite table: a row here is
 * an invitation, and `active = false` is a revocation that preserves every
 * historical reference to that person.
 *
 * `unique (id, role)` looks pointless beside a primary key on `id`. It is not — it
 * is the target of the composite foreign keys elsewhere in this schema, and it is
 * what lets "the PIC is Staff", "only Staff file Session Records" and "only Staff
 * author a Story" be declarative constraints instead of triggers. **Do not drop it.**
 *
 * **A Person is now Staff OR Pimpinan** (#179). T3 (#153) had left `'Staff'` the only role
 * once `session_teacher` was dropped and the `Teaching Team` role retired; `person_role_check`
 * now widens to `role in ('Staff', 'Pimpinan')` to admit a second signed-in, read-only principal.
 * **Only that one CHECK widens.** The composite FKs that remain are the PIC-is-Staff family —
 * `group_member`, `perjadin.pic`, `session.online_pic`, `session_record` and `story` — and each
 * still pins `role = 'Staff'`, so the widened role can never satisfy one: a Pimpinan is kept out of
 * every working position (Group member, PIC, Session-Record filer, Story author) by exactly those
 * untouched composite keys, which is what makes the role record-only (ADR-0025). `class_record`'s
 * composite FK still pins `'Teaching Team'` in the DDL, but that table is now dead (its FK is
 * unsatisfiable, Class Records deferred both modes), so nothing satisfies it.
 *
 * None of these composite keys declares `on update`, so all default to `NO ACTION` —
 * which makes `role` **write-once** once a Person has been used anywhere. A wrong role is
 * corrected by revoking the row and creating a new Person, which is why
 * `person_email_key` is partial (`where active`) — see
 * `docs/adr/0013-people-are-added-in-the-tool-and-their-role-is-write-once.md`.
 */
export const person = pgTable(
  "person",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    // `person_role_check` names exactly the values `ROLES` holds — now `'Staff'` or `'Pimpinan'`
    // (#179: a second signed-in, read-only role; T3/#153 had retired `Teaching Team`). `$type` off
    // it replaces a hand-copied `ROLE_VALUES` array that nothing ever read.
    role: text("role").$type<Role>().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("person_role_check", sql`${t.role} in ('Staff', 'Pimpinan')`),
    /**
     * Case-insensitive, and **partial**: at most one *active* Person per email
     * address, any number of revoked ones.
     *
     * Both halves are load-bearing. Better Auth lowercases the address before the
     * sign-in hooks see it, so the lookup those hooks make is
     * `where lower(email) = $1 and active` — the `lower()` is what makes the first
     * half of that unambiguous, and `where active` is what makes the second half
     * unambiguous. Without the predicate a revoke-and-re-add is impossible, because
     * the revoked row still holds the address.
     */
    uniqueIndex("person_email_key")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.active}`),
    unique("person_id_role_key").on(t.id, t.role),
  ],
);
