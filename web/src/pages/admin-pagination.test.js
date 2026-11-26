import { strict as assert } from "node:assert";
import { ADMIN_ARTWORKS_PER_PAGE, ADMIN_LIST_PER_PAGE, getAdminArtworkPage } from "./admin-pagination.js";

assert.equal(ADMIN_ARTWORKS_PER_PAGE, 12);
assert.equal(ADMIN_LIST_PER_PAGE, 8);

// 服务端分页响应：直接使用服务端算好的 page/pages/total
assert.deepEqual(getAdminArtworkPage({ items: [1, 2], page: 2, pages: 3, total: 30 }, 1), {
  items: [1, 2], page: 2, pages: 3, total: 30,
});
// 服务端页码越界时收敛到最后一页
assert.equal(getAdminArtworkPage({ items: [], page: 99, pages: 3, total: 30 }, 1).page, 3);
// 服务端没回 page 时用请求页兜底，并按 pages 收敛
assert.equal(getAdminArtworkPage({ items: [], pages: 5, total: 50 }, 4).page, 4);
assert.equal(getAdminArtworkPage({ items: [], pages: 5, total: 50 }, 99).page, 5);
assert.equal(getAdminArtworkPage({ items: [], pages: 5, total: 50 }, 0).page, 1);
// pages 缺失时按 total 推算
assert.equal(getAdminArtworkPage({ items: [], total: 30 }, 2).pages, 3);
// 空响应/坏响应兜底
assert.deepEqual(getAdminArtworkPage(null, 1), { items: [], page: 1, pages: 1, total: 0 });
assert.deepEqual(getAdminArtworkPage({}, 3), { items: [], page: 1, pages: 1, total: 0 });

console.log("ADMIN_PAGINATION_TEST_OK");
