import type { ModelProfile, SchemaTransform } from '../types.js'

const isObj = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Gemini rejects integer enums and integer-typed enum nodes. */
export const geminiEnumToString: SchemaTransform = (schema: any): any => {
  if (Array.isArray(schema)) return schema.map(geminiEnumToString)
  if (!isObj(schema)) return schema
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'enum' && Array.isArray(v)) {
      out.enum = v.map(x => String(x))
      if (schema.type === 'integer' || schema.type === 'number') out.type = 'string'
    } else if (isObj(v) || Array.isArray(v)) {
      out[k] = geminiEnumToString(v)
    } else {
      out[k] = v
    }
  }
  if (out.enum && (out.type === 'integer' || out.type === 'number')) out.type = 'string'
  return out
}

/** Moonshot/Kimi expand $ref before validation and reject sibling keywords. */
export const moonshotStripRefSiblings: SchemaTransform = (schema: any): any => {
  if (Array.isArray(schema)) return schema.map(moonshotStripRefSiblings)
  if (!isObj(schema)) return schema
  if ('$ref' in schema && typeof schema.$ref === 'string') return { $ref: schema.$ref }
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(schema)) out[k] = moonshotStripRefSiblings(v)
  return out
}

/** Run every schema transform the profile carries. Total: returns input on error. */
export function sanitizeToolSchema(schema: any, profile: ModelProfile): any {
  try {
    return profile.schemaTransforms.reduce((acc, t) => t(acc), schema)
  } catch {
    return schema
  }
}
