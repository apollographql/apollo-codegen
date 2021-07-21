import { flags } from "@oclif/command";
import { table } from "table";
import { GraphQLSchema, introspectionFromSchema, printSchema } from "graphql";
import chalk from "chalk";
import envCi from "env-ci";
import { gitInfo } from "../../git";
import { ProjectCommand } from "../../Command";
import {
  CompactRenderer,
  pluralize,
  validateHistoricParams
} from "../../utils";
import {
  ChangeSeverity,
  CheckPartialSchema_service_checkPartialSchema_checkSchemaResult,
  CheckSchema_service_checkSchema,
  CheckSchema_service_checkSchema_diffToPrevious_changes as Change,
  CheckSchemaVariables,
  IntrospectionSchemaInput
} from "apollo-language-server/lib/graphqlTypes";
import { ApolloConfig } from "apollo-language-server";
import moment from "moment";
import sortBy from "lodash.sortby";
import { graphUndefinedError } from "../../utils/sharedMessages";

const formatChange = (change: Change) => {
  let color = (x: string): string => x;
  if (change.severity === ChangeSeverity.FAILURE) {
    color = chalk.red;
  }

  const changeDictionary: Record<ChangeSeverity, string> = {
    [ChangeSeverity.FAILURE]: "FAIL",
    [ChangeSeverity.NOTICE]: "PASS"
  };

  return {
    severity: color(changeDictionary[change.severity]),
    code: color(change.code),
    description: color(change.description)
  };
};

export function formatTimePeriod(hours: number): string {
  if (hours <= 24) {
    return pluralize(hours, "hour");
  }

  return pluralize(Math.floor(hours / 24), "day");
}

type CompositionErrors = Array<{
  service?: string;
  field?: string;
  message: string;
}>;

interface TasksOutput {
  config: ApolloConfig;
  checkSchemaResult:
    | CheckSchema_service_checkSchema
    | CheckPartialSchema_service_checkPartialSchema_checkSchemaResult;
  shouldOutputJson: boolean;
  shouldOutputMarkdown: boolean;
  shouldAlwaysExit0: boolean;
  federationSchemaHash?: string;
  serviceName: string | undefined;
  compositionErrors?: CompositionErrors;
  graphCompositionID?: string;
}

export function formatMarkdown({
  checkSchemaResult,
  graphName,
  serviceName,
  tag,
  graphCompositionID
}: {
  checkSchemaResult: CheckSchema_service_checkSchema;
  graphName: string;
  serviceName?: string | undefined;
  tag: string;
  // this will only exist for federated schema check
  graphCompositionID: string | undefined;
}): string {
  const { diffToPrevious } = checkSchemaResult;

  if (!diffToPrevious) {
    throw new Error("checkSchemaResult.diffToPrevious missing");
  }

  const { validationConfig } = diffToPrevious;

  let validationText = "";
  if (validationConfig) {
    // The validationConfig will always return a negative number. Use Math.abs to make it positive.
    const hours = Math.abs(
      moment()
        .add(validationConfig.from, "second")
        .diff(moment().add(validationConfig.to, "second"), "hours")
    );

    validationText = `🔢 Compared **${pluralize(
      diffToPrevious.changes.length,
      "schema change"
    )}** against **${pluralize(
      diffToPrevious.numberOfCheckedOperations,
      "operation"
    )}** seen over the **last ${formatTimePeriod(hours)}**.`;
  }

  const breakingChanges = diffToPrevious.changes.filter(
    change => change.severity === "FAILURE"
  );

  const affectedQueryCount = diffToPrevious.affectedQueries
    ? diffToPrevious.affectedQueries.length
    : 0;

  return `
### Apollo Service Check
🔄 Validated your local schema against metrics from variant \`${tag}\` ${
    serviceName ? `for graph \`${serviceName}\` ` : ""
  }on graph \`${graphName}@${tag}\`.
${validationText}
${
  breakingChanges.length > 0
    ? `❌ Found **${pluralize(
        diffToPrevious.changes.filter(change => change.severity === "FAILURE")
          .length,
        "breaking change"
      )}** that would affect **${pluralize(
        affectedQueryCount,
        "operation"
      )}** across **${pluralize(
        diffToPrevious.affectedClients && diffToPrevious.affectedClients.length,
        "client"
      )}**`
    : diffToPrevious.changes.length === 0
    ? `✅ Found **no changes**.`
    : `✅ Found **no breaking changes**.`
}

🔗 [View your service check details](${checkSchemaResult.targetUrl +
    (graphCompositionID ? `?graphCompositionId=${graphCompositionID})` : `)`)}.
`;
}

export function formatCompositionErrorsMarkdown({
  compositionErrors,
  graphName,
  serviceName,
  tag
}: {
  compositionErrors: CompositionErrors;
  graphName: string;
  serviceName: string;
  tag: string;
}): string {
  return `
### Apollo Service Check
🔄 Validated graph composition for service \`${serviceName}\` on graph \`${graphName}@${tag}\`.
❌ Found **${compositionErrors.length} composition errors**

| Service   | Field     | Message   |
| --------- | --------- | --------- |
${compositionErrors
  .map(
    ({ service, field, message }) => `| ${service} | ${field} | ${message} |`
  )
  .join("\n")}
`;
}

export function formatHumanReadable({
  checkSchemaResult,
  graphCompositionID
}: {
  checkSchemaResult: CheckSchema_service_checkSchema;
  // this will only exist for federated schema check
  graphCompositionID: string | undefined;
}): string {
  const {
    targetUrl,
    diffToPrevious: { changes }
  } = checkSchemaResult;
  let result = "";

  if (changes.length === 0) {
    result = "\nNo changes present between schemas";
  } else {
    // Create a sorted list of the changes. We'll then filter values from the sorted list, resulting in sorted
    // filtered lists.
    const sortedChanges = sortBy<typeof changes[0]>(changes, [
      change => change.code,
      change => change.description
    ]);

    const breakingChanges = sortedChanges.filter(
      change => change.severity === ChangeSeverity.FAILURE
    );

    sortBy(breakingChanges, change => change.severity);

    const nonBreakingChanges = sortedChanges.filter(
      change => change.severity !== ChangeSeverity.FAILURE
    );

    result += table([
      ["Change", "Code", "Description"],
      ...[
        ...breakingChanges.map(formatChange).map(Object.values),
        // Add an empty line between, but only if there are both breaking changes and non-breaking changes.
        // nonBreakingChanges.length && breakingChanges.length ? {} : null,
        ...nonBreakingChanges.map(formatChange).map(Object.values)
      ].filter(Boolean)
    ]);
  }

  if (targetUrl) {
    result += `\n\nView full details at: ${targetUrl}${
      graphCompositionID ? `?graphCompositionId=${graphCompositionID}` : ``
    }`;
  }

  return result;
}

export default class ServiceCheck extends ProjectCommand {
  static aliases = ["schema:check"];
  static description =
    "[DEPRECATED] Check a service against known operation workloads to find breaking changes" +
    ProjectCommand.DEPRECATION_MSG;
  static flags = {
    ...ProjectCommand.flags,
    tag: flags.string({
      char: "t",
      description:
        "[Deprecated: please use --variant instead] The tag (AKA variant) to check the proposed schema against",
      hidden: true,
      exclusive: ["variant"]
    }),
    variant: flags.string({
      char: "v",
      description: "The variant to check the proposed schema against",
      exclusive: ["tag"]
    }),
    graph: flags.string({
      char: "g",
      description:
        "The ID of the graph in Apollo to check your proposed schema changes against. Overrides config file if set."
    }),
    branch: flags.string({
      description: "The branch name to associate with this check"
    }),
    commitId: flags.string({
      description: "The SHA-1 hash of the commit to associate with this check"
    }),
    author: flags.string({
      description: "The author to associate with this proposed schema"
    }),
    validationPeriod: flags.string({
      description:
        "The size of the time window with which to validate the schema against. You may provide a number (in seconds), or an ISO8601 format duration for more granularity (see: https://en.wikipedia.org/wiki/ISO_8601#Durations)"
    }),
    queryCountThreshold: flags.integer({
      description:
        "Minimum number of requests within the requested time window for a query to be considered."
    }),
    queryCountThresholdPercentage: flags.integer({
      description:
        "Number of requests within the requested time window for a query to be considered, relative to total request count. Expected values are between 0 and 0.05 (minimum 5% of total request volume)"
    }),
    json: flags.boolean({
      description:
        "Output result in json, which can then be parsed by CLI tools such as jq.",
      exclusive: ["markdown"]
    }),
    localSchemaFile: flags.string({
      description:
        "Path to one or more local GraphQL schema file(s), as introspection result or SDL. Supports comma-separated list of paths (ex. `--localSchemaFile=schema.graphql,extensions.graphql`)"
    }),
    markdown: flags.boolean({
      description: "Output result in markdown.",
      exclusive: ["json"]
    }),
    serviceName: flags.string({
      description:
        "Provides the name of the implementing service for a federated graph. This flag will indicate that the schema is a partial schema from a federated service"
    }),
    ignoreFailures: flags.boolean({
      description:
        "Exit with status 0 when the check completes, even if errors are found"
    })
  };

  async run() {
    this.printDeprecationWarning();

    // @ts-ignore we're going to populate `taskOutput` later
    const taskOutput: TasksOutput = {};

    // Define this constant so we can throw it and compare against the same value.
    const breakingChangesErrorMessage = "breaking changes found";
    const federatedServiceCompositionUnsuccessfulErrorMessage =
      "Federated service composition was unsuccessful. Please see the reasons below.";

    const { isCi } = envCi();

    let schema: GraphQLSchema | undefined;
    let graphID: string | undefined;
    let graphVariant: string | undefined;
    try {
      await this.runTasks<TasksOutput>(
        ({ config, flags, project }) => {
          /**
           * Name of the graph being checked. `engine` is an example of a graph.
           *
           * A graph can be either a monolithic schema or the result of composition a federated schema.
           */
          graphID = config.graph;
          graphVariant = config.variant;

          /**
           * Name of the implementing service being checked.
           *
           * This is optional because this check can be run on a graph or on an implementing service.
           */
          const serviceName: string | undefined = flags.serviceName;

          if (!graphID) {
            throw graphUndefinedError;
          }
          const graphSpecifier = `${graphID}@${graphVariant}`;

          // Add some fields to output that are required for post-processing
          taskOutput.shouldOutputJson = !!flags.json;
          taskOutput.shouldOutputMarkdown = !!flags.markdown;
          taskOutput.shouldAlwaysExit0 = !!flags.ignoreFailures;
          taskOutput.serviceName = flags.serviceName;
          taskOutput.config = config;

          return [
            {
              enabled: () => !!serviceName,
              title: `Validate graph composition for service ${chalk.cyan(
                serviceName || ""
              )} on graph ${chalk.cyan(graphSpecifier)}`,
              task: async (ctx: TasksOutput, task) => {
                if (!serviceName) {
                  throw new Error(
                    "This task should not be run without a `serviceName`. Check the `enabled` function."
                  );
                }
                task.output = "Fetching local service's partial schema";

                const sdl = await project.resolveFederatedServiceSDL();
                if (!sdl) {
                  throw new Error("No SDL found for federated service");
                }

                task.output = `Attempting to compose graph with ${chalk.cyan(
                  serviceName
                )} service's partial schema`;

                const historicParameters = validateHistoricParams({
                  validationPeriod: flags.validationPeriod,
                  queryCountThreshold: flags.queryCountThreshold,
                  queryCountThresholdPercentage:
                    flags.queryCountThresholdPercentage
                });

                const gitInfoFromEnv = await gitInfo(this.log);

                const {
                  compositionValidationResult,
                  checkSchemaResult
                } = await project.engine.checkPartialSchema({
                  id: graphID!,
                  graphVariant: graphVariant!,
                  implementingServiceName: serviceName,
                  partialSchema: {
                    sdl
                  },
                  ...(historicParameters && { historicParameters }),
                  gitContext: {
                    ...gitInfoFromEnv,
                    ...(flags.author ? { committer: flags.author } : undefined),
                    ...(flags.branch ? { branch: flags.branch } : undefined),
                    ...(flags.commitId ? { commit: flags.commitId } : undefined)
                  }
                });

                task.title = `Found ${pluralize(
                  compositionValidationResult.errors.length,
                  "graph composition error"
                )} for service ${chalk.cyan(serviceName)} on graph ${chalk.cyan(
                  graphSpecifier
                )}`;

                if (compositionValidationResult.errors.length > 0) {
                  taskOutput.compositionErrors = compositionValidationResult.errors
                    .filter(isNotNullOrUndefined)
                    .map(error => {
                      // checks for format: [serviceName] Location -> Error Message
                      const match = error.message.match(
                        /^\[([^\[]+)\]\s+(\S+)\ ->\ (.+)/
                      );

                      if (!match) {
                        // If we can't match the errors, that means they're in a format we don't recognize.
                        // Report the entire string as the user will see the raw message.
                        return { message: error.message };
                      }

                      // Regular expression matches return `[entireStringMatched, ...eachGroup]`; we don't
                      // care about the entire string match, only the groups, so ignore the first value in the
                      // tuple.
                      const [, service, field, message] = match;
                      return { service, field, message };
                    });
                  taskOutput.graphCompositionID =
                    compositionValidationResult.graphCompositionID;

                  this.error(
                    federatedServiceCompositionUnsuccessfulErrorMessage
                  );
                } else {
                  if (!checkSchemaResult) {
                    throw new Error(
                      "Violated invariant. Schema should have been validated against operations if" +
                        "there were no composition errors"
                    );
                  }

                  // this is used for the printing
                  taskOutput.checkSchemaResult = checkSchemaResult;

                  // this is used for the next step in the `run` command (comparing schema changes)
                  ctx.checkSchemaResult = checkSchemaResult;
                }
              }
            },
            {
              title: `Validating ${
                serviceName ? "composed " : ""
              }schema against metrics from variant ${chalk.cyan(
                graphVariant!
              )} on graph ${chalk.cyan(graphSpecifier)}`,
              // We have already performed validation per operation above if the service is federated
              enabled: () => !serviceName,
              task: async (ctx: TasksOutput, task) => {
                let schemaCheckSchemaVariables:
                  | { schemaHash: string }
                  | { schema: IntrospectionSchemaInput }
                  | undefined;

                // This is _not_ a `federated` schema. Resolve the schema given `config.variant`.
                task.output = "Resolving schema";
                schema = await project.resolveSchema({ tag: config.variant });
                if (!schema) {
                  throw new Error("Failed to resolve schema");
                }

                schemaCheckSchemaVariables = {
                  schema: introspectionFromSchema(schema)
                    .__schema as IntrospectionSchemaInput
                };

                const historicParameters = validateHistoricParams({
                  validationPeriod: flags.validationPeriod,
                  queryCountThreshold: flags.queryCountThreshold,
                  queryCountThresholdPercentage:
                    flags.queryCountThresholdPercentage
                });

                task.output = "Validating schema";

                const gitInfoFromEnv = await gitInfo(this.log);

                const variables: CheckSchemaVariables = {
                  id: graphID!,
                  tag: config.variant,
                  gitContext: {
                    ...gitInfoFromEnv,
                    ...(flags.committer
                      ? { committer: flags.committer }
                      : undefined),
                    ...(flags.branch ? { branch: flags.branch } : undefined)
                  },
                  ...(historicParameters && { historicParameters }),
                  ...schemaCheckSchemaVariables
                };

                const { schema: _, ...restVariables } = variables;
                this.debug("Variables sent to Apollo:");
                this.debug(restVariables);
                if (schema) {
                  this.debug("SDL of introspection sent to Apollo:");
                  this.debug(printSchema(schema));
                } else {
                  this.debug("Schema hash generated:");
                  this.debug(schemaCheckSchemaVariables);
                }

                const checkSchemaResult = await project.engine.checkSchema(
                  variables
                );
                // Attach to ctx as this will be used in later steps.
                ctx.checkSchemaResult = checkSchemaResult;
                // Save the output because we're going to use it even if we throw. `runTasks` won't return
                // anything if we throw.
                taskOutput.checkSchemaResult = checkSchemaResult;

                task.title = task.title.replace("Validating", "Validated");
              }
            },
            {
              title: "Comparing schema changes",
              task: async (ctx: TasksOutput, task) => {
                const schemaChanges =
                  ctx.checkSchemaResult.diffToPrevious.changes;

                const numberOfCheckedOperations =
                  ctx.checkSchemaResult.diffToPrevious
                    .numberOfCheckedOperations || 0;

                const validationConfig =
                  ctx.checkSchemaResult.diffToPrevious.validationConfig;

                const hours = validationConfig
                  ? Math.abs(
                      moment()
                        .add(validationConfig.from, "second")
                        .diff(
                          moment().add(validationConfig.to, "second"),
                          "hours"
                        )
                    )
                  : null;

                task.title = `Compared ${pluralize(
                  chalk.cyan(schemaChanges.length.toString()),
                  "schema change"
                )} against ${pluralize(
                  chalk.cyan(numberOfCheckedOperations.toString()),
                  "operation"
                )}${
                  hours
                    ? ` over the last ${chalk.cyan(formatTimePeriod(hours))}`
                    : ""
                }`;
              }
            },
            {
              title: "Reporting result",
              task: async (ctx: TasksOutput, task) => {
                const breakingSchemaChangeCount = ctx.checkSchemaResult.diffToPrevious.changes.filter(
                  change => change.severity === ChangeSeverity.FAILURE
                ).length;
                const nonBreakingSchemaChangeCount =
                  ctx.checkSchemaResult.diffToPrevious.changes.length -
                  breakingSchemaChangeCount;

                task.title = `Found ${pluralize(
                  chalk.cyan(breakingSchemaChangeCount.toString()),
                  "breaking change"
                )} and ${pluralize(
                  chalk.cyan(nonBreakingSchemaChangeCount.toString()),
                  "compatible change"
                )}`;

                if (breakingSchemaChangeCount) {
                  // Throw an error here to produce a red X in the list of steps being taken. We're going to
                  // `catch` this error below and proceed with the reporting.
                  throw new Error(breakingChangesErrorMessage);
                }
              }
            }
          ];
        },
        context => ({
          // It would be better here to use a custom renderer that will output the `Listr` output to stderr and
          // the `this.log` output to `stdout`.
          //
          // @see https://github.com/SamVerschueren/listr#renderer
          renderer: isCi
            ? CompactRenderer
            : context.flags.markdown || context.flags.json
            ? "silent"
            : "default"
        })
      );
    } catch (error) {
      if (error.message.includes("/upgrade")) {
        this.exit(1);
        return;
      }

      if (
        error.message !== breakingChangesErrorMessage &&
        error.message !== federatedServiceCompositionUnsuccessfulErrorMessage
      ) {
        throw error;
      }
    }

    const {
      checkSchemaResult,
      config,
      shouldOutputJson,
      shouldOutputMarkdown,
      serviceName,
      compositionErrors,
      graphCompositionID,
      shouldAlwaysExit0
    } = taskOutput;

    if (shouldOutputJson) {
      if (compositionErrors) {
        this.log(JSON.stringify({ errors: compositionErrors }, null, 2));
        if (!shouldAlwaysExit0) this.exit(4);
        return;
      }

      this.log(
        JSON.stringify(
          {
            targetUrl:
              checkSchemaResult.targetUrl +
              (graphCompositionID
                ? `?graphCompositionId=${graphCompositionID}`
                : ``),
            changes: checkSchemaResult.diffToPrevious.changes,
            validationConfig: checkSchemaResult.diffToPrevious.validationConfig
          },
          null,
          2
        )
      );
      if (
        !shouldAlwaysExit0 &&
        checkSchemaResult.diffToPrevious.severity === "FAILURE"
      )
        this.exit(1);
    } else if (shouldOutputMarkdown) {
      if (!graphID) {
        throw new Error(
          "The graph name should have been defined in the Apollo config and validated when the config was loaded. Please file an issue if you're seeing this error."
        );
      }

      if (compositionErrors) {
        if (!serviceName) {
          throw new Error(
            "Composition errors should only occur when `serviceName` is present. Please file an issue if you're seeing this error."
          );
        }

        this.log(
          formatCompositionErrorsMarkdown({
            compositionErrors,
            graphName: graphID,
            serviceName,
            tag: config.variant
          })
        );
        this.exit(4);
        return;
      }

      this.log(
        formatMarkdown({
          checkSchemaResult,
          graphName: graphID,
          serviceName,
          tag: config.variant,
          graphCompositionID
        })
      );
      if (
        !shouldAlwaysExit0 &&
        checkSchemaResult.diffToPrevious.severity === "FAILURE"
      )
        this.exit(1);
      return;
    }

    if (compositionErrors) {
      // Add a cosmetic line break
      console.log("");

      // errors that DONT match the expected format: [service] field -> message
      const unformattedErrors = compositionErrors.filter(
        e => !e.field && !e.service
      );
      // errors that match the expected format: [service] field -> message
      const formattedErrors = compositionErrors.filter(
        e => e.field || e.service
      );

      if (formattedErrors.length)
        this.log(
          table(
            [
              ["Service", "Field", "Message"],
              ...formattedErrors.map(Object.values)
            ],
            {
              columns: {
                2: {
                  width: 50,
                  wrapWord: true
                }
              }
            }
          )
        );

      // list out errors which we couldn't determine Service name and/or location names
      if (unformattedErrors.length)
        this.log(
          table([["Message"], ...unformattedErrors.map(e => [e.message])])
        );
      // Return a non-zero error code
      if (shouldAlwaysExit0) {
        return;
      }
      this.exit(4);
    } else {
      this.log(formatHumanReadable({ checkSchemaResult, graphCompositionID }));

      // exit with failing status if we have failures
      if (
        checkSchemaResult.diffToPrevious.changes.find(
          ({ severity }) => severity === ChangeSeverity.FAILURE
        )
      ) {
        if (shouldAlwaysExit0) {
          return;
        }
        this.exit(1);
      }
    }
  }
}

function isNotNullOrUndefined<T>(value: T | null | undefined): value is T {
  return value !== null && typeof value !== "undefined";
}
