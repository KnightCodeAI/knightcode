import React from 'react'
import { ChatSmoke, MissingKeyNotice } from './components/ChatSmoke.js'
import { render } from './tui.js'
import { hasAnthropicApiKeyAuth } from './utils/auth.js'

const screen = hasAnthropicApiKeyAuth() ? <ChatSmoke /> : <MissingKeyNotice />
const instance = await render(screen)
await instance.waitUntilExit()
