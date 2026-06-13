// TODO: the full attachment pipeline (file/IDE/memory/todo attachment builders
// and the API normalization layer) lands later. This carries only the message
// constructor the tool/hook layer needs today.

import { randomUUID } from 'crypto'
import type { AttachmentMessage } from '../types/message.js'

export function createAttachmentMessage(
  attachment: AttachmentMessage['attachment'],
): AttachmentMessage {
  return {
    attachment,
    type: 'attachment',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  }
}
