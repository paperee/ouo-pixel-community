export const DRAFTS_PER_PAGE = 4;

export function getDraftPage(drafts, requestedPage) {
  const pages = Math.max(1, Math.ceil(drafts.length / DRAFTS_PER_PAGE));
  const page = Math.min(pages, Math.max(1, Math.trunc(requestedPage) || 1));
  const start = (page - 1) * DRAFTS_PER_PAGE;
  return {
    items: drafts.slice(start, start + DRAFTS_PER_PAGE),
    page,
    pages,
    total: drafts.length,
  };
}
