import * as Schema from "effect/Schema";

import { VideProjectFile, Vide_PROJECT_FILE_SCHEMA_URL } from "@vide/contracts";

import { fromLenientJson } from "./schemaJson.ts";

/**
 * Codec between the raw `vide.json` file contents (lenient JSONC string) and the
 * decoded {@link VideProjectFile}.
 */
export const VideProjectFileFromJson = fromLenientJson(VideProjectFile);

/**
 * Build the publishable JSON Schema document for `vide.json` (draft 2020-12).
 *
 * Served from the marketing site at {@link Vide_PROJECT_FILE_SCHEMA_URL} so
 * editors get LSP support via a `$schema` reference.
 */
export function buildVideProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(VideProjectFile);
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: Vide_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
