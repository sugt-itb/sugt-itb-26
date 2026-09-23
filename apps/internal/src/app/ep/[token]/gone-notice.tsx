/**
 * What a dead Perjadin Evaluation link shows — expired, replaced or unknown, all the same. One
 * component so a fresh load and a link that dies while the form is open read the exact same
 * message; the two code paths that reach here must not drift apart. The sibling of
 * `f/[token]/gone-notice.tsx`, its copy adapted from a Session feedback QR to a Perjadin link.
 *
 * No `"use client"`: it holds no state, so it renders in the server page and inside the client
 * form alike.
 */
function GoneNotice() {
  return (
    <div className="text-center">
      <h1 className="font-heading text-lg font-medium">Tautan sudah tidak berlaku</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Tautan evaluasi perjalanan ini sudah kedaluwarsa atau digantikan. Minta tautan yang baru
        kepada penanggung jawab perjalanan.
      </p>
    </div>
  );
}

export { GoneNotice };
