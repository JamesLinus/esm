import { dirname } from "path"
import isDirectory from "./is-directory.js"
import mkdir from "./mkdir.js"

function mkdirp(dirPath, scopePath) {
  const parentPath = dirname(dirPath)
  if (dirPath === parentPath || dirPath === scopePath) {
    return true
  }
  if (mkdirp(parentPath, scopePath)) {
    return isDirectory(dirPath) || mkdir(dirPath)
  }
  return false
}

export default mkdirp
