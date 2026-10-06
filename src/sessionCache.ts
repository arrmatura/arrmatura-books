/**
 * Remembers every URL fetched during the page session, so returning to a document
 * already read costs nothing. Shared rather than private to one service because
 * `cml/App.xml` guards `DocsTree` with `If="{!@localStorage.collapsed}"` and `DocsTree`
 * mounts `BookIndexTreeService` — collapsing the sidebar disposes that service, so
 * expanding it would otherwise refetch the whole listing.
 *
 * The entry is the in-flight *promise*, not its value: two clicks in a row on the same
 * document share one request, and a rejected one is dropped before any caller sees the
 * error, so a failure stays retryable.
 *
 * Scope is the page session — one `Map`, emptied by a reload. Deliberately no
 * `sessionStorage`: the kit ships an unpinned `docUrl = "/docs/*"`, so persistence would
 * serve a stale body for the life of a tab, and the reload it would speed up is already
 * served by the CDN and the browser's own disk cache. A reload is the flush — which is
 * also the only recovery from a 200 response that carried the wrong body.
 *
 * Nothing is evicted. A whole book is a few hundred KB of markdown; a size cap is the
 * first thing to add if a much larger corpus ever measures a problem.
 */

const inSession = new Map<string, Promise<unknown>>();

/** Fetches `url` through `load`, or hands back what an earlier call for it already got. */
export function cached<T>(url: string, load: () => Promise<T>): Promise<T> {
  let hit = inSession.get(url) as Promise<T> | undefined;
  if (!hit) {
    hit = load().catch((err) => {
      inSession.delete(url);
      throw err;
    });
    inSession.set(url, hit);
  }
  return hit;
}
