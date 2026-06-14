// TODO: remote SDK-message adapter — owned by the claude.ai remote-control
// feature. Local-only build never converts remote events; calls are inert.
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type { Message, StreamEvent } from '../types/message.js'

export type ConvertedMessage =
  | { type: 'message'; message: Message }
  | { type: 'stream_event'; event: StreamEvent }
  | { type: 'ignored' }

type ConvertOptions = {
  convertToolResults?: boolean
  convertUserTextMessages?: boolean
}

export function convertSDKMessage(
  _msg: SDKMessage,
  _opts?: ConvertOptions,
): ConvertedMessage {
  return { type: 'ignored' }
}
