export function getPagerKeyboardPage(event, currentPage, pages, { enabled = true, dialogOpen = false } = {}) {
  if (!enabled || dialogOpen || event?.defaultPrevented || event?.repeat) return null;
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return null;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return null;
  const target = event.target;
  if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return null;

  const lastPage = Math.max(1, Math.trunc(pages) || 1);
  const page = Math.min(lastPage, Math.max(1, Math.trunc(currentPage) || 1));
  const targetPage = page + (event.key === "ArrowLeft" ? -1 : 1);
  return targetPage < 1 || targetPage > lastPage ? null : targetPage;
}
