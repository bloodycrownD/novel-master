/**
 * Minimal Zod → JSON Schema conversion for tool definitions.
 *
 * @module infra/llm-protocol/zod-to-json-schema
 */

import { z } from "zod";

type JsonSchema = Record<string, unknown>;

/** Converts a Zod schema to a JSON Schema object for LLM tool `input_schema`. */
export function zodToJsonSchema(schema: z.ZodType): JsonSchema {
  const withJson = schema as z.ZodType & {
    toJSONSchema?: () => JsonSchema;
  };
  if (typeof withJson.toJSONSchema === "function") {
    return withJson.toJSONSchema();
  }
  return zodTypeToJsonSchema(schema);
}

function zodTypeToJsonSchema(schema: z.ZodType): JsonSchema {
  if (schema instanceof z.ZodOptional) {
    return zodTypeToJsonSchema(schema.unwrap() as z.ZodType);
  }

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(shape)) {
      const field = value as z.ZodType;
      properties[key] = zodTypeToJsonSchema(field);
      if (!(field instanceof z.ZodOptional)) {
        required.push(key);
      }
    }
    return {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  if (schema instanceof z.ZodString) {
    return { type: "string" };
  }
  if (schema instanceof z.ZodNumber) {
    return { type: "number" };
  }
  if (schema instanceof z.ZodBoolean) {
    return { type: "boolean" };
  }
  if (schema instanceof z.ZodArray) {
    return {
      type: "array",
      items: zodTypeToJsonSchema(schema.element as z.ZodType),
    };
  }

  return { type: "object", additionalProperties: true };
}
