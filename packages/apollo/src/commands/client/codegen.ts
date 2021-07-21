import "apollo-env";
import { flags } from "@oclif/command";
import path from "path";
import { Kind, DocumentNode } from "graphql";
import tty from "tty";
import { Gaze } from "gaze";
import URI from "vscode-uri";
import chalk from "chalk";
import { Debug } from "apollo-language-server";

import { TargetType, default as generate } from "../../generate";
import { ClientCommand } from "../../Command";

const waitForKey = async () => {
  console.log("Press any key to stop.");
  process.stdin.setRawMode!(true);
  return new Promise<void>(resolve =>
    process.stdin.once("data", () => {
      (process.stdin as any).unref();
      process.stdin.setRawMode!(false);
      resolve();
    })
  );
};

export default class Generate extends ClientCommand {
  static aliases = ["codegen:generate"];
  static description =
    "Generate static types for GraphQL queries. Can use the published schema in the Apollo registry or a downloaded schema.";

  static flags = {
    ...ClientCommand.flags,

    watch: flags.boolean({
      description: "Watch for file changes and reload codegen"
    }),
    // general
    target: flags.string({
      description:
        "Type of code generator to use (swift | typescript | flow | scala | json | json-modern (exposes raw json types))",
      required: true
    }),
    localSchemaFile: flags.string({
      description:
        "Path to one or more local GraphQL schema file(s), as introspection result or SDL. Supports comma-separated list of paths (ex. `--localSchemaFile=schema.graphql,extensions.graphql`)"
    }),
    addTypename: flags.boolean({
      description:
        "[default: true] Automatically add __typename to your queries, can be unset with --no-addTypename",
      default: true,
      allowNo: true
    }),
    passthroughCustomScalars: flags.boolean({
      description: "Use your own types for custom scalars"
    }),
    customScalarsPrefix: flags.string({
      description:
        "Include a prefix when using provided types for custom scalars"
    }),
    mergeInFieldsFromFragmentSpreads: flags.boolean({
      description: "Merge fragment fields onto its enclosing type"
    }),

    // swift
    namespace: flags.string({
      description: "The namespace to emit generated code into."
    }),
    omitDeprecatedEnumCases: flags.boolean({
      description: "Omit deprecated enum cases from generated code [Swift only]"
    }),
    operationIdsPath: flags.string({
      description:
        "Path to an operation id JSON map file. If specified, also stores the operation ids (hashes) as properties on operation types [currently Swift-only]"
    }),
    only: flags.string({
      description:
        "Parse all input files, but only output generated code for the specified file [Swift only]"
    }),
    suppressSwiftMultilineStringLiterals: flags.boolean({
      description:
        "Prevents operations from being rendered as multiline strings [Swift only]"
    }),

    // flow
    useFlowExactObjects: flags.boolean({
      description: "Use Flow exact objects for generated types [flow only]"
    }),

    useFlowReadOnlyTypes: flags.boolean({
      description:
        "Use read only types for generated types [flow only]. **Deprecated in favor of `useReadOnlyTypes`.**"
    }),

    // flow / TS
    useReadOnlyTypes: flags.boolean({
      description: "Use read only types for generated types [flow | typescript]"
    }),

    outputFlat: flags.boolean({
      description:
        'By default, TypeScript/Flow will put each generated file in a directory next to its source file using the value of the "output" as the directory name. Set "outputFlat" to put all generated files in the directory relative to the current working directory defined by "output".'
    }),

    // typescript
    globalTypesFile: flags.string({
      description:
        'By default, TypeScript will put a file named "globalTypes.ts" inside the "output" directory. Set "globalTypesFile" to specify a different path. Alternatively, set "tsFileExtension" to modify the extension of the file, for example "d.ts" will output "globalTypes.d.ts"'
    }),
    tsFileExtension: flags.string({
      description:
        'By default, TypeScript will output "ts" files. Set "tsFileExtension" to specify a different file extension, for example "d.ts"'
    }),
    keepSchemaEnumOrder: flags.boolean({
      description: "[default: false] Keep enum order from schema",
      default: false
    })
  };

  static args = [
    {
      name: "output",
      description: `Directory to which generated files will be written.
- For TypeScript/Flow generators, this specifies a directory relative to each source file by default.
- For TypeScript/Flow generators with the "outputFlat" flag is set, and for the Swift generator, this specifies a file or directory (absolute or relative to the current working directory) to which:
  - a file will be written for each query (if "output" is a directory)
  - all generated types will be written
- For all other types, this defines a file (absolute or relative to the current working directory) to which all generated types are written.`
    }
  ];

  async run() {
    const {
      flags: { watch },
      args: { output }
    } = this.parse(Generate);

    let write;
    const run = () =>
      this.runTasks(({ flags, args, project, config }) => {
        let inferredTarget: TargetType = "" as TargetType;
        if (
          [
            "json",
            "json-modern",
            "swift",
            "typescript",
            "flow",
            "scala"
          ].includes(flags.target)
        ) {
          inferredTarget = flags.target as TargetType;
        } else {
          throw new Error(`Unsupported target: ${flags.target}`);
        }

        if (
          !args.output &&
          inferredTarget != "typescript" &&
          inferredTarget != "flow"
        ) {
          throw new Error(
            "The output path must be specified in the arguments for targets that aren't TypeScript or Flow"
          );
        }

        if (
          !flags.outputFlat &&
          (inferredTarget === "typescript" || inferredTarget === "flow") &&
          (args.output &&
            (path.isAbsolute(args.output) ||
              args.output.split(path.sep).length > 1))
        ) {
          throw new Error(
            'For TypeScript and Flow generators, "output" must be empty or a single directory name, unless the "outputFlat" flag is set.'
          );
        }

        return [
          {
            title: "Generating query files",
            task: async (ctx, task) => {
              task.title = `Generating query files with '${inferredTarget}' target`;
              const schema = await project.resolveSchema({
                tag: config.variant
              });

              if (!schema) throw new Error("Error loading schema");

              write = () => {
                // make sure all of the doucuments that we are going to be using for codegen
                // are valid documents
                project.validate();

                // to prevent silent erroring of syntax errors, we check the project's
                // documents to make sure there are no errors. If there are, we error here
                // instead of project initialization
                for (const document of this.project.documents) {
                  if (document.syntaxErrors.length) {
                    const errors = document.syntaxErrors.map(
                      e =>
                        `Syntax error in ${document.source.name}: ${e.message}\n`
                    );
                    throw new Error(errors.toString());
                  }
                }

                const operations = Object.values(this.project.operations);
                const fragments = Object.values(this.project.fragments);

                if (!operations.length && !fragments.length) {
                  throw new Error(
                    "No operations or fragments found to generate code for."
                  );
                }

                const document: DocumentNode = {
                  kind: Kind.DOCUMENT,
                  definitions: [...operations, ...fragments]
                };
                return generate(
                  document,
                  schema,
                  typeof args.output === "string"
                    ? args.output
                    : "__generated__",
                  flags.only,
                  inferredTarget,
                  flags.tagName as string,
                  !flags.outputFlat,
                  {
                    passthroughCustomScalars:
                      flags.passthroughCustomScalars ||
                      !!flags.customScalarsPrefix,
                    customScalarsPrefix: flags.customScalarsPrefix || "",
                    addTypename: flags.addTypename,
                    namespace: flags.namespace,
                    operationIdsPath: flags.operationIdsPath,
                    generateOperationIds: !!flags.operationIdsPath,
                    mergeInFieldsFromFragmentSpreads:
                      flags.mergeInFieldsFromFragmentSpreads,
                    useFlowExactObjects: flags.useFlowExactObjects,
                    useReadOnlyTypes:
                      flags.useReadOnlyTypes || flags.useFlowReadOnlyTypes,
                    globalTypesFile: flags.globalTypesFile,
                    tsFileExtension: flags.tsFileExtension,
                    suppressSwiftMultilineStringLiterals:
                      flags.suppressSwiftMultilineStringLiterals,
                    omitDeprecatedEnumCases: flags.omitDeprecatedEnumCases,
                    exposeTypeNodes: inferredTarget === "json-modern"
                  }
                );
              };

              const writtenFiles = write();

              task.title = `Generating query files with '${inferredTarget}' target - wrote ${writtenFiles} files`;
            }
          }
        ];
      });

    if (watch) {
      await run().catch(() => {});
      const watcher = new Gaze(this.project.config.client.includes);
      // FIXME: support excludes with the glob
      watcher.on("all", (event, file) => {
        // don't trigger write events for generated file changes
        if (file.indexOf("__generated__") > -1) return;
        // don't trigger write events on single output file
        if (file.indexOf(output) > -1) return;
        this.project.fileDidChange(URI.file(file).toString());
        console.log("\nChange detected, generating types...");
        try {
          const fileCount = write();
          console.log(`${chalk.green("✔")} Wrote ${fileCount} files`);
        } catch (e) {
          Debug.error("Error while generating types: " + e.message);
        }
      });
      if (tty.isatty((process.stdin as any).fd)) {
        await waitForKey();
        watcher.close();
        process.exit(0);
      }
      return;
    } else {
      return run();
    }
  }
}
