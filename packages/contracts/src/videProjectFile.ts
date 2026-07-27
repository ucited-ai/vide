import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { ProjectScriptIcon } from "./orchestration.ts";

/** File name of the checked-in Vide project file, resolved at the workspace root. */
export const Vide_PROJECT_FILE_NAME = "vide.json";

/** Public URL of the published JSON Schema for {@link VideProjectFile}. */
export const Vide_PROJECT_FILE_SCHEMA_URL = "https://vide.local/schema/vide.json";

const Vide_PROJECT_FILE_PATH_MAX_LENGTH = 512;
const Vide_PROJECT_FILE_MAX_SCRIPTS = 50;

// Annotations go on the encoded (string) side so they survive into the
// published JSON Schema; decoding still trims and re-validates non-emptiness.
const trimmedNonEmpty = (annotations: { readonly description: string }, maxLength?: number) => {
  const annotated = Schema.String.annotate(annotations);
  const encoded =
    maxLength === undefined
      ? annotated.check(Schema.isNonEmpty())
      : annotated.check(Schema.isNonEmpty(), Schema.isMaxLength(maxLength));
  return encoded.pipe(Schema.decodeTo(encoded, SchemaTransformation.trim()));
};

export const VideProjectFileScript = Schema.Struct({
  name: trimmedNonEmpty({
    description: "Display name for the script, shown in the Vide scripts menu.",
  }),
  command: trimmedNonEmpty({
    description: "Shell command executed in a Vide terminal at the project root.",
  }),
  icon: Schema.optionalKey(
    ProjectScriptIcon.annotate({
      description: 'Icon shown next to the script in the scripts menu. Defaults to "play".',
    }),
  ),
  runOnWorktreeCreate: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, the script runs automatically after a worktree is created for a new thread.",
    }),
  ),
  previewUrl: Schema.optionalKey(
    trimmedNonEmpty({
      description:
        "URL opened in the in-app browser preview when this script runs. Only honored on the desktop build.",
    }),
  ),
  autoOpenPreview: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, automatically open the preview panel at `previewUrl` the moment the script starts.",
    }),
  ),
}).annotate({
  description: "A project script that team members can import into Vide.",
});
export type VideProjectFileScript = typeof VideProjectFileScript.Type;

export const VideProjectFile = Schema.Struct({
  $schema: Schema.optionalKey(
    Schema.String.annotate({
      description: `URL of the JSON Schema for this file, typically "${Vide_PROJECT_FILE_SCHEMA_URL}".`,
    }),
  ),
  iconPath: Schema.optionalKey(
    trimmedNonEmpty(
      {
        description:
          'Workspace-relative path to the project icon (e.g. "assets/logo.svg"). Checked before Vide\'s built-in icon locations.',
      },
      Vide_PROJECT_FILE_PATH_MAX_LENGTH,
    ),
  ),
  scripts: Schema.optionalKey(
    Schema.Array(VideProjectFileScript)
      .annotate({
        description: "Project scripts shared with everyone who opens this repository in Vide.",
      })
      .check(Schema.isMaxLength(Vide_PROJECT_FILE_MAX_SCRIPTS)),
  ),
}).annotate({
  title: "Vide project file",
  description:
    "Checked-in project configuration for Vide (vide.json at the repository root). See https://vide.local for documentation.",
});
export type VideProjectFile = typeof VideProjectFile.Type;
