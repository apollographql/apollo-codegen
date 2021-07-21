// this is because of herkou-cli-utils hacky mocking system on their console logger
import { stdout, mockConsole } from "heroku-cli-util";
import path from "path";
import fs from "fs";
import { test as setup } from "apollo-cli-test";
import {
  getIntrospectionQuery,
  print,
  execute,
  buildSchema,
  graphql
} from "graphql";
import gql from "graphql-tag";

const test = setup.do(() => mockConsole());

// helper function to resolve files from the actual filesystem
const resolveFiles = opts => {
  let files = {};
  Object.keys(opts).map(key => {
    files[key] = fs.readFileSync(path.resolve(__dirname, opts[key]), {
      encoding: "utf-8"
    });
  });

  return files;
};

const {
  graphQLSchema,
  simpleQuery,
  otherQuery,
  queryWithFragments,
  clientSideSchema,
  clientSideSchemaQuery,
  clientSideOnlySchema,
  clientSideOnlyQuery,
  errorQuery
} = resolveFiles({
  graphQLSchema: "../../service/__tests__/fixtures/schema.graphql",
  simpleQuery: "./fixtures/simpleQuery.graphql",
  otherQuery: "./fixtures/otherQuery.graphql",
  queryWithFragments: "./fixtures/queryWithFragments.graphql",
  clientSideSchema: "./fixtures/clientSideSchema.graphql",
  clientSideSchemaQuery: "./fixtures/clientSideSchemaQuery.graphql",
  clientSideOnlySchema: "./fixtures/clientSideOnlySchema.graphql",
  clientSideOnlyQuery: "./fixtures/clientSideOnlyQuery.graphql",
  errorQuery: "./fixtures/errorQuery.graphql"
});

// introspection results of a schema, JSON.stringified
const fullSchemaJsonString = JSON.stringify(
  execute(buildSchema(graphQLSchema), gql(getIntrospectionQuery())).data
    .__schema
);

// to be used for sample js files that contain client side schema definitions
const clientSideSchemaTag = `
  const clientSchema = gql\`
    ${clientSideSchema}
  \`
`;

const defaultConfig = `
  module.exports = {
    client: {
      includes: ["./**.graphql"],
      service: { name: "my-service-name", localSchemaFile: "./schema.json" }
    }
  }
`;

const defaultFiles = {
  "./schema.json": fullSchemaJsonString,
  "./queryOne.graphql": simpleQuery.toString(),
  "./my.config.js": defaultConfig
};

jest.setTimeout(25000);

describe("client:codegen", () => {
  test
    .fs(defaultFiles)
    .command([
      "client:codegen",
      "API.swift",
      "--config=my.config.js",
      "--target=swift"
    ])
    .it("writes swift types from local schema", () => {
      expect(fs.readFileSync("API.swift").toString()).toMatchSnapshot();
    });

  test
    .fs({
      "schema.graphql": graphQLSchema,
      "queryOne.graphql": simpleQuery.toString(),
      "my.config.js": `
        module.exports = {
          client: {
            includes: ["./queryOne.graphql"],
            service: { name: "my-service-name", localSchemaFile: "./schema.graphql" }
          }
        }
      `
    })
    .command([
      "client:codegen",
      "API.swift",
      "--config=my.config.js",
      "--target=swift"
    ])
    .it("writes swift types from local schema in a graphql file", () => {
      expect(fs.readFileSync("API.swift").toString()).toMatchSnapshot();
    });

  test
    .fs({
      "schema.json": fullSchemaJsonString,
      "queryOne.graphql": queryWithFragments.toString(),
      "my.config.js": `
        module.exports = {
          client: {
            includes: ["./queryOne.graphql"],
            service: { name: "my-service-name", localSchemaFile: "./schema.json" }
          }
        }
      `
    })
    .command([
      "client:codegen",
      "API.swift",
      "--config=my.config.js",
      "--target=swift",
      "--operationIdsPath=myOperationIDs.json"
    ])
    .it("generates operation IDs for swift files when flag is set", () => {
      expect(
        fs.readFileSync("myOperationIDs.json").toString()
      ).toMatchSnapshot();
    });

  // FIXME: doesn't write anything significant to snapshot
  test
    .skip()
    .fs({
      "schema.json": fullSchemaJsonString,
      "queryOne.graphql": simpleQuery.toString(),
      "queryTwo.graphql": otherQuery.toString(),
      "my.config.js": defaultConfig
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--only=queryTwo.graphql",
      "--target=swift",
      "outDirectory"
    ])
    .it("handles only flag for Swift target", () => {
      const [filePath] = fs.readdirSync("./outDirectory");
      const file = fs.readFileSync(`./outDirectory/${filePath}`).toString();

      // expect(file).toMatchSnapshot();
    });

  test
    .fs({
      "schema.json": fullSchemaJsonString,
      "queryOne.graphql": simpleQuery.toString(),
      "my.config.js": defaultConfig
    })
    .command([
      "client:codegen",
      "--target=scala",
      "API.scala",
      "--config=my.config.js"
    ])
    .it("writes types for scala", () => {
      expect(fs.readFileSync("API.scala").toString()).toMatchSnapshot();
    });

  test
    .fs({
      "schema.json": fullSchemaJsonString,
      "queryOne.graphql": simpleQuery.toString(),
      "my.config.js": defaultConfig
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=typescript",
      "--outputFlat",
      "API.ts"
    ])
    .it("writes types for typescript", () => {
      expect(fs.readFileSync("API.ts").toString()).toMatchSnapshot();
    });

  test
    .fs({
      "schema.json": fullSchemaJsonString,
      "queryOne.graphql": simpleQuery.toString(),
      "my.config.js": defaultConfig
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=typescript",
      "--tsFileExtension=d.ts",
      "--outputFlat",
      "outDirectory"
    ])
    .it("writes types for typescript with a custom extension", () => {
      const files = fs.readdirSync("./outDirectory");
      const filePath = files.find(f => f === "SimpleQuery.d.ts");
      expect(filePath).toBeDefined();
      const file = fs.readFileSync(`./outDirectory/${filePath}`).toString();
      expect(file).toMatchSnapshot();
    });

  test
    .fs({
      "schema.json": fullSchemaJsonString,
      "clientSideSchema.graphql": clientSideSchema.toString(),
      "clientSideSchemaQuery.graphql": clientSideSchemaQuery.toString(),
      "my.config.js": defaultConfig
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=typescript",
      "--outputFlat",
      "__tmp__API.ts" // for some reason, this gets moved to root dir. naming __tmp__ to get .gitignore'd
    ])
    .it(
      "writes typescript types for query with client-side data when client schema in graphql file",
      () => {
        expect(fs.readFileSync("__tmp__API.ts").toString()).toMatchSnapshot();
      }
    );

  test
    .fs({
      "schema.json": fullSchemaJsonString,
      "clientSideSchemaTag.js": clientSideSchemaTag.toString(),
      "clientSideSchemaQuery.graphql": clientSideSchemaQuery.toString(),
      "my.config.js": `
        module.exports = {
          client: {
            includes: ["./**.graphql", "./**.js"], // include js file with schema in it
            service: { name: "my-service-name", localSchemaFile: "./schema.json" }
          }
        }
    `
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=typescript",
      "--outputFlat",
      "__tmp__API.ts" // for some reason, this gets moved to root dir. naming __tmp__ to get .gitignore'd
    ])
    .it(
      "writes typescript types for query with client-side data when client schema in js file",
      () => {
        expect(fs.readFileSync("__tmp__API.ts").toString()).toMatchSnapshot();
      }
    );

  // REMOVE?
  //   test
  //     .do(() => {
  //       vol.fromJSON({
  //         "schema.json": fullSchemaJsonString,
  //         "clientSideSchemaTag.js": clientSideSchemaTag.toString(),
  //         "clientSideSchemaQuery.graphql": clientSideSchemaQuery.toString(),
  //         "package.json": `
  //         {
  //           "apollo": {
  //             "schemas": {
  //               "serverSchema": {
  //                 "schema": "schema.json"
  //               },
  //               "default": {
  //                 "schema": "clientSideSchemaTag.js",
  //                 "extends": "serverSchema",
  //                 "clientSide": true
  //               }
  //             }
  //           }
  //         }
  //         `
  //       });
  //     })
  //     .command(["codegen:generate", "--outputFlat", "API.ts"])
  //     .it(
  //       "infers TypeScript target and writes types for query with client-side data with schema in a JS file from config",
  //       () => {
  //         expect(mockFS.readFileSync("API.ts").toString()).toMatchSnapshot();
  //       }
  //     );

  // QUESTION: is this test necessary? It's essentially the same as the rest, since we've been using a localSchemaFile for tests
  // and local schemas aren't any different than remote ones if you're not extending the remote types
  test
    .fs({
      "clientSideOnlySchema.graphql": clientSideOnlySchema.toString(),
      "clientSideOnlyQuery.graphql": clientSideOnlyQuery.toString(),
      "my.config.js": `
        module.exports = {
          client: {
            includes: ["./clientSideOnlyQuery.graphql"], // queries
            service: { name: "my-service-name", localSchemaFile: "./clientSideOnlySchema.graphql" }
          }
        }
    `
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=typescript",
      "--outputFlat",
      "__tmp__API.ts"
    ])
    .it("writes types for query with only client-side data", () => {
      expect(fs.readFileSync("__tmp__API.ts").toString()).toMatchSnapshot();
    });

  test
    .fs({
      "schema.json": fullSchemaJsonString,
      "queryOne.graphql": simpleQuery.toString(),
      "my.config.js": defaultConfig
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=flow",
      "--outputFlat",
      "__tmp__API.js"
    ])
    .it("writes flow types", () => {
      expect(fs.readFileSync("__tmp__API.js").toString()).toMatchSnapshot();
    });

  test
    .fs({
      "schema.json": fullSchemaJsonString,
      "queryOne.graphql": simpleQuery.toString(),
      "my.config.js": defaultConfig
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=flow",
      "--outputFlat",
      "--useFlowExactObjects",
      "__tmp__API.js"
    ])
    .it(
      "writes exact Flow types when the useFlowExactObjects flag is set",
      () => {
        expect(fs.readFileSync("__tmp__API.js").toString()).toMatchSnapshot();
      }
    );

  test
    .fs({
      "schema.json": fullSchemaJsonString,
      "queryOne.graphql": simpleQuery.toString(),
      "my.config.js": defaultConfig
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=flow",
      "--outputFlat",
      "--useFlowReadOnlyTypes",
      "__tmp__API.js"
    ])
    .it("writes read-only Flow types when the deprecated flag is set", () => {
      expect(fs.readFileSync("__tmp__API.js").toString()).toMatchSnapshot();
    });

  test
    .fs({
      "schema.json": fullSchemaJsonString,
      "queryOne.graphql": simpleQuery.toString(),
      "my.config.js": defaultConfig
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=flow",
      "--outputFlat",
      "--useReadOnlyTypes",
      "__tmp__API.js"
    ])
    .it("writes read-only Flow types when the flag is set", () => {
      expect(fs.readFileSync("__tmp__API.js").toString()).toMatchSnapshot();
    });

  test
    .fs({
      "schema.json": fullSchemaJsonString,
      "queryOne.graphql": simpleQuery.toString(),
      "my.config.js": defaultConfig
    })
    .command([
      "client:codegen",
      "--target=json",
      "--config=my.config.js",
      "__tmp__operations.json"
    ])
    .it("writes json operations", () => {
      const output = JSON.parse(
        fs.readFileSync("__tmp__operations.json").toString()
      );
      // have to overwrite filepath, since test directories change for every test
      output.operations[0].filePath = "";
      expect(output).toMatchSnapshot();
    });

  test
    .fs({
      "schema.json": fullSchemaJsonString,
      "queryOne.graphql": simpleQuery.toString(),
      "my.config.js": defaultConfig
    })
    .command([
      "client:codegen",
      "--target=json-modern",
      "--config=my.config.js",
      "__tmp__operations.json"
    ])
    .it("writes json operations with typeNode (json-modern)", () => {
      const output = JSON.parse(
        fs.readFileSync("__tmp__operations.json").toString()
      );
      // have to overwrite filepath, since test directories change for every test
      output.operations[0].filePath = "";
      expect(JSON.stringify(output)).toContain("typeNode");
      expect(output).toMatchSnapshot();
    });

  // TODO: fix UnhandledPromiseRejection
  test
    .skip()
    .fs({
      "schema.json": fullSchemaJsonString,
      "components/component.tsx": `
        const query = gql\`
          query SimpleQuery {
            hello
          }
        \`;
      `,
      "my.config.js": `
        module.exports = {
          client: {
            includes: ["./**.graphql", "./**/*.tsx"],
            service: { name: "my-service-name", localSchemaFile: "./schema.json" }
          }
        }
      `
    })
    .command(["client:codegen", "--target=typescript", "--config=my.config.js"])
    .it(
      "writes TypeScript types into a __generated__ directory next to sources when no output is set",
      () => {
        expect(
          fs
            .readFileSync("./components/__generated__/SimpleQuery.ts")
            .toString()
        ).toMatchSnapshot();
        expect(
          fs.readFileSync("./__generated__/globalTypes.ts").toString()
        ).toMatchSnapshot();
      }
    );

  // TODO: fix
  test
    .skip()
    .fs({
      "schema.json": fullSchemaJsonString,
      "components/component.jsx": `
        const query = gql\`
          query SimpleQuery {
            hello
          }
        \`;
      `,
      "my.config.js": `
        module.exports = {
          client: {
            includes: ["./**.graphql", "./**/*.jsx"],
            service: { name: "my-service-name", localSchemaFile: "./schema.json" }
          }
        }
      `
    })
    .command(["client:codegen", "--target=flow", "--config=my.config.js"])
    .it(
      "writes flow types into a __generated__ directory next to sources when no output is set",
      () => {
        expect(
          fs
            .readFileSync("./components/__generated__/SimpleQuery.js")
            .toString()
        ).toMatchSnapshot();
      }
    );

  // TODO: fix
  test
    .skip()
    .fs({
      "schema.json": fullSchemaJsonString,
      "components/component.tsx": `
        const query = gql\`
          query SimpleQuery {
            hello
          }
        \`;
      `,
      "my.config.js": `
        module.exports = {
          client: {
            includes: ["./**.graphql", "./**/*.tsx"],
            service: { name: "my-service-name", localSchemaFile: "./schema.json" }
          }
        }
      `
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=typescript",
      "__foo__"
    ])
    .it(
      "writes TypeScript types to a custom directory next to sources when output is set",
      () => {
        expect(
          fs.readFileSync("components/__foo__/SimpleQuery.ts").toString()
        ).toEqual();
        expect(fs.readFileSync("__foo__/globalTypes.ts").toString()).toEqual();
      }
    );

  // TODO: fix unhandled rejection
  test
    .skip()
    .fs({
      "schema.json": fullSchemaJsonString,
      "components/component.tsx": `
        const query = gql\`
          query SimpleQuery {
            someEnum
          }
        \`;
      `,
      "my.config.js": `
        module.exports = {
          client: {
            includes: ["./**.graphql", "./**/*.tsx"],
            service: { name: "my-service-name", localSchemaFile: "./schema.json" }
          }
        }
      `
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=typescript",
      "--globalTypesFile=__foo__/bar.ts"
    ])
    .it(
      "writes TypeScript global types to a custom path when globalTypesFile is set",
      () => {
        expect(
          fs.readFileSync("components/__generated__/SimpleQuery.ts").toString()
        ).toMatchSnapshot();
        expect(fs.readFileSync("__foo__/bar.ts").toString()).toMatchSnapshot();
      }
    );

  // fix
  test
    .skip()
    .fs({
      "schema.json": fullSchemaJsonString,
      "components/component.jsx": `
        const query = gql\`
          query SimpleQuery {
            hello
          }
        \`;
      `,
      "my.config.js": `
        module.exports = {
          client: {
            includes: ["./**.graphql", "./**/*.jsx"],
            service: { name: "my-service-name", localSchemaFile: "./schema.json" }
          }
        }
    `
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=flow",
      "__foo__"
    ])
    .it(
      "writes Flow types to a custom directory next to sources when output is set",
      () => {
        expect(
          fs.readFileSync("components/__foo__/SimpleQuery.js").toString()
        ).toMatchSnapshot();
      }
    );

  // fix
  test
    .skip()
    .fs({
      "schema.json": fullSchemaJsonString,
      "components/component.tsx": `
        const query = gql\`
          query SimpleQuery {
            hello
          }
        \`;
      `,
      "my.config.js": `
        module.exports = {
          client: {
            includes: ["./**.graphql", "./**/*.tsx"],
            service: { name: "my-service-name", localSchemaFile: "./schema.json" }
          }
        }
      `
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=typescript",
      ""
    ])
    .it(
      "writes TypeScript types next to sources when output is set to empty string",
      () => {
        expect(
          fs.readFileSync("components/SimpleQuery.ts").toString()
        ).toMatchSnapshot();
        expect(fs.readFileSync("globalTypes.ts").toString()).toMatchSnapshot();
      }
    );

  // fix
  test
    .skip()
    .fs({
      "schema.json": fullSchemaJsonString,
      "components/component.jsx": `
        const query = gql\`
          query SimpleQuery {
            hello
          }
        \`;
      `,
      "my.config.js": `
        module.exports = {
          client: {
            includes: ["./**.graphql", "./**/*.jsx"],
            service: { name: "my-service-name", localSchemaFile: "./schema.json" }
          }
        }
      `
    })
    .command(["client:codegen", "--config=my.config.js", "--target=flow", ""])
    .it(
      "writes flow types next to sources when output is set to empty string",
      () => {
        expect(
          fs.readFileSync("components/SimpleQuery.js").toString()
        ).toMatchSnapshot();
      }
    );

  test
    .fs({
      "schema.json": fullSchemaJsonString,
      "components/component.tsx": `
        const query = customGraphQLTag\`
          query SimpleQuery {
            hello
          }
        \`;
      `,
      "my.config.js": `
        module.exports = {
          client: {
            includes: ["./**/*.tsx"],
            service: { name: "my-service-name", localSchemaFile: "./schema.json" }
          }
        }
    `
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=typescript",
      "--tagName=customGraphQLTag",
      "--outputFlat"
    ])
    .it("extracts queries with a custom tagName provided as a flag", () => {
      expect(
        fs.readFileSync("__generated__/SimpleQuery.ts").toString()
      ).toMatchSnapshot();
    });

  test
    .fs({
      "schema.json": fullSchemaJsonString,
      "components/component.tsx": `
        const query = customGraphQLTag\`
          query SimpleQuery {
            hello
          }
        \`;
      `,
      "my.config.js": `
        module.exports = {
          client: {
            includes: ["./**/*.tsx"],
            service: { name: "my-service-name", localSchemaFile: "./schema.json" },
            tagName: 'customGraphQLTag'
          }
        }
    `
    })
    .command([
      "client:codegen",
      "--config=my.config.js",
      "--target=typescript",
      "--outputFlat"
    ])
    .it("extracts queries with a custom tagName provided in the config", () => {
      expect(
        fs.readFileSync("__generated__/SimpleQuery.ts").toString()
      ).toMatchSnapshot();
    });
});

describe("error handling", () => {
  test
    .fs(defaultFiles)
    .command(["client:codegen", "--config=my.config.js", "--target=foobar"])
    .catch(err => expect(err.message).toMatch(/Unsupported target: foobar/))
    .it("errors with an unsupported target");

  test
    .fs(defaultFiles)
    .command(["client:codegen", "--config=my.config.js", "--target=swift"])
    .catch(err =>
      expect(err.message).toMatch(/The output path must be specified/)
    )
    .it("errors when no output file is provided");

  test
    .fs(defaultFiles)
    .command(["client:codegen", "--config=my.config.js", "output-file"])
    .catch(err => expect(err.message).toMatch(/Missing required flag/))
    .it("errors when no target specified");

  test
    .fs({
      ...defaultFiles,
      "./errorQuery.graphql": errorQuery.toString()
    })
    .command(["client:codegen", "--config=my.config.js", "--target=typescript"])
    .catch(err => {
      const { message } = err;
      expect(message).toMatch(/Validation of GraphQL query document failed/);
      expect(message).toMatch(
        /Cannot query field "nosuchprop" on type "Query"/
      );
      expect(message).toMatch(/errorQuery\.graphql:2:3/);
    })
    .it("errors with an an invalid query");
});
