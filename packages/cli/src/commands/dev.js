import fs from 'fs'
import path from 'path'

import concurrently from 'concurrently'
import terminalLink from 'terminal-link'

import { getConfig } from '@redwoodjs/internal'
import { shutdownPort } from '@redwoodjs/internal/devtools'
import { getProject } from '@redwoodjs/structure'
const project = getProject()

import { getPaths } from 'src/lib'
import c from 'src/lib/colors'
import { generatePrismaClient } from 'src/lib/generatePrismaClient'

export const command = 'dev [side..]'
export const description = 'Start development servers for api, and web'
export const builder = (yargs) => {
  yargs
    .positional('side', {
      choices: ['api', 'web'],
      default: ['api', 'web'],
      description: 'Which dev server(s) to start',
      type: 'array',
    })
    .positional('forward', {
      alias: 'fwd',
      description:
        'String of one or more Webpack DevServer config options, for example: `--fwd="--port=1234 --open=false"`',
      type: 'string',
    })
    .option('esbuild', {
      type: 'boolean',
      required: false,
      description: 'Use ESBuild for api side [experimental]',
    })
    .epilogue(
      `Also see the ${terminalLink(
        'Redwood CLI Reference',
        'https://redwoodjs.com/reference/command-line-interface#dev'
      )}`
    )
}

export const handler = async ({
  side = ['api', 'web'],
  forward = '',
  esbuild = false,
}) => {
  // We use BASE_DIR when we need to effectively set the working dir
  const BASE_DIR = getPaths().base
  // For validation, e.g. dirExists?, we use these
  // note: getPaths().web|api.base returns undefined on Windows
  const API_DIR_SRC = getPaths().api.src
  const WEB_DIR_SRC = getPaths().web.src

  if (side.includes('api')) {
    try {
      await generatePrismaClient({
        verbose: false,
        force: false,
        schema: getPaths().api.dbSchema,
      })
    } catch (e) {
      console.error(c.error(e.message))
    }

    try {
      await shutdownPort(getConfig().api.port)
    } catch (e) {
      console.error(
        `Error whilst shutting down "api" port: ${c.error(e.message)}`
      )
    }
  }

  if (side.includes('web')) {
    try {
      await shutdownPort(getConfig().web.port)
    } catch (e) {
      console.error(
        `Error whilst shutting down "web" port: ${c.error(e.message)}`
      )
    }
  }

  /** @type {Record<string, import('concurrently').CommandObj>} */
  const jobs = {
    api: {
      name: 'api',
      command: `cd "${path.join(
        BASE_DIR,
        'api'
      )}" && yarn cross-env NODE_ENV=development yarn dev-server`,
      prefixColor: 'cyan',
      runWhen: () => fs.existsSync(API_DIR_SRC),
    },
    web: {
      name: 'web',
      command: `cd "${path.join(
        BASE_DIR,
        'web'
      )}" && yarn cross-env NODE_ENV=development webpack-dev-server --config ../node_modules/@redwoodjs/core/config/webpack.development.js ${forward}`,
      prefixColor: 'blue',
      runWhen: () => fs.existsSync(WEB_DIR_SRC),
    },
    typeGenerator: {
      name: 'typeGenerator',
      command: 'yarn rw generate types --watch',
      prefixColor: 'green',
      runWhen: () => project.isTypeScriptProject,
    },
  }

  if (esbuild) {
    jobs.api.name = 'api esbuild'
    jobs.api.command =
      'yarn cross-env NODE_ENV=development NODE_OPTIONS=--enable-source-maps yarn rw-api-server-watch'

    jobs.web.name = 'web esbuild'
    jobs.web.command = 'yarn cross-env ESBUILD=1 && ' + jobs.web.command
  }

  concurrently(
    Object.keys(jobs)
      .map((n) => (side.includes(n) || n === 'typeGenerator') && jobs[n])
      .filter((job) => job && job.runWhen()),
    {
      prefix: '{name} |',
      timestampFormat: 'HH:mm:ss',
    }
  ).catch((e) => {
    if (typeof e?.message !== 'undefined') {
      console.log(c.error(e.message))
    }
  })
}
