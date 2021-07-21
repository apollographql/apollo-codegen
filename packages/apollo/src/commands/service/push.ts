import { flags } from "@oclif/command";
import { table } from "table";
import { introspectionFromSchema, printSchema } from "graphql";
import { gitInfo } from "../../git";
import { ProjectCommand } from "../../Command";
import { UploadSchemaVariables } from "apollo-language-server/lib/graphqlTypes";
import { GraphQLServiceProject } from "apollo-language-server";
import chalk from "chalk";
import { graphUndefinedError } from "../../utils/sharedMessages";

export default class ServicePush extends ProjectCommand {
  static aliases = ["schema:publish"];
  static description =
    "[DEPRECATED] Push a service definition to Apollo" +
    ProjectCommand.DEPRECATION_MSG;
  static flags = {
    ...ProjectCommand.flags,
    tag: flags.string({
      char: "t",
      description: "The tag (AKA variant) to publish your service to Apollo",
      hidden: true,
      exclusive: ["variant"]
    }),
    variant: flags.string({
      char: "v",
      description: "The variant to publish your service to in Apollo",
      exclusive: ["tag"]
    }),
    graph: flags.string({
      char: "g",
      description:
        "The ID of the graph in Apollo to publish your service to. Overrides config file if set."
    }),
    branch: flags.string({
      description: "The branch name to associate with this publication"
    }),
    remoteUrl: flags.string({
      description: "The URL of your project's remote repository"
    }),
    commitId: flags.string({
      description:
        "The SHA-1 hash of the commit to associate with this publication"
    }),
    author: flags.string({
      description: "The author to associate with this publication"
    }),
    localSchemaFile: flags.string({
      description:
        "Path to one or more local GraphQL schema file(s), as introspection result or SDL. Supports comma-separated list of paths (ex. `--localSchemaFile=schema.graphql,extensions.graphql`)"
    }),
    federated: flags.boolean({
      char: "f",
      default: false,
      hidden: true,
      description:
        "[Deprecated: use --serviceName to indicate federation] Indicates that the schema is a partial schema from a federated service"
    }),
    serviceName: flags.string({
      description:
        "Provides the name of the implementing service for a federated graph"
    }),
    serviceURL: flags.string({
      description:
        "Provides the url to the location of the implementing service for a federated graph"
    }),
    serviceRevision: flags.string({
      description:
        "Provides a unique revision identifier for a change to an implementing service on a federated service push. The default of this is a git sha"
    })
  };

  async run() {
    this.printDeprecationWarning();

    let result;
    let isFederated;
    let gitContext;
    await this.runTasks(({ flags, project, config }) => [
      {
        title: "Uploading service to Apollo",
        task: async () => {
          if (!config.graph) {
            throw graphUndefinedError;
          }

          if (flags.federated) {
            this.log(
              "The --federated flag is no longer required when running federated commands. Use of the flag will not be supported in future versions of the CLI."
            );
          }

          isFederated = flags.serviceName;

          const gitInfoFromEnv = await gitInfo(this.log);
          gitContext = {
            ...gitInfoFromEnv,
            ...(flags.author ? { committer: flags.author } : undefined),
            ...(flags.branch ? { branch: flags.branch } : undefined),
            ...(flags.commitId ? { commit: flags.commitId } : undefined),
            ...(flags.remoteUrl ? { remoteUrl: flags.remoteUrl } : undefined)
          };

          // handle partial schema uploading
          if (isFederated) {
            this.log("Fetching info from federated service");
            const sdl = await (project as GraphQLServiceProject).resolveFederatedServiceSDL();

            if (!sdl)
              throw new Error(
                "No SDL found in response from federated service. This means that the federated service exposed a `__service` field that did not emit errors, but that did not contain a spec-compliant `sdl` field."
              );

            if (!flags.serviceURL)
              throw new Error(
                "No URL found for federated service. Please provide the URL for the gateway to reach the service via the --serviceURL flag"
              );

            /**
             * id: service id for root mutation (graph id)
             * variant: like a tag. prod/staging/etc
             * name: implementing service name inside of the graph
             * revision: git commit hash/docker id. placeholder for now
             */

            const {
              compositionConfig,
              errors,
              didUpdateGateway,
              serviceWasCreated
            } = await project.engine.uploadAndComposePartialSchema({
              id: config.graph,
              graphVariant: config.variant,
              name: flags.serviceName,
              url: flags.serviceURL,
              revision:
                flags.serviceRevision ||
                (gitContext && gitContext.commit) ||
                "",
              activePartialSchema: {
                sdl
              }
            });

            result = {
              implementingServiceName: flags.serviceName,
              hash: compositionConfig && compositionConfig.schemaHash,
              compositionErrors: errors,
              serviceWasCreated,
              didUpdateGateway,
              graphId: config.graph,
              graphVariant: config.variant
            };

            return;
          }

          const schema = await project.resolveSchema({ tag: config.variant });

          const variables: UploadSchemaVariables = {
            id: config.graph,
            // @ts-ignore
            // XXX Looks like TS should be generating ReadonlyArrays instead
            schema: introspectionFromSchema(schema).__schema,
            tag: config.variant,
            gitContext
          };

          const { schema: _, ...restVariables } = variables;
          this.debug("Variables sent to Apollo:");
          this.debug(restVariables);
          this.debug("SDL of introspection sent to Apollo:");
          this.debug(printSchema(schema));

          const response = await project.engine.uploadSchema(variables);
          if (response) {
            result = {
              graphId: config.graph,
              graphVariant: response.tag ? response.tag.tag : "current",
              hash: response.tag ? response.tag.schema.hash : null,
              code: response.code
            };
            this.debug("Result received from Apollo:");
            this.debug(result);
          }
        }
      }
    ]);

    const graphString = `${result.graphId}@${result.graphVariant}`;

    this.log("\n");
    if (result.code === "NO_CHANGES") {
      this.log("No change in schema from previous version\n");
    }

    if (result.serviceWasCreated) {
      this.log(
        `A new service called '${result.implementingServiceName}' for the '${graphString}' graph was created\n`
      );
    } else if (result.implementingServiceName && isFederated) {
      this.log(
        `The '${result.implementingServiceName}' service for the '${graphString}' graph was updated\n`
      );
    }

    const { compositionErrors } = result;
    if (compositionErrors && compositionErrors.length) {
      this.log(
        `*THE SERVICE UPDATE RESULTED IN COMPOSITION ERRORS.*\n\nComposition errors must be resolved before the graph's schema or corresponding gateway can be updated.\nFor more information, see https://www.apollographql.com/docs/apollo-server/federation/errors/\n`
      );
      let printed = "";

      const messages = [
        ...compositionErrors.map(({ message }) => ({
          type: chalk.red("Error"),
          description: message
        }))
      ].filter(x => x !== null);

      this.log(
        table([["Change", "Description"], ...messages.map(Object.values)], {
          columns: { 1: { width: 70, wrapWord: true } }
        })
      );

      this.log(printed);
      this.log("\n");

      this.exit(1);
    }

    if (result.didUpdateGateway) {
      this.log(
        `The gateway for the '${graphString}' graph was updated with a new schema, composed from the updated '${result.implementingServiceName}' service\n`
      );
    } else if (isFederated) {
      this.log(
        `The gateway for the '${graphString}' graph was NOT updated with a new schema\n`
      );
    }

    if (!isFederated || result.didUpdateGateway) {
      this.log(
        table([
          ["id", "graph", "tag"],
          [result.hash.slice(0, 6), result.graphId, result.graphVariant]
        ])
      );
      this.log("\n");
    }
  }
}
