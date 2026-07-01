// TODO: voice mode is not ported to this build.
export async function checkRecordingAvailability(): Promise<{
  available: false
  reason: string
}> {
  return { available: false, reason: 'Voice mode is not supported in this build.' }
}

export async function checkVoiceDependencies(): Promise<{
  available: false
  installCommand?: string
}> {
  return { available: false }
}

export async function requestMicrophonePermission(): Promise<false> {
  return false
}
