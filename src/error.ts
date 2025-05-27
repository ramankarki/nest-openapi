import { Node } from 'ts-morph'

/** Terminates the node process */
export function error(message: string, nodes?: Node[]) {
  console.error(`Error: ${message}`)

  nodes?.forEach((node) => {
    const sourceFile = node.getSourceFile()
    const sourceFilePath = sourceFile.getFilePath()
    const { line, column } = sourceFile.getLineAndColumnAtPos(node.getPos())
    console.error(`${sourceFilePath}:${line}:${column}`)
  })
  process.exit(1)
}

// check
