import MagicString from "./magic-string.js"
import OrderedMap from "./ordered-map.js"
import Parser from "./parser.js"
import Visitor from "./visitor.js"

const codeOfCR = "\r".charCodeAt(0)

class ImportExportVisitor extends Visitor {
  finalizeHoisting() {
    if (this.bodyInfo === null) {
      return
    }

    const codeToInsert =
      this.bodyInfo.hoistedPrefixString +
      toModuleExport(this, this.bodyInfo.hoistedExportsMap) +
      this.bodyInfo.hoistedExportsString +
      this.bodyInfo.hoistedImportsString

    this.magicString.prependRight(this.bodyInfo.insertCharIndex, codeToInsert)

    // Just in case we call finalizeHoisting again, don't hoist anything.
    this.bodyInfo = null
  }

  reset(rootPath, code, options) {
    this.addedDynamicImport = false
    this.addedImportExport = false
    this.bodyInfo = null
    this.code = code
    this.exportedLocalNames = Object.create(null)
    this.generateVarDeclarations = options.generateVarDeclarations
    this.importedLocalNames = Object.create(null)
    this.madeChanges = false
    this.magicString = new MagicString(code)
    this.runtimeAlias = options.runtimeAlias
  }

  visitCallExpression(path) {
    const node = path.getValue()
    const callee = node.callee

    if (callee.type === "Import") {
      this.addedDynamicImport = true
      overwrite(this, callee.start, callee.end, this.runtimeAlias + ".i")
    }

    this.visitChildren(path)
  }

  visitImportDeclaration(path) {
    this.addedImportExport = true

    let i = -1
    const decl = path.getValue()
    const specifiers = decl.specifiers
    const specifierMap = computeSpecifierMap(specifiers)
    const lastIndex = specifiers.length - 1

    let hoistedCode = specifiers.length
      ? (this.generateVarDeclarations ? "var " : "let ")
      : ""

    for (const specifier of specifiers) {
      const identifier = specifier.local.name
      hoistedCode +=
        identifier +
        (++i === lastIndex ? ";" : ",")
    }

    hoistedCode += toModuleImport(
      this,
      getSourceString(this, decl),
      specifierMap
    )

    hoistImports(this, path, hoistedCode)
    addImportedLocalNames(this, specifierMap)
  }

  visitExportAllDeclaration(path) {
    this.addedImportExport = true

    const decl = path.getValue()
    const hoistedCode = pad(
      this,
      this.runtimeAlias + ".w(" + getSourceString(this, decl),
      decl.start,
      decl.source.start
    ) + pad(
      this,
      ',[["*",' + this.runtimeAlias + ".n()]]);",
      decl.source.end,
      decl.end
    )

    hoistExports(this, path, hoistedCode)
  }

  visitExportDefaultDeclaration(path) {
    this.addedImportExport = true

    const decl = path.getValue()
    const dd = decl.declaration

    if (dd.id && (dd.type === "FunctionDeclaration" ||
                  dd.type === "ClassDeclaration")) {
      // If the exported default value is a function or class declaration,
      // it's important that the declaration be visible to the rest of the
      // code in the exporting module, so we must avoid compiling it to a
      // named function or class expression.
      hoistExports(this, path,
        addToSpecifierMap(new OrderedMap, "default", dd.id.name),
        "declaration"
      )

    } else {
      // Otherwise, since the exported value is an expression, we use the
      // special `runtime.default(value)` form.
      path.call(this, "visitWithoutReset", "declaration")

      let prefix = this.runtimeAlias + ".d("
      let suffix = ");"

      if (dd.type === "SequenceExpression") {
        // If the exported expression is a comma-separated sequence
        // expression, `this.code.slice(dd.start, dd.end)` may not include
        // the vital parentheses, so we should wrap the expression with
        // parentheses to make absolutely sure it is treated as a single
        // argument to `runtime.default()`, rather than as
        // multiple arguments.
        prefix += "("
        suffix = ")" + suffix
      }

      overwrite(this, decl.start, dd.start, prefix)
      overwrite(this, dd.end, decl.end, suffix)
    }
  }

  visitExportNamedDeclaration(path) {
    this.addedImportExport = true

    const decl = path.getValue()
    const dd = decl.declaration

    if (dd) {
      const specifierMap = new OrderedMap
      const type = dd.type

      if (dd.id && (type === "ClassDeclaration" ||
                    type === "FunctionDeclaration")) {
        addNameToMap(specifierMap, dd.id.name)
      } else if (type === "VariableDeclaration") {
        const varDecls = dd.declarations

        for (const varDecl of varDecls) {
          const names = Parser.getNamesFromPattern(varDecl.id)

          for (const name of names) {
            addNameToMap(specifierMap, name)
          }
        }
      }

      hoistExports(this, path, specifierMap, "declaration")

      // Skip adding declared names to this.exportedLocalNames if the
      // declaration is a const-kinded VariableDeclaration, because the
      // assignmentVisitor doesn't need to worry about changes to these
      // variables.
      if (canExportedValuesChange(decl)) {
        addExportedLocalNames(this, specifierMap)
      }

      return
    }

    if (! decl.specifiers) {
      return
    }

    let specifierMap = computeSpecifierMap(decl.specifiers)

    if (decl.source == null) {
      hoistExports(this, path, specifierMap)
      addExportedLocalNames(this, specifierMap)
      return
    }

    const newMap = new OrderedMap
    const names = specifierMap.keys()

    for (const name of names) {
      const locals = specifierMap.get(name).keys()

      addToSpecifierMap(
        newMap,
        locals[0],
        this.runtimeAlias + ".entry._namespace." + name
      )
    }

    specifierMap = newMap

    // Even though the compiled code uses `runtime.watch()`, it should
    // still be hoisted as an export, i.e. before actual imports.
    hoistExports(this, path, toModuleImport(
      this,
      getSourceString(this, decl),
      specifierMap
    ))
  }
}

function addExportedLocalNames(visitor, specifierMap) {
  const exportedNames = visitor.exportedLocalNames
  const names = specifierMap.keys()

  for (const name of names) {
    const locals = specifierMap.get(name).keys()

    // It's tempting to record the exported name as the value here,
    // instead of true, but there can be more than one exported name
    // per local variable, and we don't actually use the exported
    // name(s) in the assignmentVisitor, so it's not worth the added
    // complexity of tracking unused information.
    exportedNames[locals[0]] = true
  }
}

function addImportedLocalNames(visitor, specifierMap) {
  const importedNames = visitor.importedLocalNames
  const names = specifierMap.keys()

  for (const name of names) {
    const locals = specifierMap.get(name).keys()

    for (const local of locals) {
      importedNames[local] = true
    }
  }
}

function addNameToMap(map, name) {
  addToSpecifierMap(map, name, name)
}

function addToSpecifierMap(map, __ported, local) {
  const locals = map.get(__ported) || new OrderedMap
  locals.set(local, true)
  return map.set(__ported, locals)
}

// Returns a map from {im,ex}ported identifiers to lists of local variable
// names bound to those identifiers.
function computeSpecifierMap(specifiers) {
  const specifierMap = new OrderedMap

  for (const s of specifiers) {
    const local =
      s.type === "ExportDefaultSpecifier" ? "default" :
      s.type === "ExportNamespaceSpecifier" ? "*" :
      s.local.name

    const __ported = // The IMported or EXported name.
      s.type === "ImportSpecifier" ? s.imported.name :
      s.type === "ImportDefaultSpecifier" ? "default" :
      s.type === "ImportNamespaceSpecifier" ? "*" :
      (s.type === "ExportSpecifier" ||
       s.type === "ExportDefaultSpecifier" ||
       s.type === "ExportNamespaceSpecifier") ? s.exported.name :
      null

    if (typeof local === "string" && typeof __ported === "string") {
      addToSpecifierMap(specifierMap, __ported, local)
    }
  }

  return specifierMap
}

function getBlockBodyInfo(visitor, path) {
  if (visitor.bodyInfo !== null) {
    return visitor.bodyInfo
  }

  const parent = path.getParentNode()
  const body = parent.body

  let hoistedPrefixString = ""
  let insertCharIndex = parent.start
  let insertNodeIndex = 0

  // Avoid hoisting above string literal expression statements such as
  // "use strict", which may depend on occurring at the beginning of
  // their enclosing scopes.
  let i = -1
  const stmtCount = body.length

  while (++i < stmtCount) {
    const stmt = body[i]
    if (stmt.type === "ExpressionStatement" &&
        stmt.expression.type === "Literal" &&
        typeof stmt.expression.value === "string") {
      insertCharIndex = stmt.end
      insertNodeIndex = i + 1
      hoistedPrefixString = ";"
    } else {
      break
    }
  }

  const bodyInfo = visitor.bodyInfo = Object.create(null)
  bodyInfo.insertCharIndex = insertCharIndex
  bodyInfo.insertNodeIndex = insertNodeIndex
  bodyInfo.hoistedExportsMap = new OrderedMap
  bodyInfo.hoistedExportsString = ""
  bodyInfo.hoistedImportsString = ""
  bodyInfo.hoistedPrefixString = hoistedPrefixString

  return bodyInfo
}

// Gets a string representation (including quotes) from an import or
// export declaration node.
function getSourceString(visitor, decl) {
  return visitor.code.slice(decl.source.start, decl.source.end)
}

function hoistImports(visitor, importDeclPath, hoistedCode) {
  preserveLine(visitor, importDeclPath)
  const bodyInfo = getBlockBodyInfo(visitor, importDeclPath)
  bodyInfo.hoistedImportsString += hoistedCode
}

function hoistExports(visitor, exportDeclPath, mapOrString, childName) {
  if (childName) {
    preserveChild(visitor, exportDeclPath, childName)
  } else {
    preserveLine(visitor, exportDeclPath)
  }

  const bodyInfo = getBlockBodyInfo(visitor, exportDeclPath)

  if (typeof mapOrString === "string") {
    bodyInfo.hoistedExportsString += mapOrString
    return
  }

  const names = mapOrString.keys()

  for (const name of names) {
    const locals = mapOrString.get(name).keys()

    addToSpecifierMap(
      bodyInfo.hoistedExportsMap,
      name,
      locals[0]
    )
  }
}

function canExportedValuesChange(exportDecl) {
  if (exportDecl.type === "ExportDefaultDeclaration") {
    const dd = exportDecl.declaration
    return (dd.type === "FunctionDeclaration" ||
            dd.type === "ClassDeclaration")
  }

  if (exportDecl.type === "ExportNamedDeclaration") {
    const dd = exportDecl.declaration
    if (dd &&
        dd.type === "VariableDeclaration" &&
        dd.kind === "const") {
      return false
    }
  }

  return true
}

function overwrite(visitor, oldStart, oldEnd, newCode) {
  const padded = pad(visitor, newCode, oldStart, oldEnd)

  if (oldStart !== oldEnd) {
    visitor.madeChanges = true
    visitor.magicString.overwrite(oldStart, oldEnd, padded)
  } else if (padded !== "") {
    visitor.madeChanges = true
    visitor.magicString.prependRight(oldStart, padded)
  }
}

function pad(visitor, newCode, oldStart, oldEnd) {
  const oldLines = visitor.code.slice(oldStart, oldEnd).split("\n")
  const oldLineCount = oldLines.length
  const newLines = newCode.split("\n")
  const lastIndex = newLines.length - 1
  let i = lastIndex - 1

  while (++i < oldLineCount) {
    const oldLine = oldLines[i]
    const lastCharCode = oldLine.charCodeAt(oldLine.length - 1)

    if (i > lastIndex) {
      newLines[i] = ""
    }
    if (lastCharCode === codeOfCR) {
      newLines[i] += "\r"
    }
  }

  return newLines.join("\n")
}

function preserveChild(visitor, path, childName) {
  const node = path.getValue()
  const child = node[childName]

  overwrite(
    visitor,
    node.start,
    child.start,
    ""
  )
  overwrite(
    visitor,
    child.end,
    node.end,
    ""
  )

  path.call(visitor, "visitWithoutReset", childName)
}

function preserveLine(visitor, path) {
  const node = path.getValue()
  overwrite(visitor, node.start, node.end, "")
}

function safeParam(param, locals) {
  return locals.indexOf(param) < 0 ? param : safeParam("_" + param, locals)
}

function toModuleImport(visitor, code, specifierMap) {
  const names = specifierMap.keys()

  code = visitor.runtimeAlias + ".w(" + code

  if (! names.length) {
    return code + ");"
  }

  let i = -1
  const lastIndex = names.length - 1

  code += ",["

  for (const name of names) {
    const locals = specifierMap.get(name).keys()
    const valueParam = safeParam("v", locals)

    /* eslint lines-around-comment: off */
    code +=
      // Generate plain functions, instead of arrow functions,
      // to avoid a perf hit in Node 4.
      "[" + JSON.stringify(name) + ",function(" + valueParam + "){" +
      // Multiple local variables become a compound assignment.
      locals.join("=") + "=" + valueParam +
      "}]"

    if (++i !== lastIndex) {
      code += ","
    }
  }

  code += "]);"

  return code
}

function toModuleExport(visitor, specifierMap) {
  const names = specifierMap.keys()

  let code = ""

  if (! names.length) {
    return code
  }

  let i = -1
  const lastIndex = names.length - 1

  code += visitor.runtimeAlias + ".e(["

  for (const name of names) {
    const locals = specifierMap.get(name).keys()

    code +=
      "[" + JSON.stringify(name) + ",()=>" +
      locals[0] +
      "]"

    if (++i !== lastIndex) {
      code += ","
    }
  }

  code += "]);"

  return code
}

export default ImportExportVisitor
