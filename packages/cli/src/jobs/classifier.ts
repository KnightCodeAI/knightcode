// TODO: the job-template classifier (categorizes a finished turn and writes job
// state for templated workflows) isn't implemented yet. It runs behind a
// feature gate that is off in this build, so the stop-hook spine never reaches
// this; it is a no-op until the job-templates subsystem lands.

import type { AssistantMessage } from '../types/message.js'

export async function classifyAndWriteState(
  _jobDir: string | undefined,
  _turnAssistantMessages: AssistantMessage[],
): Promise<void> {}
