import * as React from 'react'
import { useCallback, useMemo, useState, useEffect } from 'react'
import { Box, Text } from '../tui.js'
import type { KeyboardEvent } from '../tui/events/keyboard-event.js'
import { useKeybindings } from '../keybindings/useKeybinding.js'
import { useAppState } from '../state/AppState.js'
import { SearchBox } from './SearchBox.js'
import { Byline } from './design-system/Byline.js'
import { KeyboardShortcutHint } from './design-system/KeyboardShortcutHint.js'
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js'
import { Pane } from './design-system/Pane.js'
import { Tabs, Tab } from './design-system/Tabs.js'
import { useSearchInput } from 'src/hooks/useSearchInput.js'
import { useTerminalSize } from 'src/hooks/useTerminalSize.js'
import { useExitOnCtrlCDWithKeybindings } from 'src/hooks/useExitOnCtrlCDWithKeybindings.js'
import {
  getOpenRouterModels,
  type OpenRouterModel,
  formatContextLength,
  formatPricing,
} from '../utils/model/openRouterModels.js'
import {
  getOpenRouterFavorites,
  toggleOpenRouterFavorite,
} from '../utils/config.js'
import {
  type EffortLevel,
  getSupportedEffortLevels,
  clampEffort,
  convertEffortValueToLevel,
} from '../utils/effort.js'
import { effortLevelToSymbol } from './EffortIndicator.js'
import {
  DOWN_ARROW,
  UP_ARROW,
  STAR_FILLED,
  STAR_OUTLINE,
} from '../constants/figures.js'

export type Props = {
  initial: string | null
  onSelect: (modelId: string | null, effort: EffortLevel | undefined) => void
  onCancel?: () => void
  isStandaloneCommand?: boolean
}

type TabId = 'favorites' | 'all'

export function ModelBrowser({
  initial,
  onSelect,
  onCancel,
  isStandaloneCommand,
}: Props): React.ReactNode {
  const exitState = useExitOnCtrlCDWithKeybindings()
  const [models, setModels] = useState<OpenRouterModel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const [favorites, setFavorites] = useState<string[]>(() =>
    getOpenRouterFavorites(),
  )

  // Open on Favorites when the user has any, else All models.
  const [activeTab, setActiveTab] = useState<TabId>(
    favorites.length > 0 ? 'favorites' : 'all',
  )

  const [selectedIndex, setSelectedIndex] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [isSearchMode, setIsSearchMode] = useState(true)
  // Focus zones top-to-bottom: tabs → search → list. tabsFocused overlays the
  // other two — when true, ←/→ switch tabs and ↓ drops back to search.
  // Reached by pressing ↑ from the search box (see useSearchInput onExitUp).
  const [tabsFocused, setTabsFocused] = useState(false)
  const searchInputActive = isSearchMode && !tabsFocused

  const { rows } = useTerminalSize()
  // Reserve ~11 rows for chrome (header, tab row, search box, gaps, effort
  // line, footer, scroll hints).
  const maxVisible = Math.max(5, Math.min(Math.floor(rows * 0.8), 30) - 11)

  const effortValue = useAppState(s => s.effortValue)
  const [effort, setEffort] = useState<EffortLevel | undefined>(
    effortValue !== undefined
      ? convertEffortValueToLevel(effortValue)
      : undefined,
  )
  const [hasToggledEffort, setHasToggledEffort] = useState(false)

  // Fetch models from OpenRouter API / cache.
  const loadModels = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const fetched = await getOpenRouterModels()
      setModels(fetched)
    } catch (err) {
      setError(err as Error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadModels()
  }, [loadModels])

  // Search input. The hook subscribes to keypresses internally while active —
  // we must NOT also forward keys to handleKeyDown, or every char registers
  // twice. It is active only in search mode.
  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    cursorOffset: searchCursorOffset,
  } = useSearchInput({
    isActive: searchInputActive && !loading && !error,
    onExit: () => {
      setIsSearchMode(false)
      setSelectedIndex(0)
      setScrollOffset(0)
    },
    // ↑ from the search box moves focus up to the tab row.
    onExitUp: () => setTabsFocused(true),
    onCancel,
  })

  // Filter models by active tab and search query.
  const filteredModels = useMemo(() => {
    const tabModels =
      activeTab === 'favorites'
        ? models.filter(m => favorites.includes(m.id))
        : models
    if (!searchQuery) return tabModels
    const lowerQuery = searchQuery.toLowerCase()
    return tabModels.filter(
      m =>
        m.name.toLowerCase().includes(lowerQuery) ||
        m.id.toLowerCase().includes(lowerQuery),
    )
  }, [models, activeTab, favorites, searchQuery])

  // Keep the selected index/scroll window in range when the list shrinks.
  useEffect(() => {
    if (selectedIndex >= filteredModels.length) {
      const newIndex = Math.max(0, filteredModels.length - 1)
      setSelectedIndex(newIndex)
      setScrollOffset(Math.max(0, newIndex - maxVisible + 1))
      return
    }
    setScrollOffset(prev => {
      if (selectedIndex < prev) return selectedIndex
      if (selectedIndex >= prev + maxVisible) return selectedIndex - maxVisible + 1
      return prev
    })
  }, [filteredModels.length, selectedIndex, maxVisible])

  const adjustScrollOffset = useCallback(
    (newIndex: number) => {
      setScrollOffset(prev => {
        if (newIndex < prev) return newIndex
        if (newIndex >= prev + maxVisible) return newIndex - maxVisible + 1
        return prev
      })
    },
    [maxVisible],
  )

  const moveSelection = useCallback(
    (delta: -1 | 1): void => {
      const newIndex = Math.max(
        0,
        Math.min(filteredModels.length - 1, selectedIndex + delta),
      )
      setSelectedIndex(newIndex)
      adjustScrollOffset(newIndex)
    },
    [filteredModels.length, selectedIndex, adjustScrollOffset],
  )

  const switchTab = useCallback((tab: TabId) => {
    setActiveTab(tab)
    setSelectedIndex(0)
    setScrollOffset(0)
  }, [])

  // Focused model and its effort capabilities.
  const focusedModel = filteredModels[selectedIndex]
  const supportedEfforts = useMemo(
    () => (focusedModel ? getSupportedEffortLevels(focusedModel.id) : []),
    [focusedModel],
  )

  const displayEffort = useMemo(() => {
    if (supportedEfforts.length === 0) return undefined
    if (effort && supportedEfforts.includes(effort)) return effort
    return clampEffort(effort ?? 'high', supportedEfforts)
  }, [effort, supportedEfforts])

  const handleToggleFavorite = useCallback(() => {
    if (!focusedModel) return
    toggleOpenRouterFavorite(focusedModel.id)
    setFavorites(getOpenRouterFavorites())
  }, [focusedModel])

  const handleCycleEffort = useCallback(
    (direction: 'left' | 'right') => {
      if (supportedEfforts.length === 0) return
      const currentIdx = supportedEfforts.indexOf(
        displayEffort ?? supportedEfforts[0]!,
      )
      const nextIdx =
        direction === 'right'
          ? (currentIdx + 1) % supportedEfforts.length
          : (currentIdx - 1 + supportedEfforts.length) % supportedEfforts.length
      setEffort(supportedEfforts[nextIdx])
      setHasToggledEffort(true)
    },
    [supportedEfforts, displayEffort],
  )

  const handleSelect = useCallback(() => {
    if (!focusedModel) return
    const id = focusedModel.id
    const finalEffort =
      hasToggledEffort && getSupportedEffortLevels(id).length > 0
        ? displayEffort
        : undefined
    onSelect(id, finalEffort)
  }, [focusedModel, displayEffort, hasToggledEffort, onSelect])

  // List-mode keybindings. Each action is registered under the context that
  // actually binds its keys (resolveKey only matches a binding when its
  // context is in the active set), so they must be split:
  //   - up/down/enter navigation + accept → 'Select' context
  //   - mouse-wheel line scroll            → 'Scroll' context
  //   - left/right effort cycling          → 'ModelPicker' context
  //   - esc/n cancel                       → 'Confirmation' context
  // Registering everything under 'ModelPicker' (which only binds left/right)
  // left up/down/enter unresolved, freezing the list at index 0.
  // Inactive in search mode (search owns the keyboard then) and while the tab
  // row is focused.
  const listKeysActive = !loading && !error && !isSearchMode && !tabsFocused
  useKeybindings(
    {
      'select:previous': () => {
        // ↑ at the top of the list returns to search/type-to-filter.
        if (selectedIndex === 0) {
          setIsSearchMode(true)
          setScrollOffset(0)
        } else {
          moveSelection(-1)
        }
      },
      'select:next': () => moveSelection(1),
      'select:accept': handleSelect,
    },
    { context: 'Select', isActive: listKeysActive },
  )

  useKeybindings(
    {
      'scroll:lineUp': () => moveSelection(-1),
      'scroll:lineDown': () => moveSelection(1),
    },
    { context: 'Scroll', isActive: listKeysActive },
  )

  useKeybindings(
    {
      'modelPicker:decreaseEffort': () => handleCycleEffort('left'),
      'modelPicker:increaseEffort': () => handleCycleEffort('right'),
    },
    { context: 'ModelPicker', isActive: listKeysActive },
  )

  // Tab-row focus zone (reached via ↑ from search). ←/→ switch tabs and
  // ↓/Enter drop back to the search box. Reuses the ModelPicker (left/right)
  // and Select (down/accept) contexts, gated to the tab zone so they never
  // collide with effort cycling or list navigation (those need listKeysActive,
  // which is false here). Keybinding-driven — not onKeyDown — so arrow keys are
  // delivered the same proven way as list nav.
  const tabsKeysActive = tabsFocused && !loading && !error
  const switchToOtherTab = useCallback(
    () => switchTab(activeTab === 'favorites' ? 'all' : 'favorites'),
    [switchTab, activeTab],
  )
  const leaveTabsForSearch = useCallback(() => {
    setTabsFocused(false)
    setIsSearchMode(true)
  }, [])
  useKeybindings(
    {
      'modelPicker:decreaseEffort': switchToOtherTab,
      'modelPicker:increaseEffort': switchToOtherTab,
    },
    { context: 'ModelPicker', isActive: tabsKeysActive },
  )
  useKeybindings(
    {
      'select:next': leaveTabsForSearch,
      'select:accept': leaveTabsForSearch,
    },
    { context: 'Select', isActive: tabsKeysActive },
  )

  useKeybindings(
    { 'confirm:no': () => onCancel?.() },
    { context: 'Confirmation', isActive: !searchInputActive },
  )

  // Non-configurable list-mode keys: Tab switches tabs, Space favorites, and
  // any printable char starts search. Search-mode keys are handled entirely by
  // useSearchInput's own subscription — we deliberately do not forward here.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (loading || error) {
        if (e.key === 'return' && error) {
          e.preventDefault()
          void loadModels()
        }
        return
      }
      // tabsFocused implies isSearchMode is still true, so this early-return
      // also covers the tab zone — its nav is keybinding-driven (see below).
      if (isSearchMode) return

      if (e.key === 'tab') {
        e.preventDefault()
        switchTab(activeTab === 'favorites' ? 'all' : 'favorites')
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        handleToggleFavorite()
        return
      }
      // Carve out keys bound to useKeybindings actions (j/k navigation) and the
      // search trigger so they aren't swallowed as text.
      if (e.ctrl || e.meta) return
      if (e.key === 'j' || e.key === 'k' || e.key === '/') return
      if (e.key.length === 1 && e.key !== ' ') {
        e.preventDefault()
        setIsSearchMode(true)
        setSearchQuery(e.key)
      }
    },
    [
      loading,
      error,
      isSearchMode,
      activeTab,
      switchTab,
      handleToggleFavorite,
      setSearchQuery,
      loadModels,
    ],
  )

  const listIsFocused = !isSearchMode && !tabsFocused

  const content = (
    <Box flexDirection="column" width="100%" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Box marginBottom={1} flexDirection="column">
        <Text color="remember" bold>
          Select model
        </Text>
        <Text dimColor>
          Browse the OpenRouter catalog. Space favorites a model; Tab switches
          tabs.
        </Text>
      </Box>

      {loading ? (
        <Box marginY={1}>
          <Text dimColor>Loading models from OpenRouter…</Text>
        </Box>
      ) : error ? (
        <Box flexDirection="column" marginY={1}>
          <Text color="warning">Failed to load models: {error.message}</Text>
          <Text dimColor>Press Enter to retry, or Esc to cancel.</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {/* Tabs is a visual segmented header here; switching is driven by
              the Tab key (handleKeyDown) so it never collides with the
              left/right effort cycling. disableNavigation keeps Tabs from
              also grabbing keys. */}
          <Tabs
            selectedTab={activeTab}
            onTabChange={tabId => switchTab(tabId as TabId)}
            disableNavigation
            initialHeaderFocused={false}
          >
            {/* Bodies are rendered below the header (shared across tabs), so
                the Tab content is intentionally empty. */}
            <Tab title="Favorites" id="favorites">
              {null}
            </Tab>
            <Tab title="All models" id="all">
              {null}
            </Tab>
          </Tabs>

          <Box marginY={1}>
            <SearchBox
              query={searchQuery}
              isFocused={searchInputActive}
              isTerminalFocused={true}
              cursorOffset={searchCursorOffset}
              placeholder="Filter by name or id…"
            />
          </Box>

          <Box flexDirection="column">
            {filteredModels.length === 0 ? (
              <Box marginY={1}>
                {activeTab === 'favorites' && !searchQuery ? (
                  <Text dimColor>
                    No favorites yet — press Space on any model in All models to
                    add one
                  </Text>
                ) : (
                  <Text dimColor>No models match &quot;{searchQuery}&quot;</Text>
                )}
              </Box>
            ) : (
              <>
                {scrollOffset > 0 && (
                  <Text dimColor>
                    {UP_ARROW} {scrollOffset} more above
                  </Text>
                )}
                {filteredModels
                  .slice(scrollOffset, scrollOffset + maxVisible)
                  .map((model, i) => {
                    const actualIndex = scrollOffset + i
                    const isSelected = actualIndex === selectedIndex && listIsFocused
                    const isFavorite = favorites.includes(model.id)
                    const colorName = isSelected ? 'suggestion' : undefined

                    const tags: string[] = [
                      formatPricing(model.pricing),
                      formatContextLength(model.contextLength),
                    ]
                    if (model.inputModalities.includes('image')) tags.push('vision')
                    if (model.supportsTools) tags.push('tools')
                    if (model.supportsReasoning) tags.push('thinking')

                    return (
                      <Box key={model.id} flexDirection="column">
                        <Box
                          flexDirection="row"
                          justifyContent="space-between"
                          width="100%"
                        >
                          <Box flexDirection="row">
                            <Text color={isFavorite ? 'warning' : 'subtle'}>
                              {isFavorite ? `${STAR_FILLED} ` : `${STAR_OUTLINE} `}
                            </Text>
                            <Text bold={isSelected} color={colorName}>
                              {model.name}
                            </Text>
                          </Box>
                          <Text dimColor={!isSelected} color={colorName}>
                            {tags.join(' · ')}
                          </Text>
                        </Box>
                        <Box paddingLeft={2}>
                          <Text dimColor={!isSelected} color={colorName}>
                            {model.id}
                          </Text>
                        </Box>
                      </Box>
                    )
                  })}
                {scrollOffset + maxVisible < filteredModels.length && (
                  <Text dimColor>
                    {DOWN_ARROW}{' '}
                    {filteredModels.length - scrollOffset - maxVisible} more below
                  </Text>
                )}
              </>
            )}
          </Box>

          <Box marginTop={1} marginBottom={1} flexDirection="row">
            {supportedEfforts.length > 0 ? (
              <>
                <Text dimColor>
                  {effortLevelToSymbol(displayEffort ?? 'low')} Thinking:{' '}
                </Text>
                {supportedEfforts.map((level, idx) => {
                  const isCurrent = level === displayEffort
                  return (
                    <React.Fragment key={level}>
                      {idx > 0 && <Text dimColor> · </Text>}
                      <Text
                        bold={isCurrent}
                        color={isCurrent ? 'knightcode' : 'subtle'}
                      >
                        {level}
                      </Text>
                    </React.Fragment>
                  )
                })}
                <Text color="subtle"> ← → to adjust</Text>
              </>
            ) : (
              <Text color="subtle">
                {effortLevelToSymbol('none')} Thinking: not supported
              </Text>
            )}
          </Box>
        </Box>
      )}

      {!loading && !error && (
        <Text dimColor>
          {tabsFocused ? (
            <Byline>
              <KeyboardShortcutHint shortcut="←/→" action="switch tab" />
              <KeyboardShortcutHint shortcut="↓" action="search" />
              <ConfigurableShortcutHint
                action="confirm:no"
                context="Confirmation"
                fallback="Esc"
                description="cancel"
              />
            </Byline>
          ) : isSearchMode ? (
            <Byline>
              <Text>Type to filter</Text>
              <KeyboardShortcutHint shortcut="↑" action="tabs" />
              <KeyboardShortcutHint shortcut="Enter/↓" action="focus list" />
              <ConfigurableShortcutHint
                action="confirm:no"
                context="Confirmation"
                fallback="Esc"
                description="cancel"
              />
            </Byline>
          ) : (
            <Byline>
              <KeyboardShortcutHint shortcut="Space" action="favorite" />
              <KeyboardShortcutHint shortcut="←/→" action="effort" />
              <KeyboardShortcutHint shortcut="Tab" action="switch tab" />
              <KeyboardShortcutHint shortcut="Enter" action="select" />
              <ConfigurableShortcutHint
                action="confirm:no"
                context="Confirmation"
                fallback="Esc"
                description="cancel"
              />
            </Byline>
          )}
        </Text>
      )}

      {isStandaloneCommand && exitState.pending && (
        <Box marginTop={1}>
          <Text dimColor italic>
            Press {exitState.keyName} again to exit
          </Text>
        </Box>
      )}
    </Box>
  )

  if (!isStandaloneCommand) {
    return content
  }

  return <Pane color="permission">{content}</Pane>
}
