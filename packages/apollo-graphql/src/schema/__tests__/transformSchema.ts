import { transformSchema } from "../transformSchema";
import { buildSchema } from "graphql";

import astSerializer from "./snapshotSerializers/astSerializer";
import graphQLTypeSerializer from "./snapshotSerializers/graphQLTypeSerializer";
import selectionSetSerializer from "./snapshotSerializers/selectionSetSerializer";

expect.addSnapshotSerializer(astSerializer);
expect.addSnapshotSerializer(graphQLTypeSerializer);
expect.addSnapshotSerializer(selectionSetSerializer);

describe("transformSchema", () => {
  it(`should handle interfaces implementing interfaces without duplicating type instances`, () => {
    const originalSchema = buildSchema(`
      interface A { text: String }
      interface B implements A { text: String number: Int}`);

    const schema = transformSchema(originalSchema, t => {
      return undefined;
    });

    expect(schema.getType("B")).toMatchInlineSnapshot(`
interface B implements A {
  text: String
  number: Int
}
`);
  });
});
