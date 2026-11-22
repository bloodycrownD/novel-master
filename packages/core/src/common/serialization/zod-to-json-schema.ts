/**
 * Minimal Zod ? JSON Schema conversion (tool parameters, wire schemas).
 *
 * @module common/serialization/zod-to-json-schema
 */

import { z } from "zod";

type JsonSchema = Record<string, unknown>;

/**
 * Zod schema → JSON Schema 转换。
 */
export const SerializationZodToJsonSchema = {
    /** Converts a Zod schema to a JSON Schema object for LLM tool `input_schema`. */
    toJsonSchema(schema: z.ZodType): JsonSchema {
        const withJson = schema as z.ZodType & { toJSONSchema?: () => JsonSchema };
        if (typeof withJson.toJSONSchema === "function") {
            return withJson.toJSONSchema();
        }
        return SerializationZodToJsonSchema.zodTypeToJsonSchema(schema);
    },

    /** nm-style: keep-local — 递归 worker：自引用无法内联，且 toJSONSchema 快路径只在根节点执行一次。 */
    zodTypeToJsonSchema(schema: z.ZodType): JsonSchema {
        if (schema instanceof z.ZodOptional) {
            return SerializationZodToJsonSchema.zodTypeToJsonSchema(schema.unwrap() as z.ZodType);
        }

        if (schema instanceof z.ZodObject) {
            const shape = schema.shape;
            const properties: Record<string, JsonSchema> = {};
            const required: string[] = [];
            for (const [key, value] of Object.entries(shape)) {
                const field = value as z.ZodType;
                properties[key] = SerializationZodToJsonSchema.zodTypeToJsonSchema(field);
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
                items: SerializationZodToJsonSchema.zodTypeToJsonSchema(schema.element as z.ZodType),
            };
        }

        return { type: "object", additionalProperties: true };
    },
} as const;
