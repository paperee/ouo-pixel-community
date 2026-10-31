import { strict as assert } from "node:assert";
import { getPagerKeyboardPage } from "./pagination-keyboard.js";

const key = (value, overrides = {}) => ({
  key: value,
  target: { tagName: "BODY", isContentEditable: false },
  ...overrides,
});

assert.equal(getPagerKeyboardPage(key("ArrowLeft"), 2, 3), 1);
assert.equal(getPagerKeyboardPage(key("ArrowRight"), 2, 3), 3);
assert.equal(getPagerKeyboardPage(key("ArrowLeft"), 1, 3), null);
assert.equal(getPagerKeyboardPage(key("ArrowRight"), 3, 3), null);
assert.equal(getPagerKeyboardPage(key("ArrowUp"), 2, 3), null);
assert.equal(getPagerKeyboardPage(key("ArrowLeft", { ctrlKey: true }), 2, 3), null);
assert.equal(getPagerKeyboardPage(key("ArrowRight", { metaKey: true }), 2, 3), null);
assert.equal(getPagerKeyboardPage(key("ArrowLeft", { altKey: true }), 2, 3), null);
assert.equal(getPagerKeyboardPage(key("ArrowRight", { shiftKey: true }), 2, 3), null);
assert.equal(getPagerKeyboardPage(key("ArrowLeft", { repeat: true }), 2, 3), null);
assert.equal(getPagerKeyboardPage(key("ArrowRight"), 2, 3, { enabled: false }), null);
assert.equal(getPagerKeyboardPage(key("ArrowLeft"), 2, 3, { dialogOpen: true }), null);
for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
  assert.equal(getPagerKeyboardPage(key("ArrowLeft", { target: { tagName } }), 2, 3), null);
}
assert.equal(getPagerKeyboardPage(key("ArrowLeft", { target: { tagName: "DIV", isContentEditable: true } }), 2, 3), null);
assert.equal(getPagerKeyboardPage(key("ArrowLeft"), 1, 1), null);

console.log("PAGINATION_KEYBOARD_TEST_OK");
