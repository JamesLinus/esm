import assert from "assert"
import { add, reset, value } from "../fixture/cjs/bridge.js"
import fdef, * as fns from "../fixture/cjs/exports-function.js"
import ndef, * as nns from "../fixture/cjs/exports-null.js"
import odef, { a, b, c } from "../fixture/cjs/exports-object.js"

export function check() {
  assert.strictEqual(typeof fdef, "function")
  assert.strictEqual(fdef(), "ok")
  assert.strictEqual(fns.default, fdef)

  assert.strictEqual(ndef, null)
  assert.strictEqual(nns.default, ndef)

  assert.deepEqual(odef, { a: 1, b: 2, c: 3 })
  assert.deepEqual({ a, b, c }, odef)

  odef.c = 4
  module.runSetters.call({ exports: odef })
  assert.strictEqual(c, 4)

  reset()
  assert.strictEqual(value, 0)
  add(10)

  assert.strictEqual(value, 10)
  assert.strictEqual(reset(), 0)
  assert.strictEqual(value, 0)
}