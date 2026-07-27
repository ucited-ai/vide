import {
  Vide_PROJECT_FILE_NAME,
  type EnvironmentId,
  type VideProjectFileScript,
} from "@vide/contracts";
import { VideProjectFileFromJson } from "@vide/shared/videProjectFile";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const decodeVideProjectFile = Schema.decodeExit(VideProjectFileFromJson);

const NO_SCRIPTS: ReadonlyArray<VideProjectFileScript> = [];

/**
 * Scripts declared in the project's checked-in `vide.json`, offered in the
 * scripts menu for import. Missing, truncated, or invalid files resolve to
 * an empty list.
 */
export function useVideProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<VideProjectFileScript> {
  const query = useProjectFileQuery(environmentId, cwd ?? "", Vide_PROJECT_FILE_NAME, cwd !== null);
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  return useMemo(() => {
    if (contents === null) return NO_SCRIPTS;
    const decoded = decodeVideProjectFile(contents);
    if (Exit.isFailure(decoded)) return NO_SCRIPTS;
    return decoded.value.scripts ?? NO_SCRIPTS;
  }, [contents]);
}
