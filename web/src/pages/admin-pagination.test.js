import { strict as assert } from "node:assert";
import { ADMIN_ARTWORKS_PER_PAGE, getAdminArtworkPage } from "./admin-pagination.js";

const artworks = Array.from({ length: 9 }, (_, index) => ({ id: index + 1 }));

assert.equal(ADMIN_ARTWORKS_PER_PAGE, 4);
assert.deepEqual(getAdminArtworkPage(artworks, 1), {
  items: artworks.slice(0, 4), page: 1, pages: 3, total: 9,
});
assert.deepEqual(getAdminArtworkPage(artworks, 2), {
  items: artworks.slice(4, 8), page: 2, pages: 3, total: 9,
});
assert.deepEqual(getAdminArtworkPage(artworks, 3), {
  items: artworks.slice(8), page: 3, pages: 3, total: 9,
});
assert.equal(getAdminArtworkPage(artworks, 0).page, 1);
assert.equal(getAdminArtworkPage(artworks, 99).page, 3);
assert.equal(getAdminArtworkPage(artworks.slice(0, 4), 2).page, 1);
assert.deepEqual(getAdminArtworkPage([], 9), {
  items: [], page: 1, pages: 1, total: 0,
});

console.log("ADMIN_PAGINATION_TEST_OK");
