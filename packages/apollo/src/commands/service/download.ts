import { flags } from "@oclif/command";
import { introspectionFromSchema } from "graphql";
import chalk from "chalk";
import { ProjectCommand } from "../../Command";
import mkdirp from "mkdirp";
import fs from "fs";
import { dirname as getDirName } from "path";

export default class ServiceDownload extends ProjectCommand {
  static aliases = ["schema:download"];
  static description = "Download the schema from your GraphQL endpoint.";

  static flags = {
    ...ProjectCommand.flags,
    tag: flags.string({
      char: "t",
      description: "The published tag to check this service against",
      default: "current"
    }),
    skipSSLValidation: flags.boolean({
      char: "k",
      description: "Allow connections to an SSL site without certs"
    })
  };

  static args = [
    {
      name: "output",
      description:
        "Path to write the introspection result to. Supports .json output only.",
      required: true,
      default: "schema.json"
    }
  ];

  async run() {
    await this.runTasks(({ args, project, flags }) => [
      {
        title: `Saving schema to ${args.output}`,
        task: async () => {
          try {
            const schema = await project.resolveSchema({ tag: flags.tag });
            await mkdirp(getDirName(args.output));
            fs.writeFileSync(
              args.output,
              JSON.stringify(introspectionFromSchema(schema), null, 2)
            );
          } catch (e) {
            if (e.code == "ECONNREFUSED") {
              this.log(chalk.red("ERROR: Connection refused."));
              this.log(
                chalk.red(
                  "You may not be running a service locally, or your endpoint url is incorrect."
                )
              );
              this.log(
                chalk.red(
                  "If you're trying to download a schema from Apollo Graph Manager, use the `client:download-schema` command instead."
                )
              );
            }
            throw e;
          }
        }
      }
    ]);
  }
}
