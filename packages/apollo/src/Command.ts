import Command, { flags } from "@oclif/command";
import Listr, { ListrTask } from "listr";
import { parse, resolve } from "path";

import {
  ApolloConfig,
  Debug,
  getGraphIdFromConfig,
  getServiceFromKey,
  GraphQLClientProject,
  GraphQLProject,
  GraphQLServiceProject,
  isClientConfig,
  isServiceConfig,
  loadConfig
} from "apollo-language-server";
import { DeepPartial, WithRequired } from "apollo-env";
import { OclifLoadingHandler } from "./OclifLoadingHandler";
import URI from "vscode-uri";
import chalk from "chalk";
import { bootstrap } from "global-agent";

// Support the standard HTTP_PROXY/HTTPS_PROXY/NO_PROXY environment variables.
bootstrap({ environmentVariableNamespace: "" });

const { version, referenceID } = require("../package.json");

export interface ProjectContext<Flags = any, Args = any> {
  project: GraphQLProject;
  config: ApolloConfig;
  flags: Flags;
  args: Args;
}

export interface Flags {
  config?: string;
  header?: string[];
  endpoint?: string;
  localSchemaFile?: string;
  key?: string;
  engine?: string;
  tag?: string;
  variant?: string;
  graph?: string;
  skipSSLValidation?: boolean;
}

export interface ClientCommandFlags extends Flags {
  includes?: string;
  queries?: string;
  excludes?: string;
  tagName?: string;
  clientName?: string;
  clientReferenceId?: string;
  clientVersion?: string;
}

const headersArrayToObject = (
  arr?: string[]
): Record<string, string> | undefined => {
  if (!arr) return;
  return arr
    .map(val => JSON.parse(val))
    .reduce((pre, next) => ({ ...pre, ...next }), {});
};

export abstract class ProjectCommand extends Command {
  static flags = {
    config: flags.string({
      char: "c",
      description: "Path to your Apollo config file"
    }),
    header: flags.string({
      multiple: true,
      parse: header => {
        const separatorIndex = header.indexOf(":");
        const key = header.substring(0, separatorIndex).trim();
        const value = header.substring(separatorIndex + 1).trim();
        return JSON.stringify({ [key]: value });
      },
      description:
        "Additional header to send during introspection. May be used multiple times to add multiple headers. NOTE: The `--endpoint` flag is REQUIRED if using the `--header` flag."
    }),
    endpoint: flags.string({
      description: "The URL for the CLI use to introspect your service"
    }),
    key: flags.string({
      description: "The API key to use for authentication to Apollo",
      default: () => process.env.APOLLO_KEY || process.env.ENGINE_API_KEY
    }),
    engine: flags.string({
      description: "URL for a custom Apollo deployment",
      hidden: true
    })
  };

  public project!: GraphQLProject;
  public tasks: ListrTask[] = [];

  protected type: "service" | "client" = "service";
  protected configMap?: (flags: any) => DeepPartial<ApolloConfig>;
  private ctx!: ProjectContext;

  async init() {
    const { flags, args } = this.parse<Flags, { [name: string]: any }>(this
      .constructor as any);
    this.ctx = { flags, args } as any;

    // tell the language server to use the built-in loggers
    // from oclif
    Debug.SetLoggers({
      info: this.log,
      warning: this.warn,
      error: console.error
    });

    const config = await this.createConfig(flags);
    if (!config) return;

    this.createService(config, flags);
    this.ctx.config = config;

    // make sure this the first item in the task list
    // XXX Somehow this task gets pushed onto the stack multiple times sometimes
    this.tasks.push({
      title: "Loading Apollo Project",
      task: async ctx => {
        await this.project.whenReady;
        ctx = { ...ctx, ...this.ctx };
      }
    });
  }

  protected async createConfig(flags: Flags) {
    const service = flags.key ? getServiceFromKey(flags.key) : undefined;
    const config = await loadConfig({
      configPath: flags.config && parse(resolve(flags.config)).dir,
      configFileName: flags.config,
      name: service,
      type: this.type
    });

    if (!config) {
      this.error("A config failed to load, so the command couldn't be run");
      this.exit(1);
      return;
    }

    config.variant = flags.variant || flags.tag || config.variant;
    config.graph = flags.graph || getGraphIdFromConfig(config.rawConfig);

    if (flags.tag) {
      console.warn(
        chalk.yellow(
          "Using the --tag flag is deprecated. Please use --variant (or -v) instead."
        )
      );
    }
    //  flag overrides
    config.setDefaults({
      engine: {
        apiKey: flags.key,
        endpoint: flags.engine
      }
    });

    if (flags.endpoint) {
      config.setDefaults({
        service: {
          endpoint: {
            url: flags.endpoint,
            headers: headersArrayToObject(flags.header),
            ...(flags.skipSSLValidation && { skipSSLValidation: true })
          }
        }
      });
    }

    // this can set a single or multiple local schema files
    if (flags.localSchemaFile) {
      const files = flags.localSchemaFile.split(",");
      if (isClientConfig(config)) {
        config.setDefaults({
          client: {
            service: {
              localSchemaFile: files
            }
          }
        });
      } else if (isServiceConfig(config)) {
        config.setDefaults({
          service: {
            localSchemaFile: files
          }
        });
      }
    }

    // load per command type defaults;
    if (this.configMap) {
      const defaults = this.configMap(flags);
      config.setDefaults(defaults);
    }

    const [tokenType, identifier] =
      (config.engine.apiKey && config.engine.apiKey.split(":")) || [];
    if (tokenType == "service" && identifier !== config.graph) {
      throw new Error(
        `Cannot specify a service token that does not match graph. Graph ${config.graph} does not match graph from token (${identifier})`
      );
    }

    return config;
  }

  protected createService(config: ApolloConfig, flags: Flags) {
    const loadingHandler = new OclifLoadingHandler(this);

    // When no config is provided, configURI === process.cwd()
    // In this case, we don't want to look to the .dir since that's the parent
    const configPath = config.configURI!.fsPath;
    const rootURI =
      configPath === process.cwd()
        ? URI.file(configPath)
        : URI.file(parse(configPath).dir);

    const clientIdentity = {
      name: "Apollo CLI",
      version,
      referenceID
    };

    if (this.type === "service") {
      if (isServiceConfig(config)) {
        this.project = new GraphQLServiceProject({
          config,
          loadingHandler,
          rootURI,
          clientIdentity
        });
      } else {
        throw new Error(
          "Unable to execute service command. Please add a service section to the config"
        );
      }
    } else if (this.type === "client") {
      if (isClientConfig(config)) {
        this.project = new GraphQLClientProject({
          config,
          loadingHandler,
          rootURI,
          clientIdentity
        });
      } else {
        throw new Error(
          "Unable to execute client command. Please add a client section to the config"
        );
      }
    } else {
      throw new Error(
        "Unable to resolve project type. Please add either a client or service config. For more information, please refer to https://go.apollo.dev/t/config"
      );
    }

    this.ctx.project = this.project;
  }

  async runTasks<Result>(
    generateTasks: (context: ProjectContext) => ListrTask[],
    options?: Listr.ListrOptions | ((ctx: ProjectContext) => Listr.ListrOptions)
  ): Promise<Result> {
    const { ctx } = this;
    if (!ctx) {
      throw new Error("init must be called before trying to access this.ctx");
    }

    const tasks = await generateTasks(ctx);
    return new Listr([...this.tasks, ...tasks], {
      // Use the `verbose` renderer for tests. We need this for two reasons:
      // 1. We don't want to show a spinner in tests
      // 2. We want to see individual changes to titles and output lines; this is accomplished with the
      //    verbose renderer. Note that this _must_ be override-able because some functions require the
      //    `silent` renderer.
      ...(process.env.NODE_ENV === "test" && { renderer: "verbose" }),
      ...(options && typeof options === "function" ? options(ctx) : options),
      // @ts-ignore This option is added by https://github.com/SamVerschueren/listr-verbose-renderer#options
      dateFormat: false
    }).run();
  }
  async catch(err) {
    // handle any error from the command
    this.error(err);
  }
  async finally(err) {
    // called after run and catch regardless of whether or not the command errored
  }

  static DEPRECATION_MSG =
    "\n-----------------------------------------------------------------\n" +
    "DEPRECATED: This command will be removed from the `apollo` CLI in \n" +
    "its next major version. Replacement functionality is available in \n" +
    "the new Apollo Rover CLI: https://go.apollo.dev/t/migration\n" +
    "-----------------------------------------------------------------\n";

  protected printDeprecationWarning() {
    console.error(ProjectCommand.DEPRECATION_MSG);
  }
}

export abstract class ClientCommand extends ProjectCommand {
  static flags = {
    ...ProjectCommand.flags,
    clientReferenceId: flags.string({
      description:
        "Reference id for the client which will match ids from client traces, will use clientName if not provided"
    }),
    clientName: flags.string({
      description: "Name of the client that the queries will be attached to"
    }),
    clientVersion: flags.string({
      description:
        "The version of the client that the queries will be attached to"
    }),
    tag: flags.string({
      char: "t",
      description:
        "[Deprecated: please use --variant instead] The tag (AKA variant) of the graph in Apollo to associate this client to",
      hidden: true,
      exclusive: ["variant"]
    }),
    variant: flags.string({
      char: "v",
      description:
        "The variant of the graph in Apollo to associate this client to",
      exclusive: ["tag"]
    }),
    graph: flags.string({
      char: "g",
      description:
        "The ID for the graph in Apollo to operate client commands with. Overrides config file if set."
    }),
    queries: flags.string({
      description: "Deprecated in favor of the includes flag"
    }),
    includes: flags.string({
      description:
        "Glob of files to search for GraphQL operations. This should be used to find queries *and* any client schema extensions"
    }),
    excludes: flags.string({
      description:
        "Glob of files to exclude for GraphQL operations. Caveat: this doesn't currently work in watch mode"
    }),
    tagName: flags.string({
      description:
        "Name of the template literal tag used to identify template literals containing GraphQL queries in Javascript/Typescript code"
    })
  };
  public project!: GraphQLClientProject;
  constructor(argv, config) {
    super(argv, config);
    this.type = "client";
    this.configMap = (flags: ClientCommandFlags) => {
      const config = {
        client: {
          name: flags.clientName,
          referenceID: flags.clientReferenceId,
          version: flags.clientVersion
        }
      } as WithRequired<DeepPartial<ApolloConfig>, "client">;
      if (flags.endpoint) {
        config.client.service = {
          url: flags.endpoint,
          headers: headersArrayToObject(flags.header)
        };
      }

      if (flags.includes || flags.queries) {
        config.client.includes = [flags.includes || flags.queries];
      }

      if (flags.excludes) {
        config.client.excludes = [flags.excludes];
      }

      if (flags.tagName) {
        config.client.tagName = flags.tagName;
      }

      return config;
    };
  }
}
