export const ADMIN_ARTWORKS_PER_PAGE = 4;

export function getAdminArtworkPage(artworks, requestedPage) {
  const pages = Math.max(1, Math.ceil(artworks.length / ADMIN_ARTWORKS_PER_PAGE));
  const page = Math.min(pages, Math.max(1, Math.trunc(requestedPage) || 1));
  const start = (page - 1) * ADMIN_ARTWORKS_PER_PAGE;
  return {
    items: artworks.slice(start, start + ADMIN_ARTWORKS_PER_PAGE),
    page,
    pages,
    total: artworks.length,
  };
}
