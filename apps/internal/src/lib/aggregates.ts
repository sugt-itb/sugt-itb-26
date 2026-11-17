import { presentsBearer } from "-/lib/bearer";
import { requireEnv } from "-/lib/env";
import { publicUrlFor } from "-/lib/story-photo-url";
import type { ServiceCaller } from "@sugt/db/queries";
import type { DeliveryData, ScopeData, StoryDetailData, StoryListItem } from "@sugt/db/queries";

/**
 * **The producer half of the aggregates contract.** `@sugt/db` returns the data; this turns it into
 * the payload that goes over the wire — storage paths become full public URLs, and each payload is
 * stamped with its `version`. The reason both live here and not in `@sugt/db`: a URL needs
 * `SUPABASE_URL` and a version is a fact about the two apps' wire contract, neither of which is the
 * database's concern (`docs/adr/0008-…`).
 *
 * **The secret is read at call time, never at module scope.** A `const` at the top of a route file
 * is evaluated during `next build`, where the variable need not be set, and would fail the build.
 * `publicUrlFor` already reads `SUPABASE_URL` this way; `authorizeServiceCaller` reads
 * `AGGREGATES_SECRET` the same way.
 */

/**
 * **The version each payload carries, and the one rule for changing it.** Bump a payload's version
 * only when a field is **removed or retyped** — a change that makes an older `@sugt/public` read a
 * value that is no longer there or no longer the shape it expects. **Adding a field does not bump
 * it**: an older reader ignores what it does not know. The two apps deploy independently, so this is
 * the mechanism that lets `@sugt/public` refuse a payload it cannot read rather than render half of
 * one.
 *
 * These are **not** in `@sugt/domain`: both apps import it, so a shared constant would make the
 * check vacuous. The point is that the two sides can hold different numbers after one deploys first.
 */
export const SCOPE_VERSION = 1;
export const DELIVERY_VERSION = 1;
export const STORIES_VERSION = 1;
export const STORY_VERSION = 1;

export type ScopePayload = { version: number } & ScopeData;
export type DeliveryPayload = { version: number } & DeliveryData;

/** A Stories-list row as it travels: the cover is a full public URL, or `null`. */
export type StoryListItemPayload = Omit<StoryListItem, "coverPhotoPath"> & {
  coverUrl: string | null;
};
export type StoriesPayload = { version: number; stories: StoryListItemPayload[] };

/** A gallery photograph as it travels: a full public URL and its caption. */
export type StoryGalleryPhotoPayload = { url: string; caption: string | null };
export type StoryPayload = {
  version: number;
} & Omit<StoryDetailData, "coverPhotoPath" | "gallery"> & {
    coverUrl: string | null;
    gallery: StoryGalleryPhotoPayload[];
  };

/**
 * Who is calling, from the `Authorization: Bearer …` header — a `ServiceCaller` when the token is
 * exactly `AGGREGATES_SECRET` (`presentsBearer`, constant-time), `null` otherwise. `null` is the
 * route's 401, and a 401 is what a browser with no token gets, which is why these routes are never
 * browser-reachable.
 */
export function authorizeServiceCaller(request: Request): ServiceCaller | null {
  return presentsBearer(request, requireEnv("AGGREGATES_SECRET")) ? { kind: "service" } : null;
}

/** Stamp the scope data with its version. No URLs and no derived counts — the reader derives those. */
export function toScopePayload(data: ScopeData): ScopePayload {
  return { version: SCOPE_VERSION, ...data };
}

/** Stamp the delivery data with its version. */
export function toDeliveryPayload(data: DeliveryData): DeliveryPayload {
  return { version: DELIVERY_VERSION, ...data };
}

/** Turn each Story's cover storage path into a full public URL, and stamp the list's version. */
export function toStoriesPayload(items: StoryListItem[]): StoriesPayload {
  return {
    version: STORIES_VERSION,
    stories: items.map(({ coverPhotoPath, ...item }) => ({
      ...item,
      coverUrl: coverPhotoPath === null ? null : publicUrlFor(coverPhotoPath),
    })),
  };
}

/**
 * Turn a Story's cover and every gallery photograph into full public URLs, and stamp the version.
 * A signed URL would expire inside a payload the public site keeps until its next deploy, so these
 * are the token-free public-bucket URLs `publicUrlFor` builds.
 */
export function toStoryPayload(data: StoryDetailData): StoryPayload {
  const { coverPhotoPath, gallery, ...detail } = data;
  return {
    version: STORY_VERSION,
    ...detail,
    coverUrl: coverPhotoPath === null ? null : publicUrlFor(coverPhotoPath),
    gallery: gallery.map((photo) => ({
      url: publicUrlFor(photo.storagePath),
      caption: photo.caption,
    })),
  };
}
