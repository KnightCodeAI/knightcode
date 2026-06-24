import { describe, expect, mock, spyOn, test } from 'bun:test'
import * as React from 'react'
import { useRef } from 'react'
import * as config from '../utils/config'
import { AppStateProvider } from '../state/AppState'
import { getDefaultAppState } from '../state/AppStateStore'
import { KeybindingProvider } from '../keybindings/KeybindingContext'
import { loadKeybindingsSyncWithWarnings } from '../keybindings/loadUserBindings'
import type { KeybindingContextName } from '../keybindings/types'
import { InputEvent } from '../tui/events/input-event'
import type { ParsedKey } from '../tui/parse-keypress'
import { createInkTestRenderer } from '../tui/testing'
import { ThemeProvider } from './design-system/ThemeProvider'

const MODELS = [
  { id: 'vendor/model-a', name: 'Model A', contextLength: 1000, pricing: { prompt: 0, completion: 0 }, inputModalities: ['text'], supportsTools: false, supportsReasoning: false },
  { id: 'vendor/model-b', name: 'Model B', contextLength: 2000, pricing: { prompt: 0, completion: 0 }, inputModalities: ['text'], supportsTools: false, supportsReasoning: false },
  { id: 'vendor/model-c', name: 'Model C', contextLength: 3000, pricing: { prompt: 0, completion: 0 }, inputModalities: ['text'], supportsTools: false, supportsReasoning: false },
]

mock.module('../utils/model/openRouterModels.js', () => ({
  getOpenRouterModels: async () => MODELS,
  getOpenRouterModel: (id: string) => MODELS.find(m => m.id === id),
  formatContextLength: () => '1K',
  formatPricing: () => 'free',
}))

const tick = (ms = 25) => new Promise(resolve => setTimeout(resolve, ms))

function keyEvent(name: string, sequence: string): InputEvent {
  const keypress: ParsedKey = {
    kind: 'key', fn: false, name, ctrl: false, meta: false, shift: false,
    option: false, super: false, sequence, raw: sequence, isPasted: false,
  }
  return new InputEvent(keypress)
}

function StaticKeybindingProvider({ children }: { children: React.ReactNode }) {
  const { bindings } = loadKeybindingsSyncWithWarnings()
  const pendingChordRef = useRef(null)
  const handlerRegistryRef = useRef(new Map())
  const activeContexts = useRef(new Set<KeybindingContextName>()).current
  return (
    <KeybindingProvider
      bindings={bindings}
      pendingChordRef={pendingChordRef}
      pendingChord={null}
      setPendingChord={() => {}}
      activeContexts={activeContexts}
      registerActiveContext={() => {}}
      unregisterActiveContext={() => {}}
      handlerRegistryRef={handlerRegistryRef}
    >
      {children}
    </KeybindingProvider>
  )
}

describe('ModelBrowser navigation', () => {
  test('arrow-down + Enter selects the second model', async () => {
    // No favorites → component opens on the "All models" tab.
    spyOn(config, 'getOpenRouterFavorites').mockReturnValue([])
    const { ModelBrowser } = await import('./ModelBrowser')
    const selected: Array<string | null> = []
    const h = createInkTestRenderer({ width: 80, height: 24 })
    h.render(
      <AppStateProvider initialState={getDefaultAppState()}>
        <ThemeProvider initialState="dark">
          <StaticKeybindingProvider>
            <ModelBrowser initial={null} onSelect={id => selected.push(id)} />
          </StaticKeybindingProvider>
        </ThemeProvider>
      </AppStateProvider>,
    )

    // Let the async model fetch resolve.
    for (let i = 0; i < 6; i++) {
      await tick()
      h.renderOnce()
    }
    expect(h.captureCharFrame()).toContain('Model A')

    // Passive useInput subscriptions and the search-exit state change need a
    // tick to flush between keypresses, so each press awaits one.
    const press = async (name: string, seq: string) => {
      h.inputEmitter.emit('input', keyEvent(name, seq))
      h.renderOnce()
      await tick()
      h.renderOnce()
    }

    // First ↓ exits search mode → list focused at index 0.
    await press('down', '\x1b[B')
    // Second ↓ moves selection to index 1 (Model B).
    await press('down', '\x1b[B')
    // Enter selects the focused model.
    await press('return', '\r')

    // Regression guard: before the fix, navigation/accept were registered under
    // the 'ModelPicker' context (which only binds left/right), so down/enter
    // never resolved and onSelect was never called (selected stayed []).
    expect(selected).toEqual(['vendor/model-b'])
  })
})
