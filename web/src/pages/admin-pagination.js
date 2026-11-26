// 管理后台列表分页：页码由服务端计算（LIMIT/OFFSET），这里只做响应规范化与兜底
export const ADMIN_ARTWORKS_PER_PAGE = 12;
// 作品管理 / 用户管理 / 操作日志每页条数（用户与日志由服务端固定为 8，这里主要给作品管理传 limit 用）
export const ADMIN_LIST_PER_PAGE = 8;

export function getAdminArtworkPage(data, requestedPage) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const total = Math.max(0, Number(data?.total) || 0);
  const pages = Math.max(1, Number(data?.pages) || Math.ceil(total / ADMIN_ARTWORKS_PER_PAGE) || 1);
  const fallback = Math.max(1, Math.trunc(requestedPage) || 1);
  const page = Math.min(pages, Math.max(1, Number(data?.page) || fallback));
  return { items, page, pages, total };
}
