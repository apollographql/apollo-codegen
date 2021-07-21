import ServiceCheck, {
  formatHumanReadable,
  formatMarkdown,
  formatTimePeriod
} from "../check";
import checkSchemaResult from "../../../../__fixtures__/check-schema-result";
import { ChangeSeverity } from "apollo-language-server/lib/graphqlTypes";
import chalk from "chalk";
import { stdout } from "stdout-stderr";
import * as graphql from "graphql";
import { graphqlTypes } from "apollo-language-server";
import nock = require("nock");

/**
 * Single URL for all local requests to be mocked
 */
const localURL = "http://localhost:4000";

/**
 * Default API key. This is not an actual API key but a randomly generated string.
 *
 * If you need to use the `nock` recorder, then this will not work because we won't be able to access Apollo
 * with a fake API key.
 */
const fakeApiKey = "service:engine:9YC5AooMa2yO11eFlZat11";

/**
 * An array that we'll spread into all CLI commands to pass the Apollo api key.
 */
const cliKeyParameter = [`--key=${fakeApiKey}`];

/**
 * The original `console.log` being mocked.
 *
 * We save it so we can restore it after a test.
 */
let mockedConsoleLogOriginal: Console["log"] | null = null;

/**
 * Array of intercepted console values.
 */
let mockedConsoleLogValues: string[] | null = null;

// Get original CI environment variables
const { CI, CIRCLECI, GITHUB_ACTION, BUILD_BUILDURI } = process.env;

// TODO: the following two functions are identical to the ones found in list.test.ts
// we are choosing to duplicate them for now, because with a shared helper function,
// jest overwrites console log output as the tests are run in parallel

/**
 * Mock and capture `console.log` and `stdout.write`s. Return them in that order as a single string.
 *
 * This will emulate what the output of running the CLI would look like.
 *
 * Call `uncaptureApplicationOutput` to reverse the effects of this function.
 */
function captureApplicationOutput() {
  mockedConsoleLogOriginal = console["log"];
  mockedConsoleLogValues = [];
  console["log"] = jest.fn((...items) => {
    if (!mockedConsoleLogValues) {
      throw new Error(
        "mockedConsoleLogValues is not prepared but we're still capturing console.log. This means there's a bug somewhere."
      );
    }

    mockedConsoleLogValues.push(items.join(" "));
  });

  stdout.start();
}

/**
 * Reverse mocking of `console.log` and `stdout.write`. If they weren't mocked to begin with, this will do
 * nothing and return null.
 */
function uncaptureApplicationOutput(): string | null {
  // These will be `null` if we haven't mocked `console.log`.
  if (!mockedConsoleLogOriginal || !mockedConsoleLogValues) {
    return null;
  }

  const result = mockedConsoleLogValues.concat(stdout.output).join("\n");
  mockedConsoleLogValues = null;

  // Restore `console.log`
  console["log"] = mockedConsoleLogOriginal;

  // Stop capturing `stdout`.
  stdout.stop();

  return result;
}

/**
 * Convert a schema SDL to an introspection query result.
 *
 * @see https://blog.apollographql.com/three-ways-to-represent-your-graphql-schema-a41f4175100d
 *
 * @param schemaSdl string Schema in SDL form
 */
function sdlToIntrospectionQueryResult(schemaSdl: string) {
  return graphql.graphqlSync(
    graphql.buildSchema(schemaSdl),
    graphql.getIntrospectionQuery()
  ).data;
}

/**
 * Use `nock` to mock an `IntrospectionQuery`
 *
 * @param url string Root of the URL to mock; `/graphql` will automatically be appended
 * @param sdl SDL of the schema to mock
 */
function mockIntrospectionQuery() {
  nock(localURL, { encodedQueryParams: true })
    .post("/graphql", request => request.operationName === "IntrospectionQuery")
    .reply(200, {
      // The SDL doesn't actually get used because we'll be simulating network responses regardless of input,
      // so we just use a fake SDL.
      data: sdlToIntrospectionQueryResult(`type Query { me: ID }`)
    });
}

/**
 * Mock network requests for a successful schema composition. This includes the subsequent `CheckSchema`
 * request that will be made.
 */
function mockCompositionSuccess() {
  mockIntrospectionQuery();

  nock(localURL, {
    encodedQueryParams: true
  })
    .post(
      "/graphql",
      ({ operationName }) => operationName === "getFederationInfo"
    )
    .reply(200, {
      data: {
        _service: {
          sdl:
            'extend type Query {\n  me: User\n}\n\ntype User @key(fields: "id") {\n  name: String\n  username: String\n  birthDate: String\n}\n'
        }
      }
    });

  nock("https://engine-staging-graphql.apollographql.com:443", {
    encodedQueryParams: true
  })
    .post(
      "/api/graphql",
      ({ operationName }) => operationName === "CheckPartialSchema"
    )
    .reply(200, {
      data: {
        service: {
          checkPartialSchema: {
            compositionValidationResult: {
              compositionValidationDetails: {
                schemaHash:
                  "645fdd4b789fffb5c5b59443a12e6f575e61345e95fe9e1dae3fe9acb23c68efa8ac31ea657892f0a85d1c90d8503fe9e482f520fe8d9786ae26948de10ce4a6"
              },
              graphCompositionID: null,
              errors: []
            },
            checkSchemaResult: {
              targetUrl:
                "https://engine-staging.apollographql.com/service/justin-fullstack-tutorial/check/3acd7765-61b2-4f1a-9227-8b288e42bfdc",
              diffToPrevious: {
                severity: "NOTICE",
                affectedClients: [],
                affectedQueries: [],
                numberOfCheckedOperations: 0,
                changes: [
                  {
                    severity: "NOTICE",
                    code: "ARG_CHANGED_TYPE",
                    description:
                      "`Query.launches` argument `after` has changed type from `String` to `String!`"
                  }
                ],
                validationConfig: {
                  from: "-47347200",
                  to: "-0",
                  queryCountThreshold: 1,
                  queryCountThresholdPercentage: 0
                }
              }
            }
          }
        }
      }
    });

  nock("https://engine-staging-graphql.apollographql.com:443", {
    encodedQueryParams: true
  })
    .post(
      "/api/graphql",
      ({ operationName }) => operationName === "CheckSchema"
    )
    .reply(200, {
      data: {
        service: {
          checkSchema: {
            targetUrl:
              "https://engine-staging.apollographql.com/service/justin-fullstack-tutorial/check/3acd7765-61b2-4f1a-9227-8b288e42bfdc",
            diffToPrevious: {
              severity: "NOTICE",
              affectedClients: [],
              affectedQueries: [],
              numberOfCheckedOperations: 0,
              changes: [
                {
                  severity: "NOTICE",
                  code: "ARG_CHANGED_TYPE",
                  description:
                    "`Query.launches` argument `after` has changed type from `String` to `String!`"
                }
              ],
              validationConfig: {
                from: "-47347200",
                to: "-0",
                queryCountThreshold: 1,
                queryCountThresholdPercentage: 0
              }
            }
          }
        }
      }
    });
}

/**
 * Mock network requests for a non-federated schema check that produces errors.
 */
function mockNonFederatedFailure() {
  mockIntrospectionQuery();

  nock("https://engine-staging-graphql.apollographql.com:443", {
    encodedQueryParams: true
  })
    .post("/api/graphql", () => true)
    .reply(200, {
      data: {
        service: {
          checkSchema: {
            targetUrl:
              "https://engine-staging.apollographql.com/service/justin-fullstack-tutorial/check/3acd7765-61b2-4f1a-9227-8b288e42bfdc",
            diffToPrevious: {
              severity: "FAILURE",
              affectedClients: [],
              affectedQueries: [],
              numberOfCheckedOperations: 0,
              changes: [
                {
                  severity: "FAILURE",
                  code: "ARG_CHANGED_TYPE",
                  description:
                    "`Query.launches` argument `after` has changed type from `String` to `String!`"
                }
              ],
              validationConfig: {
                from: "-47347200",
                to: "-0",
                queryCountThreshold: 1,
                queryCountThresholdPercentage: 0
              }
            }
          }
        }
      }
    });
}

/**
 * Mock network requests for a non-federated schema check that produces no errors.
 */
function mockNonFederatedSuccess() {
  mockIntrospectionQuery();

  nock("https://engine-staging-graphql.apollographql.com:443", {
    encodedQueryParams: true
  })
    .post("/api/graphql", () => true)
    .reply(200, {
      data: {
        service: {
          checkSchema: {
            targetUrl:
              "https://engine-staging.apollographql.com/service/justin-fullstack-tutorial/check/3acd7765-61b2-4f1a-9227-8b288e42bfdc",
            diffToPrevious: {
              severity: "NOTICE",
              affectedClients: [],
              affectedQueries: [],
              numberOfCheckedOperations: 0,
              changes: [
                {
                  severity: "NOTICE",
                  code: "ARG_CHANGED_TYPE",
                  description:
                    "`Query.launches` argument `after` has changed type from `String` to `String!`"
                }
              ],
              validationConfig: {
                from: "-47347200",
                to: "-0",
                queryCountThreshold: 1,
                queryCountThresholdPercentage: 0
              }
            }
          }
        }
      }
    });
}

/**
 * Mock network requests for a federated schema running partialSchemaCheck and producing errors
 */
const mockPartialSchemaCheckFailure = () => {
  mockIntrospectionQuery();

  nock(localURL, {
    encodedQueryParams: true
  })
    .post(
      "/graphql",
      ({ operationName }) => operationName === "getFederationInfo"
    )
    .reply(200, {
      data: {
        _service: {
          sdl:
            'extend type Query {\n  me: User\n}\n\ntype User @key(fields: "id") {\n  name: String\n  username: String\n  birthDate: String\n}\n'
        }
      }
    });

  nock("https://engine-staging-graphql.apollographql.com:443", {
    encodedQueryParams: true
  })
    .post(
      "/api/graphql",
      ({ operationName }) => operationName === "CheckPartialSchema"
    )
    .reply(200, {
      data: {
        service: {
          checkPartialSchema: {
            compositionValidationResult: {
              compositionValidationDetails: {
                schemaHash: null
              },
              graphCompositionID: null,
              errors: [
                {
                  message:
                    "[reviews] User.id -> marked @external but it does not have a matching field on on the base service (accounts)"
                },
                {
                  message:
                    "[reviews] User -> A @key selects id, but User.id could not be found"
                },
                {
                  message:
                    "[accounts] User -> A @key selects id, but User.id could not be found"
                }
              ]
            },
            checkSchemaResult
          }
        }
      }
    });
};

describe("service:check", () => {
  let originalChalkEnabled;

  beforeEach(() => {
    originalChalkEnabled = chalk.enabled;
    chalk.enabled = false;

    // Clean console log capturing before tests in the event that `afterEach` was not run successfully.
    uncaptureApplicationOutput();

    // Clean up all network mocks before tests in the event that `afterEach` was not run successfully.
    nock.cleanAll();

    nock.disableNetConnect();

    delete process.env.CI;
    delete process.env.CIRCLECI;
    delete process.env.GITHUB_ACTION;
    delete process.env.BUILD_BUILDURI;

    // Set the jest timeout to be longer than the default 5000ms to compensate for slow CI.
    jest.setTimeout(25000);
  });

  afterEach(() => {
    chalk.enabled = originalChalkEnabled;

    // Clean up console log mocking
    uncaptureApplicationOutput();

    // Clean up all network mocks and restore original functionality
    nock.cleanAll();
    nock.enableNetConnect();

    process.env.CI = CI;
    process.env.CIRCLECI = CIRCLECI;
    process.env.GITHUB_ACTION = GITHUB_ACTION;
    process.env.BUILD_BUILDURI = BUILD_BUILDURI;
  });

  // These are integration tests and not e2e tests because these don't actually hit the remote server.
  describe("integration", () => {
    describe("federated", () => {
      describe("should report composition errors correctly", () => {
        it("vanilla", async () => {
          captureApplicationOutput();
          mockPartialSchemaCheckFailure();

          expect.assertions(2);

          await expect(
            ServiceCheck.run([
              ...cliKeyParameter,
              "--serviceName=accounts",
              `--endpoint=${localURL}/graphql`
            ])
          ).rejects.toThrow();

          // Inline snapshots don't work here due to https://github.com/facebook/jest/issues/6744.
          expect(uncaptureApplicationOutput()).toMatchSnapshot();
        });

        it("compacts output in CI", async () => {
          captureApplicationOutput();
          mockPartialSchemaCheckFailure();

          expect.assertions(2);

          process.env.CI = "true";

          await expect(
            ServiceCheck.run([
              ...cliKeyParameter,
              "--serviceName=accounts",
              `--endpoint=${localURL}/graphql`
            ])
          ).rejects.toThrow();

          // Inline snapshots don't work here due to https://github.com/facebook/jest/issues/6744.
          expect(uncaptureApplicationOutput()).toMatchSnapshot();
        });

        it("--markdown", async () => {
          captureApplicationOutput();
          mockPartialSchemaCheckFailure();

          expect.assertions(2);

          // markdown formatted output should throw
          await expect(
            ServiceCheck.run([
              ...cliKeyParameter,
              "--serviceName=accounts",
              `--endpoint=${localURL}/graphql`,
              "--markdown"
            ])
          ).rejects.toThrow();

          // Inline snapshots don't work here due to https://github.com/facebook/jest/issues/6744.
          expect(uncaptureApplicationOutput()).toMatchSnapshot();
        });

        it("--json", async () => {
          captureApplicationOutput();
          mockPartialSchemaCheckFailure();

          expect.assertions(2);

          // JSON formatted output should throw
          await expect(
            ServiceCheck.run([
              ...cliKeyParameter,
              "--serviceName=accounts",
              `--endpoint=${localURL}/graphql`,
              "--json"
            ])
          ).rejects.toThrow();

          // Inline snapshots don't work here due to https://github.com/facebook/jest/issues/6744.
          expect(uncaptureApplicationOutput()).toMatchSnapshot();
        });
      });

      describe("should report composition success correctly", () => {
        it("vanilla", async () => {
          captureApplicationOutput();
          mockCompositionSuccess();

          expect.assertions(2);

          await expect(
            ServiceCheck.run([
              ...cliKeyParameter,
              "--serviceName=accounts",
              `--endpoint=${localURL}/graphql`
            ])
          ).resolves.not.toThrow();

          // Inline snapshots don't work here due to https://github.com/facebook/jest/issues/6744.
          expect(uncaptureApplicationOutput()).toMatchSnapshot();
        });

        it("errors when graph flag does not match token", async () => {
          captureApplicationOutput();
          mockCompositionSuccess();

          expect.assertions(1);

          await expect(
            ServiceCheck.run([
              ...cliKeyParameter,
              "--serviceName=accounts",
              `--endpoint=${localURL}/graphql`,
              `--graph=happy-fun-times`
            ])
          ).rejects.toThrow(
            /Cannot specify a service token that does not match graph./
          );
        });

        it("allows setting graph with a flag", async () => {
          captureApplicationOutput();
          mockCompositionSuccess();

          expect.assertions(1);

          await expect(
            ServiceCheck.run([
              ...cliKeyParameter,
              "--serviceName=accounts",
              `--endpoint=${localURL}/graphql`,
              `--graph=happy-fun-times`,
              `--key=service:happy-fun-times:asldf89jaose9jroinc`
            ])
          ).resolves.not.toThrow();
        });

        it("compacts output in CI", async () => {
          captureApplicationOutput();
          mockCompositionSuccess();

          expect.assertions(2);

          process.env.CI = "true";

          await expect(
            ServiceCheck.run([
              ...cliKeyParameter,
              "--serviceName=accounts",
              `--endpoint=${localURL}/graphql`
            ])
          ).resolves.not.toThrow();

          // Inline snapshots don't work here due to https://github.com/facebook/jest/issues/6744.
          expect(uncaptureApplicationOutput()).toMatchSnapshot();
        });

        it("--markdown", async () => {
          captureApplicationOutput();
          mockCompositionSuccess();

          expect.assertions(2);

          await expect(
            ServiceCheck.run([
              ...cliKeyParameter,
              "--serviceName=accounts",
              `--endpoint=${localURL}/graphql`,
              "--markdown"
            ])
          ).resolves.not.toThrow();

          // Inline snapshots don't work here due to https://github.com/facebook/jest/issues/6744.
          expect(uncaptureApplicationOutput()).toMatchSnapshot();
        });

        it("--json", async () => {
          captureApplicationOutput();
          mockCompositionSuccess();

          expect.assertions(2);

          await expect(
            ServiceCheck.run([
              ...cliKeyParameter,
              "--serviceName=accounts",
              `--endpoint=${localURL}/graphql`,
              "--json"
            ])
          ).resolves.not.toThrow();

          // Inline snapshots don't work here due to https://github.com/facebook/jest/issues/6744.
          expect(uncaptureApplicationOutput()).toMatchSnapshot();
        });
      });
    });

    describe("non-federated", () => {
      describe("should report traffic errors correctly", () => {
        it("vanilla", async () => {
          captureApplicationOutput();
          mockNonFederatedFailure();
          expect.assertions(2);

          await expect(
            ServiceCheck.run([...cliKeyParameter])
          ).rejects.toThrow();

          // Inline snapshots don't work here due to https://github.com/facebook/jest/issues/6744.
          expect(uncaptureApplicationOutput()).toMatchSnapshot();
        });

        it("--markdown", async () => {
          captureApplicationOutput();
          mockNonFederatedFailure();
          expect.assertions(2);

          // markdown formatted output should throw
          await expect(
            ServiceCheck.run([...cliKeyParameter, "--markdown"])
          ).rejects.toThrow();

          // Inline snapshots don't work here due to https://github.com/facebook/jest/issues/6744.
          expect(uncaptureApplicationOutput()).toMatchSnapshot();
        });

        it("--json", async () => {
          captureApplicationOutput();
          mockNonFederatedFailure();
          expect.assertions(2);

          // JSON formatted output should throw
          await expect(
            ServiceCheck.run([...cliKeyParameter, "--json"])
          ).rejects.toThrow();

          // Inline snapshots don't work here due to https://github.com/facebook/jest/issues/6744.
          expect(uncaptureApplicationOutput()).toMatchSnapshot();
        });
      });

      describe("should report traffic non-errors correctly", () => {
        it("vanilla", async () => {
          captureApplicationOutput();
          mockNonFederatedSuccess();
          expect.assertions(2);

          await expect(
            ServiceCheck.run([...cliKeyParameter])
          ).resolves.not.toThrow();

          // Inline snapshots don't work here due to https://github.com/facebook/jest/issues/6744.
          expect(uncaptureApplicationOutput()).toMatchSnapshot();
        });

        it("--markdown", async () => {
          captureApplicationOutput();
          mockNonFederatedSuccess();
          expect.assertions(2);

          await expect(
            ServiceCheck.run([...cliKeyParameter, "--markdown"])
          ).resolves.not.toThrow();

          // Inline snapshots don't work here due to https://github.com/facebook/jest/issues/6744.
          expect(uncaptureApplicationOutput()).toMatchSnapshot();
        });

        it("--json", async () => {
          captureApplicationOutput();
          mockNonFederatedSuccess();
          expect.assertions(2);

          await expect(
            ServiceCheck.run([...cliKeyParameter, "--json"])
          ).resolves.not.toThrow();

          // Inline snapshots don't work here due to https://github.com/facebook/jest/issues/6744.
          expect(uncaptureApplicationOutput()).toMatchSnapshot();
        });
      });
    });
  });

  describe("markdown formatting", () => {
    it("is correct with breaking changes", () => {
      expect(
        formatMarkdown({
          graphName: "engine",
          tag: "staging",
          checkSchemaResult,
          graphCompositionID: "fff"
        })
      ).toMatchSnapshot();
      // Check when all the values are singluar
      expect(
        formatMarkdown({
          graphName: "engine",
          tag: "staging",
          checkSchemaResult: {
            ...checkSchemaResult,
            diffToPrevious: {
              ...checkSchemaResult.diffToPrevious,
              affectedClients: [
                checkSchemaResult.diffToPrevious.affectedClients[0]
              ],
              affectedQueries: [
                checkSchemaResult.diffToPrevious.affectedQueries[0]
              ],
              changes: [
                checkSchemaResult.diffToPrevious.changes.find(
                  change => change.severity === ChangeSeverity.FAILURE
                )
              ],
              numberOfCheckedOperations: 1
            }
          },
          graphCompositionID: "fff"
        })
      ).toMatchSnapshot();
    });

    it("is correct with no breaking changes", () => {
      expect(
        formatMarkdown({
          graphName: "engine",
          tag: "staging",
          checkSchemaResult: {
            ...checkSchemaResult,
            diffToPrevious: {
              ...checkSchemaResult.diffToPrevious,
              severity: ChangeSeverity.NOTICE,
              affectedClients: [],
              affectedQueries: [],
              changes: [
                {
                  __typename: "Change",
                  code: "FIELD_ADDED",
                  severity: ChangeSeverity.NOTICE
                } as graphqlTypes.CheckSchema_service_checkSchema_diffToPrevious_changes
              ]
            }
          },
          graphCompositionID: "fff"
        })
      ).toMatchSnapshot();
    });

    it("is correct with no changes", () => {
      expect(
        formatMarkdown({
          graphName: "engine",
          tag: "staging",
          checkSchemaResult: {
            ...checkSchemaResult,
            diffToPrevious: {
              ...checkSchemaResult.diffToPrevious,
              severity: ChangeSeverity.NOTICE,
              affectedClients: [],
              affectedQueries: [],
              changes: [],
              validationConfig: null
            }
          },
          graphCompositionID: "fff"
        })
      ).toMatchSnapshot();
    });
  });

  describe("formatTimePeriod", () => {
    it("should show current result for 1 hour", () => {
      expect(formatTimePeriod(1)).toMatchInlineSnapshot(`"1 hour"`);
    });

    it("should show current result for 12 hours", () => {
      expect(formatTimePeriod(12)).toMatchInlineSnapshot(`"12 hours"`);
    });

    it("should show current result for 24 hours", () => {
      expect(formatTimePeriod(24)).toMatchInlineSnapshot(`"24 hours"`);
    });

    it("should show current result for 36 hours", () => {
      expect(formatTimePeriod(36)).toMatchInlineSnapshot(`"1 day"`);
    });

    it("should show current result for 48 hours", () => {
      expect(formatTimePeriod(48)).toMatchInlineSnapshot(`"2 days"`);
    });
  });

  describe("formatHumanReadable", () => {
    it("should have correct output with breaking and non-breaking changes", () => {
      expect(
        formatHumanReadable({
          checkSchemaResult,
          graphCompositionID: "fff"
        })
      ).toMatchSnapshot();
    });

    it("should have correct output with only non-breaking changes", () => {
      expect(
        formatHumanReadable({
          checkSchemaResult: {
            ...checkSchemaResult,
            diffToPrevious: {
              ...checkSchemaResult.diffToPrevious,
              severity: ChangeSeverity.NOTICE,
              affectedQueries: [],
              changes: []
            }
          },
          graphCompositionID: "fff"
        })
      ).toMatchSnapshot();
    });

    it("should have correct output with only breaking changes", () => {
      expect(
        formatHumanReadable({
          checkSchemaResult: {
            ...checkSchemaResult,
            diffToPrevious: {
              ...checkSchemaResult.diffToPrevious,
              severity: ChangeSeverity.NOTICE,
              affectedQueries: [],
              changes: checkSchemaResult.diffToPrevious.changes.filter(
                change => change.severity === ChangeSeverity.FAILURE
              )
            }
          },
          graphCompositionID: "fff"
        })
      ).toMatchSnapshot();
    });
  });
});

//TODO: Turn these tests back on
// jest.mock("apollo-codegen-core/lib/localfs", () => {
//   return require("../../../__mocks__/localfs");
// });

// // this is because of herkou-cli-utils hacky mocking system on their console logger
// import { stdout, captureApplicationOutput } from "heroku-cli-util";
// import path from "path";
// import fs from "fs";
// import { test as setup } from "apollo-cli-test";
// import { introspectionQuery, print, execute, buildSchema } from "graphql";
// import gql from "graphql-tag";
// import { ENGINE_URI } from "../../../engine";
// import { VALIDATE_SCHEMA } from "../../../operations/validateSchema";

// import { vol, fs as mockFS } from "apollo-codegen-core/lib/localfs";

// const test = setup.do(() => captureApplicationOutput());
// const APOLLO_KEY = "service:test:1234";
// const hash = "12345";
// const schemaContents = fs.readFileSync(
//   path.resolve(__dirname, "./fixtures/schema.graphql"),
//   {
//     encoding: "utf-8"
//   }
// );

// const fullSchema = execute(buildSchema(schemaContents), gql(introspectionQuery))
//   .data;

// const localSuccess = nock => {
//   nock
//     .post("/graphql", {
//       query: print(gql(introspectionQuery)),
//       operationName: "IntrospectionQuery",
//       variables: {}
//     })
//     .reply(200, { data: fullSchema });
// };

// const engineSuccess = ({ schema, tag, results } = {}) => nock => {
//   nock
//     .matchHeader("x-api-key", APOLLO_KEY)
//     .post("/", {
//       operationName: "CheckSchema",
//       variables: {
//         id: "test",
//         schema: schema || fullSchema.__schema,
//         tag: tag || "current",
//         gitContext: {
//           commit: /.+/i,
//           remoteUrl: /apollo-tooling/i,
//           committer: /@/i
//         }
//       },
//       query: print(VALIDATE_SCHEMA)
//     })
//     .reply(200, {
//       data: {
//         service: {
//           schema: {
//             checkSchema: {
//               changes: results || [
//                 {
//                   severity: "NOTICE",
//                   code: "DEPRECATION_ADDED",
//                   description: "Field `User.lastName` was deprecated"
//                 },
//                 {
//                   severity: "WARNING",
//                   code: "FIELD_REMOVED",
//                   description: "Field `User.firstName` removed"
//                 },
//                 {
//                   severity: "FAILURE",
//                   code: "ARG_CHANGE_TYPE",
//                   description: "Argument id on `Query.user` changed to ID!"
//                 },
//                 {
//                   severity: "NOTICE",
//                   code: "FIELD_ADDED",
//                   description: "Field `User.fullName` was added"
//                 }
//               ]
//             }
//           }
//         }
//       }
//     });
// };

// jest.setTimeout(25000);

// beforeEach(() => {
//   vol.reset();
//   vol.fromJSON({
//     __blankFileSoDirectoryExists: ""
//   });
// });

// describe("successful checks", () => {
//   test
//     .nock("http://localhost:4000", localSuccess)
//     .nock(ENGINE_URI, engineSuccess())
//     .env({ APOLLO_KEY })
//     .stdout()
//     .command(["schema:check"])
//     .exit(1)
//     .it("compares against the latest uploaded schema", () => {
//       expect(stdout).toContain("FAILURE");
//       expect(stdout).toContain("NOTICE");
//       expect(stdout).toContain("WARNING");
//     });

//   test
//     .nock("http://localhost:4000", localSuccess)
//     .nock(ENGINE_URI, engineSuccess())
//     .stdout()
//     .command(["schema:check", `--key=${APOLLO_KEY}`])
//     .exit(1)
//     .it("allows custom api key", () => {
//       expect(stdout).toContain("FAILURE");
//       expect(stdout).toContain("NOTICE");
//       expect(stdout).toContain("WARNING");
//     });

//   test
//     .nock("http://localhost:4000", localSuccess)
//     .nock(ENGINE_URI, engineSuccess({ results: [] }))
//     .env({ APOLLO_KEY })
//     .stdout()
//     .command(["schema:check"])
//     .it(
//       "compares against the latest uploaded schema with no change",
//       ({ stdout }) => {
//         expect(stdout).toContain("No changes");
//       }
//     );

//   test
//     .stdout()
//     .nock("https://staging.example.com", localSuccess)
//     .nock(ENGINE_URI, engineSuccess())
//     .env({ APOLLO_KEY })
//     .command(["schema:check", "--endpoint=https://staging.example.com/graphql"])
//     .exit(1)
//     .it("compares against a schema from a custom remote", () => {
//       expect(stdout).toContain("FAILURE");
//       expect(stdout).toContain("NOTICE");
//       expect(stdout).toContain("WARNING");
//     });

//   test
//     .stdout()
//     .nock("http://localhost:4000", localSuccess)
//     .nock(
//       "https://engine.example.com",
//       engineSuccess({ engine: "https://engine.example.com" })
//     )
//     .env({ APOLLO_KEY })
//     .command(["schema:check", "--engine=https://engine.example.com"])
//     .exit(1)
//     .it("compares against a schema from a custom registry", std => {
//       expect(stdout).toContain("FAILURE");
//       expect(stdout).toContain("NOTICE");
//       expect(stdout).toContain("WARNING");
//     });

//   test
//     .stdout()
//     .nock("https://staging.example.com", nock => {
//       nock
//         .matchHeader("Authorization", "1234")
//         .matchHeader("Hello", "World")
//         .post("/graphql", {
//           query: print(gql(introspectionQuery)),
//           operationName: "IntrospectionQuery",
//           variables: {}
//         })
//         .reply(200, { data: fullSchema });
//     })
//     .nock(ENGINE_URI, engineSuccess())
//     .env({ APOLLO_KEY })
//     .command([
//       "schema:check",
//       "--endpoint=https://staging.example.com/graphql",
//       "--header=Authorization: 1234",
//       "--header=Hello: World"
//     ])
//     .exit(1)
//     .it(
//       "calls engine with a schema from a custom remote with custom headers",
//       () => {
//         expect(stdout).toContain("FAILURE");
//         expect(stdout).toContain("NOTICE");
//         expect(stdout).toContain("WARNING");
//       }
//     );

//   test
//     .do(() =>
//       vol.fromJSON({
//         "introspection-result.json": JSON.stringify({ data: fullSchema })
//       })
//     )
//     .stdout()
//     .nock(ENGINE_URI, engineSuccess())
//     .env({ APOLLO_KEY })
//     .command(["schema:check", "--endpoint=introspection-result.json"])
//     .exit(1)
//     .it(
//       "calls engine with a schema from an introspection result on the filesystem",
//       () => {
//         expect(stdout).toContain("FAILURE");
//         expect(stdout).toContain("NOTICE");
//         expect(stdout).toContain("WARNING");
//       }
//     );

//   test
//     .do(() =>
//       vol.fromJSON({
//         "schema.graphql": schemaContents
//       })
//     )
//     .stdout()
//     .nock(ENGINE_URI, engineSuccess({ schema: fullSchema.__schema }))
//     .env({ APOLLO_KEY })
//     .command(["schema:check", "--endpoint=schema.graphql"])
//     .exit(1)
//     .it(
//       "calls engine with a schema from a schema file on the filesystem",
//       () => {
//         expect(stdout).toContain("FAILURE");
//         expect(stdout).toContain("NOTICE");
//         expect(stdout).toContain("WARNING");
//       }
//     );

//   test
//     .nock("http://localhost:4000", localSuccess)
//     .nock(ENGINE_URI, engineSuccess())
//     .env({ APOLLO_KEY })
//     .stdout()
//     .command(["schema:check", "--json"])
//     .exit(1)
//     .it("allows formatting success as JSON", () => {
//       expect(stdout).toContain('"severity": "FAILURE"');
//     });
// });

// describe("error handling", () => {
//   test
//     .command(["schema:check"])
//     .catch(err => expect(err.message).toMatch(/No API key/))
//     .it("errors with no service API key");
// });
