import { strict as assert } from "node:assert";
import { DRAFTS_PER_PAGE, getDraftPage } from "./draft-pagination.js";

const drafts = Array.from({ length: 9 }, (_, index) => ({ id: index + 1 }));

assert.equal(DRAFTS_PER_PAGE, 4);
assert.deepEqual(getDraftPage(drafts, 1), {
  items: drafts.slice(0, 4),
  page: 1,
  pages: 3,
  total: 9,
});
assert.deepEqual(getDraftPage(drafts, 2), {
  items: drafts.slice(4, 8),
  page: 2,
  pages: 3,
  total: 9,
});
assert.deepEqual(getDraftPage(drafts, 3), {
  items: drafts.slice(8),
  page: 3,
  pages: 3,
  total: 9,
});
assert.equal(getDraftPage(drafts, 0).page, 1);
assert.equal(getDraftPage(drafts, 99).page, 3);
assert.equal(getDraftPage(drafts.slice(0, 4), 2).page, 1); // deleting the only item on the last page clamps back
assert.deepEqual(getDraftPage(drafts.slice(0, 4), 1).items, drafts.slice(0, 4));
assert.deepEqual(getDraftPage(drafts.slice(0, 5), 2).items, drafts.slice(4, 5));
assert.deepEqual(getDraftPage([], 9), {
  items: [],
  page: 1,
  pages: 1,
  total: 0,
});

console.log("DRAFT_PAGINATION_TEST_OK");
