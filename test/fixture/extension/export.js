export * as ns1 from "../export/abc.js"
export { a, b as c }, * as ns2 from "../export/abc.js"
export def1 from "../export/abc.js"
export def2, { b, c as d } from "../export/abc.js"
export def3, * as ns3 from "../export/abc.js"
export * as ns4, * as ns5, { c as e }, def4, def5 from "../export/abc.js"
