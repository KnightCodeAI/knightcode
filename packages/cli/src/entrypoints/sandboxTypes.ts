import { z } from 'zod/v4';
import { lazySchema } from '../utils/lazySchema.js';

// TODO: sandbox / computer-use settings are out of scope; permissive inert schema
// so the settings document still parses.
export const SandboxSettingsSchema = lazySchema(() => z.object({}).passthrough());
