_.e([["a",()=>a],["b",()=>b],["c",()=>c],["d",()=>d]]);const a = "a"
const b = () => d
let c // Lazy initialization.
function d() {
  return b
}

_.u(c = "c")
