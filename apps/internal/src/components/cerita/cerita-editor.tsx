"use client";

import { type EditorPhoto, MAX_PHOTO_BATCH } from "-/app/(app)/cerita/action-types";
import {
  deleteStoryPhotoAction,
  finalizeStoryPhotosAction,
  mintPhotoUploadsAction,
  publishStoryAction,
  saveStoryAction,
  setStoryCoverAction,
  withdrawStoryAction,
} from "-/app/(app)/cerita/actions";
import { StoryEditor } from "-/components/cerita/story-editor";
import type { RevalidationReport } from "-/lib/revalidate-public";
import type { PublishResult } from "@sugt/db/queries";
import { STORY_KINDS, type StoryKind, type Stream } from "@sugt/domain";
import { Button } from "@sugt/ui/components/button";
import { Input } from "@sugt/ui/components/input";
import { LinkButton } from "@sugt/ui/components/link-button";
import { cn } from "@sugt/ui/lib/utils";
import { Check, ImageOff, Info, Loader2, Plus, Star, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type Dispatch, type SetStateAction, useRef, useState, useTransition } from "react";

/**
 * A publish attempt that did not publish — the outcomes `publishStory` returns other than success,
 * derived from `PublishResult` so this and the query stay one definition. `needs-cover` is the one
 * gate; `no-such-story` is a stale editor.
 */
type PublishRefusal = Exclude<PublishResult["outcome"], "published">;

/**
 * **The Cerita editor — Variant B, one document column.**
 *
 * The layout the prototype settled on ([#16](https://github.com/mafiefa02/sugt/issues/16)): a
 * publish bar, the body editor, the Stream and Jenis badges, the cover, and the Dokumentasi
 * gallery, stacked in a single `max-w-3xl` column. The prototype held everything in local state
 * with no persistence; this wires the real Server Actions.
 *
 * **Two kinds of state, kept apart.** The prose the Staff member is typing — title, body, Jenis,
 * Stream — is a **local draft** persisted only on an explicit Save. The gallery and publish state —
 * photographs, cover, `published_at` — are **owned by the server**: they change through their own
 * actions and are re-read with `router.refresh()`, never edited in place here. Keeping the two
 * apart is what lets the editor stay mounted (its body is not reset) while the gallery updates.
 *
 * **Publish saves first.** Publishing or withdrawing persists the draft when it is dirty, so the
 * public site never shows a body still sitting only in this browser.
 */
export function CeritaEditor({
  story,
}: {
  story: {
    id: string;
    slug: string;
    schoolName: string;
    title: string;
    body: string;
    kind: StoryKind;
    stream: Stream | null;
    coverPhotoId: string | null;
    publishedAt: Date | null;
    photos: EditorPhoto[];
  };
}) {
  const router = useRouter();

  // The local draft. Seeded once from the server row; the editor owns it until Save.
  const [title, setTitle] = useState(story.title);
  const [body, setBody] = useState(story.body);
  const [kind, setKind] = useState<StoryKind>(story.kind);
  const [stream, setStream] = useState<Stream | null>(story.stream);
  const [dirty, setDirty] = useState(false);

  const [saving, startSaving] = useTransition();
  const [publishing, startPublishing] = useTransition();

  // The result of the last publish attempt and the revalidation it triggered, rendered inline. The
  // `needs-cover` gate lands here, exercising the server path rather than only the disabled button.
  const [publishOutcome, setPublishOutcome] = useState<PublishRefusal | null>(null);
  const [revalidation, setRevalidation] = useState<RevalidationReport | null>(null);

  const cover = story.photos.find((photo) => photo.id === story.coverPhotoId) ?? null;
  const coverMissing = story.photos.length > 0 && cover === null;

  // Wrap a draft setter so every edit also marks the draft dirty and clears any stale publish
  // message. The generic keeps each field's value type: string, StoryKind, or Stream | null.
  function edit<T>(setter: Dispatch<SetStateAction<T>>) {
    return (value: T) => {
      setter(value);
      setDirty(true);
      setPublishOutcome(null);
    };
  }

  function save() {
    startSaving(async () => {
      await saveStoryAction(story.id, { title, body, kind, stream });
      setDirty(false);
    });
  }

  function publishToggle() {
    startPublishing(async () => {
      // Persist the draft first, so a published body is never one that lived only in the browser.
      if (dirty) {
        await saveStoryAction(story.id, { title, body, kind, stream });
        setDirty(false);
      }
      if (story.publishedAt) {
        setRevalidation(await withdrawStoryAction(story.id));
        setPublishOutcome(null);
      } else {
        const { result, revalidation: report } = await publishStoryAction(story.id);
        setPublishOutcome(result.outcome === "published" ? null : result.outcome);
        setRevalidation(report);
      }
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-7">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{story.schoolName}</p>
        </div>
        <LinkButton
          variant="ghost"
          size="sm"
          render={<Link href="/cerita" />}
        >
          Kembali ke daftar
        </LinkButton>
      </div>

      <PublishBar
        publishedAt={story.publishedAt}
        coverMissing={coverMissing}
        busy={publishing}
        dirty={dirty}
        outcome={publishOutcome}
        revalidation={revalidation}
        onToggle={publishToggle}
      />

      <div className="space-y-2">
        <Input
          aria-label="Judul Cerita"
          value={title}
          onChange={(event) => edit(setTitle)(event.target.value)}
          className="text-base font-semibold"
          placeholder="Judul Cerita"
        />
        <StoryEditor
          key={story.id}
          initialBody={story.body}
          onChange={edit(setBody)}
        />
      </div>

      <div className="flex flex-wrap items-end gap-6 rounded-lg border border-border p-3">
        <Pills
          label="Stream"
          value={stream}
          options={[
            { value: "STEM" as const, label: "STEM" },
            { value: "Research" as const, label: "Research" },
            { value: null, label: "Keduanya" },
          ]}
          onSelect={edit(setStream)}
          hint='"Keduanya" menulis NULL. Itu pilihan, bukan kolom yang lupa diisi.'
        />
        <Pills
          label="Jenis"
          value={kind}
          options={STORY_KINDS.map((value) => ({
            value,
            label: value === "field" ? "Cerita lapangan" : "Final Project",
          }))}
          onSelect={edit(setKind)}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground">
          {dirty ? "Ada perubahan belum disimpan" : "Tersimpan"}
        </span>
        <Button
          variant="outline"
          disabled={!dirty || saving}
          onClick={save}
        >
          {saving ? "Menyimpan…" : "Simpan"}
        </Button>
      </div>

      <CoverField
        cover={cover}
        coverMissing={coverMissing}
        storyId={story.id}
        onChanged={() => router.refresh()}
      />

      <Dokumentasi
        storyId={story.id}
        photos={story.photos}
        coverPhotoId={story.coverPhotoId}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}

/** The status badge, the publish/withdraw control, the one gate's message, and revalidation progress. */
function PublishBar({
  publishedAt,
  coverMissing,
  busy,
  dirty,
  outcome,
  revalidation,
  onToggle,
}: {
  publishedAt: Date | null;
  coverMissing: boolean;
  busy: boolean;
  dirty: boolean;
  outcome: PublishRefusal | null;
  revalidation: RevalidationReport | null;
  onToggle: () => void;
}) {
  const published = publishedAt !== null;
  // Publishing a draft is blocked while the cover is missing — the one gate in the product, mirrored
  // here so the control is unavailable rather than offered and refused. Withdrawing is never gated.
  const blocked = !published && coverMissing;

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded-lg border border-border px-2 py-0.5 text-xs text-muted-foreground">
          {published ? `Terbit ${formatWhen(publishedAt)}` : "Draf"}
        </span>
        <Button
          disabled={busy || blocked}
          onClick={onToggle}
        >
          {busy ? <Loader2 className="animate-spin" /> : null}
          {published ? "Turunkan" : "Terbitkan"}
        </Button>
        {dirty ? (
          <span className="text-xs text-muted-foreground">
            Perubahan akan disimpan sebelum {published ? "diturunkan" : "diterbitkan"}.
          </span>
        ) : null}
      </div>

      {blocked ? (
        <p className="text-xs text-destructive">
          Pilih sampul dulu. Ada foto tetapi belum ada yang dijadikan sampul, dan kartu Cerita di
          situs publik tidak boleh tampil tanpa gambar.
        </p>
      ) : null}

      {outcome === "needs-cover" ? (
        <p className="text-xs text-destructive">
          Cerita tidak diterbitkan: ada foto tetapi belum ada sampul. Pilih satu foto sebagai
          sampul, lalu coba lagi.
        </p>
      ) : null}
      {outcome === "no-such-story" ? (
        <p className="text-xs text-destructive">Cerita tidak ditemukan. Muat ulang halaman.</p>
      ) : null}

      {revalidation ? <RevalidationSteps report={revalidation} /> : null}
    </div>
  );
}

/**
 * The revalidation of `@sugt/public`, step by step. Each step renders by its `outcome`, so this is
 * the "says plainly when it failed" surface: a failed step shows a cross and _gagal_ — the public
 * page did not refresh and the old one is still live — while a done step shows a tick.
 */
function RevalidationSteps({ report }: { report: RevalidationReport }) {
  return (
    <div className="space-y-1 border-t border-border pt-2">
      <ol className="space-y-1">
        {report.steps.map((step) => (
          <li
            key={step.target}
            className={cn(
              "flex items-center gap-2 text-xs",
              step.outcome === "failed" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {step.outcome === "ok" ? <Check className="size-3" /> : <X className="size-3" />}
            {step.label}
            {step.outcome === "failed" ? (
              <span className="text-[11px]">— gagal, halaman lama masih tayang</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A row of mutually exclusive pill buttons. `null` is a real option — Stream's "Keduanya". */
function Pills<T>({
  label,
  value,
  options,
  onSelect,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onSelect: (value: T) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div className="flex gap-1">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => onSelect(option.value)}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-xs",
              value === option.value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:bg-muted",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** The cover: its own field, `story.cover_photo_id`, cleared here or by deleting the cover photo. */
function CoverField({
  cover,
  coverMissing,
  storyId,
  onChanged,
}: {
  cover: EditorPhoto | null;
  coverMissing: boolean;
  storyId: string;
  onChanged: () => void;
}) {
  const [busy, startBusy] = useTransition();

  function clear() {
    startBusy(async () => {
      await setStoryCoverAction(storyId, null);
      onChanged();
    });
  }

  return (
    <section
      className={cn("rounded-lg border", coverMissing ? "border-destructive/40" : "border-border")}
    >
      <p className="border-b border-border px-3 py-2 text-xs font-medium">Sampul</p>
      <div className="flex items-center gap-3 p-3">
        <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
          {cover ? (
            // eslint-disable-next-line @next/next/no-img-element -- internal thumbnail, no optimisation needed
            <img
              src={cover.url}
              alt={cover.caption ?? "Sampul"}
              className="h-full w-full object-cover"
            />
          ) : (
            <ImageOff className="size-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {cover ? (
            <>
              <p className="truncate text-sm">{cover.caption || "Tanpa keterangan"}</p>
              <button
                type="button"
                onClick={clear}
                disabled={busy}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              >
                Kosongkan
              </button>
            </>
          ) : (
            <p
              className={cn(
                "text-[11px]",
                coverMissing ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {coverMissing
                ? "Belum dipilih. Kartu Cerita di situs publik akan tampil tanpa gambar."
                : "Unggah foto dulu, lalu pilih satu sebagai sampul."}
            </p>
          )}
        </div>
      </div>
      <p className="flex gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0" />
        Sampul adalah kolomnya sendiri. Menghapus foto yang jadi sampul mengosongkan kolom itu, dan
        tidak pernah memblokir penghapusan.
      </p>
    </section>
  );
}

/**
 * One file the operator has chosen but not yet uploaded: bytes, an editable caption, a preview, and
 * a `localId` that is a monotonic counter — not derived from the file — so removing then re-adding
 * the same file never collides on a React key.
 */
type StagedPhoto = { localId: string; file: File; caption: string; previewUrl: string };

/**
 * The Dokumentasi gallery and its upload. There is no ordering: photographs render in `uploaded_at`
 * order (the server's), captions are set when they are uploaded, and nothing here inserts one into
 * the prose.
 *
 * Upload is two steps so a caption can be typed before the bytes leave: choose files (they stage
 * with a preview), then **Unggah**. Each file's bytes go straight to Storage through a signed URL;
 * one that fails to transfer is reported and the rest still land — a real partial success.
 */
function Dokumentasi({
  storyId,
  photos,
  coverPhotoId,
  onChanged,
}: {
  storyId: string;
  photos: EditorPhoto[];
  coverPhotoId: string | null;
  onChanged: () => void;
}) {
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [uploading, startUploading] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const nextLocalId = useRef(0);

  function chooseFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_PHOTO_BATCH - staged.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    if (picked.length < files.length) {
      setNote(`Maksimal ${MAX_PHOTO_BATCH} foto sekaligus. Sebagian tidak ditambahkan.`);
    }
    setStaged((current) => [
      ...current,
      ...picked.map((file) => ({
        localId: String(nextLocalId.current++),
        file,
        caption: "",
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  }

  function setCaption(localId: string, caption: string) {
    setStaged((current) =>
      current.map((item) => (item.localId === localId ? { ...item, caption } : item)),
    );
  }

  function removeStaged(localId: string) {
    setStaged((current) => {
      const target = current.find((item) => item.localId === localId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.localId !== localId);
    });
  }

  function upload() {
    startUploading(async () => {
      setNote(null);
      const batch = staged;
      const targets = await mintPhotoUploadsAction(storyId, batch.length);

      const landed: { path: string; caption: string | null }[] = [];
      let failedPuts = 0;
      await Promise.all(
        batch.map(async (item, index) => {
          const target = targets[index];
          if (!target) {
            failedPuts += 1;
            return;
          }
          try {
            const response = await fetch(target.signedUrl, {
              method: "PUT",
              headers: { "content-type": item.file.type || "application/octet-stream" },
              body: item.file,
            });
            if (!response.ok) throw new Error(`PUT ${response.status}`);
            landed.push({ path: target.path, caption: item.caption.trim() || null });
          } catch {
            failedPuts += 1;
          }
        }),
      );

      let attached = 0;
      if (landed.length > 0) {
        const result = await finalizeStoryPhotosAction(storyId, landed);
        attached = result.attached;
        failedPuts += result.failed;
      }

      staged.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setStaged([]);
      setNote(
        failedPuts > 0
          ? `${attached} foto terunggah, ${failedPuts} gagal. Coba unggah ulang yang gagal.`
          : `${attached} foto terunggah.`,
      );
      onChanged();
    });
  }

  return (
    <section className="rounded-lg border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-xs font-medium">Dokumentasi — {photos.length} foto</p>
        <div className="flex gap-1">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              chooseFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <Button
            variant="outline"
            size="xs"
            onClick={() => fileInput.current?.click()}
          >
            <Plus data-icon="inline-start" />
            Pilih foto
          </Button>
          {staged.length > 0 ? (
            <Button
              size="xs"
              disabled={uploading}
              onClick={upload}
            >
              {uploading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Upload data-icon="inline-start" />
              )}
              Unggah {staged.length}
            </Button>
          ) : null}
        </div>
      </div>

      {note ? (
        <p className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">{note}</p>
      ) : null}

      {staged.length > 0 ? (
        <div className="space-y-2 border-b border-border bg-muted/30 p-2">
          {staged.map((item) => (
            <div
              key={item.localId}
              className="flex items-center gap-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- local object-URL preview */}
              <img
                src={item.previewUrl}
                alt=""
                className="h-10 w-14 shrink-0 rounded-lg border border-border object-cover"
              />
              <Input
                value={item.caption}
                onChange={(event) => setCaption(item.localId, event.target.value)}
                placeholder="Keterangan"
                className="h-8 min-w-0 flex-1 text-sm"
              />
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Batalkan foto ini"
                disabled={uploading}
                onClick={() => removeStaged(item.localId)}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      {photos.length === 0 && staged.length === 0 ? (
        <p className="p-6 text-center text-xs text-muted-foreground">Belum ada foto.</p>
      ) : (
        photos.map((photo) => (
          <PhotoRow
            key={photo.id}
            photo={photo}
            isCover={photo.id === coverPhotoId}
            storyId={storyId}
            onChanged={onChanged}
          />
        ))
      )}

      <p className="flex gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 size-3 shrink-0" />
        Tidak ada urutan. Foto tampil sesuai waktu unggah, dan tidak pernah disisipkan ke dalam
        teks.
      </p>
    </section>
  );
}

/** One uploaded photograph: thumbnail, its caption, the cover toggle, and delete. */
function PhotoRow({
  photo,
  isCover,
  storyId,
  onChanged,
}: {
  photo: EditorPhoto;
  isCover: boolean;
  storyId: string;
  onChanged: () => void;
}) {
  const [busy, startBusy] = useTransition();

  function toggleCover() {
    startBusy(async () => {
      await setStoryCoverAction(storyId, isCover ? null : photo.id);
      onChanged();
    });
  }

  function remove() {
    startBusy(async () => {
      await deleteStoryPhotoAction(storyId, photo.id);
      onChanged();
    });
  }

  return (
    <div className="flex items-center gap-2 border-b border-border p-2 last:border-0">
      {/* eslint-disable-next-line @next/next/no-img-element -- internal thumbnail, no optimisation needed */}
      <img
        src={photo.url}
        alt={photo.caption ?? ""}
        className="h-10 w-14 shrink-0 rounded-lg border border-border object-cover"
      />
      <p className="min-w-0 flex-1 truncate text-sm">
        {photo.caption || <span className="text-muted-foreground">Tanpa keterangan</span>}
      </p>
      <Button
        variant={isCover ? "default" : "outline"}
        size="xs"
        disabled={busy}
        onClick={toggleCover}
      >
        {isCover ? <Check data-icon="inline-start" /> : <Star data-icon="inline-start" />}
        Sampul
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Hapus foto"
        disabled={busy}
        onClick={remove}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

/**
 * A published timestamp, short and local, as `YYYY-MM-DD HH:MM` (24h) — the ISO date form every
 * other date reads in across the internal app (#166), not the `id-ID` `31 Agu 2026, 09.00` this
 * once produced. Local wall-clock components: server time is fine here — this is an editor, not a
 * public page.
 */
function formatWhen(when: Date | null): string {
  if (!when) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  return `${date} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}
