#!/usr/bin/env node

import { readFileSync } from 'fs'
import {
  generateOAS,
  initState,
  loadConfig,
  readSourceFiles,
  saveOAS,
  updateSourceFiles,
} from './core'
import { program } from 'commander'
import { watch } from 'chokidar'
import { Config } from './types'
import { glob } from 'glob'
import { spawn } from 'child_process'
import { resolve } from 'path'

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'))
const userConfig: Config = {}
program
  .name(pkg.name)
  .description(pkg.description)
  .version(pkg.version)
  .option('-p, --port [PORT]', 'Port for the redocly preview server')
  .option('-o, --output [JSON FILE]', 'json file name', 'openapi.json')
  .parse(process.argv)

const options = program.opts()
if (options.port) options.port = parseInt(options.port, 10) || 8080
if (options.output) options.output = resolve(options.output)

async function main() {
  initState()
  Object.assign(userConfig, loadConfig())
  readSourceFiles()
  await generateOAS()
  saveOAS(options.output)

  if (options.port) {
    const redoclyPreview = spawn(
      'pnpm',
      ['redocly', 'preview-docs', options.output, `--port ${options.port}`],
      { stdio: 'inherit', shell: true },
    )
    process.on('exit', () => redoclyPreview.kill('SIGTERM'))
    const paths = await glob(userConfig.glob, { absolute: true })
    watch(paths, {
      persistent: true,
      atomic: true,
      followSymlinks: true,
    }).on('change', updateOAS)
  }
}

main()

async function updateOAS(path: string) {
  console.info(`\nChanges ${path}`)
  initState()

  if (path.endsWith('nest-openapi.config.ts'))
    Object.assign(userConfig, loadConfig())

  updateSourceFiles(path)
  await generateOAS()
  saveOAS(options.output)
}

export { Config } from './types'
