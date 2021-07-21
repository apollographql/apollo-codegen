import { Operation, Fragment } from "../";
import { collectFragmentsReferenced } from "./collectFragmentsReferenced";
import { createHash } from "crypto";

export interface OperationIdGenerator {
  (operationDocument: string): string;
}

const Sha256IdGenerator: OperationIdGenerator = operationDocument => {
  const hash = createHash("sha256");
  hash.update(operationDocument);
  return hash.digest("hex");
};

export function generateOperationId(
  operation: Operation,
  fragments: { [fragmentName: string]: Fragment },
  fragmentsReferenced?: Iterable<string>,
  idGenerator: OperationIdGenerator = Sha256IdGenerator
) {
  if (!fragmentsReferenced) {
    fragmentsReferenced = collectFragmentsReferenced(
      operation.selectionSet,
      fragments
    );
  }

  const sourceWithFragments = [
    operation.source,
    ...Array.from(fragmentsReferenced).map(fragmentName => {
      const fragment = fragments[fragmentName];
      if (!fragment) {
        throw new Error(`Cannot find fragment "${fragmentName}"`);
      }
      return fragment.source;
    })
  ].join("\n");

  const operationId = idGenerator(sourceWithFragments);
  return { operationId, sourceWithFragments };
}
