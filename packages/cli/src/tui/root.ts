import { createCliRenderer, type CliRenderer } from '@opentui/core'
import { createRoot as createReactRoot } from '@opentui/react'
import { createElement, type ReactNode } from 'react'
import { Stream } from 'stream'
import App from './components/App.js'
import type { FrameEvent } from './frame.js'
import instances, { type TuiInstance } from './instances.js'

export type RenderOptions = {
  /**
   * Output stream where app will be rendered.
   *
   * @default process.stdout
   */
  stdout?: NodeJS.WriteStream
  /**
   * Input stream where app will listen for input.
   *
   * @default process.stdin
   */
  stdin?: NodeJS.ReadStream
  /**
   * Error stream.
   * @default process.stderr
   */
  stderr?: NodeJS.WriteStream
  /**
   * Configure whether to listen to Ctrl+C keyboard input and exit the app.
   * This is needed in case `process.stdin` is in raw mode, because then
   * Ctrl+C is ignored by default and process is expected to handle it
   * manually.
   *
   * @default true
   */
  exitOnCtrlC?: boolean

  /**
   * Patch console methods to ensure console output doesn't mix with
   * rendered output.
   *
   * @default true
   */
  patchConsole?: boolean

  /**
   * Called after each frame render with timing and flicker information.
   */
  onFrame?: (event: FrameEvent) => void
}

export type Instance = {
  /**
   * Replace previous root node with a new one or update props of the current root node.
   */
  rerender: (node: ReactNode) => void
  /**
   * Manually unmount the whole app.
   */
  unmount: () => void
  /**
   * Returns a promise, which resolves when app is unmounted.
   */
  waitUntilExit: () => Promise<void>
  cleanup: () => void
}

/**
 * A managed root, similar to react-dom's createRoot API.
 * Separates instance creation from rendering so the same root
 * can be reused for multiple sequential screens.
 */
export type Root = {
  render: (node: ReactNode) => void
  unmount: () => void
  waitUntilExit: () => Promise<void>
}

type CreateInstanceOptions = Required<
  Pick<RenderOptions, 'stdout' | 'stdin' | 'exitOnCtrlC'>
> &
  Pick<RenderOptions, 'patchConsole'>

async function createInstance(
  options: CreateInstanceOptions,
): Promise<TuiInstance> {
  const renderer: CliRenderer = await createCliRenderer({
    stdin: options.stdin,
    stdout: options.stdout,
    exitOnCtrlC: false, // ctrl+c is handled in App so exit() resolves waitUntilExit
  })

  const reactRoot = createReactRoot(renderer)

  let resolveExit: (value?: unknown) => void
  let rejectExit: (error: Error) => void
  const exitPromise = new Promise((resolve, reject) => {
    resolveExit = resolve
    rejectExit = reject
  })

  let exited = false
  const instance: TuiInstance = {
    render(node: ReactNode) {
      reactRoot.render(
        createElement(
          App,
          {
            renderer,
            exitOnCtrlC: options.exitOnCtrlC,
            exit: (error?: Error) => {
              if (exited) return
              exited = true
              reactRoot.unmount()
              renderer.destroy()
              instances.delete(options.stdout)
              if (error) {
                rejectExit(error)
              } else {
                resolveExit()
              }
            },
          },
          node,
        ),
      )
    },
    unmount() {
      if (exited) return
      exited = true
      reactRoot.unmount()
      renderer.destroy()
      instances.delete(options.stdout)
      resolveExit()
    },
    waitUntilExit() {
      return exitPromise.then(() => undefined)
    },
    clear() {
      renderer.console.clear()
    },
  }

  return instance
}

const wrappedRender = async (
  node: ReactNode,
  options?: NodeJS.WriteStream | RenderOptions,
): Promise<Instance> => {
  const opts = getOptions(options)
  const fullOptions: CreateInstanceOptions = {
    stdout: opts.stdout ?? process.stdout,
    stdin: opts.stdin ?? process.stdin,
    exitOnCtrlC: opts.exitOnCtrlC ?? true,
    patchConsole: opts.patchConsole ?? true,
  }

  let instance = instances.get(fullOptions.stdout)
  if (!instance) {
    instance = await createInstance(fullOptions)
    instances.set(fullOptions.stdout, instance)
  }

  instance.render(node)

  return {
    rerender: instance.render,
    unmount() {
      instance.unmount()
    },
    waitUntilExit: instance.waitUntilExit,
    cleanup: () => instances.delete(fullOptions.stdout),
  }
}

export default wrappedRender

/**
 * Create a root without rendering anything yet.
 * Like react-dom's createRoot — call root.render() to mount a tree.
 */
export async function createRoot({
  stdout = process.stdout,
  stdin = process.stdin,
  exitOnCtrlC = true,
  patchConsole = true,
}: RenderOptions = {}): Promise<Root> {
  const instance = await createInstance({
    stdout,
    stdin,
    exitOnCtrlC,
    patchConsole,
  })

  // Register in the instances map so that code that looks up the live
  // instance by stdout (e.g. external editor pause/resume) can find it.
  instances.set(stdout, instance)

  return {
    render: node => instance.render(node),
    unmount: () => instance.unmount(),
    waitUntilExit: () => instance.waitUntilExit(),
  }
}

const getOptions = (
  stdout: NodeJS.WriteStream | RenderOptions | undefined = {},
): RenderOptions => {
  if (stdout instanceof Stream) {
    return {
      stdout,
      stdin: process.stdin,
    }
  }

  return stdout
}
