// TODO: the SDK event queue feeds headless/streaming consumers (drained in
// non-interactive mode). The TUI never drains it, so enqueued events would only
// accumulate — keep it inert until the headless surface lands.

export type SdkEvent = { type: string; [key: string]: unknown }

export function enqueueSdkEvent(_event: SdkEvent): void {}
