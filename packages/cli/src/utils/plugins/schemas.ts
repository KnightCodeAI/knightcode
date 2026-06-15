import { z } from 'zod/v4';
import { lazySchema } from '../lazySchema.js';

// TODO: plugin marketplace schema lands with the plugins subsystem; permissive
// inert schema so the settings document still parses.
export const MarketplaceSourceSchema = lazySchema(() => z.object({}).passthrough());

// KnightCode-controlled marketplaces. Used by hook telemetry/plugin classification.
export const ALLOWED_OFFICIAL_MARKETPLACE_NAMES = new Set([
  'knightcode-code-marketplace',
  'knightcode-code-plugins',
  'knightcode-plugins-official',
  'knightcode-marketplace',
]);
