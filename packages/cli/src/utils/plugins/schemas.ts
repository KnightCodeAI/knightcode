import { z } from 'zod/v4';
import { lazySchema } from '../lazySchema.js';

// TODO: plugin marketplace schema lands with the plugins subsystem; permissive
// inert schema so the settings document still parses.
export const MarketplaceSourceSchema = lazySchema(() => z.object({}).passthrough());
