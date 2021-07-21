import { fs } from "apollo-codegen-core/lib/localfs";
import { getValidationErrors } from "apollo-language-server";
import path from "path";
import { GraphQLSchema, DocumentNode, print } from "graphql";
import URI from "vscode-uri";

import {
  compileToIR,
  CompilerContext,
  CompilerOptions
} from "apollo-codegen-core/lib/compiler";
import {
  compileToLegacyIR,
  CompilerOptions as LegacyCompilerOptions
} from "apollo-codegen-core/lib/compiler/legacyIR";
import serializeToJSON from "apollo-codegen-core/lib/serializeToJSON";
import { BasicGeneratedFile } from "apollo-codegen-core/lib/utilities/CodeGenerator";

import { generateSource as generateSwiftSource } from "apollo-codegen-swift";
import { generateSource as generateFlowSource } from "apollo-codegen-flow";
import {
  generateLocalSource as generateTypescriptLocalSource,
  generateGlobalSource as generateTypescriptGlobalSource
} from "apollo-codegen-typescript";
import { generateSource as generateScalaSource } from "apollo-codegen-scala";

import { FlowCompilerOptions } from "../../apollo-codegen-flow/lib/language";
import { validateQueryDocument } from "apollo-language-server/lib/errors/validation";
import { DEFAULT_FILE_EXTENSION as TYPESCRIPT_DEFAULT_FILE_EXTENSION } from "apollo-codegen-typescript/lib/helpers";

export type TargetType =
  | "json"
  | "json-modern"
  | "swift"
  | "scala"
  | "flow"
  | "typescript"
  | "ts";

export type GenerationOptions = CompilerOptions &
  LegacyCompilerOptions &
  FlowCompilerOptions & {
    globalTypesFile?: string;
    tsFileExtension?: string;
    rootPath?: string;
  };

function toPath(uri: string): string {
  return URI.parse(uri).fsPath;
}

export default function generate(
  document: DocumentNode,
  schema: GraphQLSchema,
  outputPath: string,
  only: string | undefined,
  target: TargetType,
  tagName: string,
  nextToSources: boolean | string,
  options: GenerationOptions
): number {
  const errors = getValidationErrors(schema, document);
  if (errors && errors.length > 0) {
    const messages = errors.map(e => e.toString()).join("\n");
    throw new Error(
      `Validation of GraphQL query document failed:\n${messages}`
    );
  }
  let writtenFiles = 0;

  const { rootPath = process.cwd() } = options;
  if (outputPath.split(".").length <= 1 && !fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath);
  }

  if (target === "swift") {
    options.addTypename = true;
    const context = compileToIR(schema, document, options);

    const outputIndividualFiles =
      fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory();

    const suppressSwiftMultilineStringLiterals = Boolean(
      options.suppressSwiftMultilineStringLiterals
    );

    const generator = generateSwiftSource(
      context,
      outputIndividualFiles,
      suppressSwiftMultilineStringLiterals,
      only
    );

    if (outputIndividualFiles) {
      writeGeneratedFiles(generator.generatedFiles, outputPath, "\n");
      writtenFiles += Object.keys(generator.generatedFiles).length;
    } else {
      fs.writeFileSync(outputPath, generator.output.concat("\n"));
      writtenFiles += 1;
    }

    if (options.generateOperationIds) {
      writeOperationIdsMap(context);
      writtenFiles += 1;
    }
  } else if (target === "flow") {
    const context = compileToIR(schema, document, options);
    const { generatedFiles, common } = generateFlowSource(context);

    const outFiles: {
      [fileName: string]: BasicGeneratedFile;
    } = {};

    if (nextToSources) {
      generatedFiles.forEach(({ sourcePath, fileName, content }) => {
        const dir = path.join(
          path.dirname(path.posix.relative(rootPath, toPath(sourcePath))),
          outputPath
        );
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir);
        }

        outFiles[path.join(dir, fileName)] = {
          output: content.fileContents + common
        };
      });

      writeGeneratedFiles(outFiles, path.resolve("."));

      writtenFiles += Object.keys(outFiles).length;
    } else if (
      fs.existsSync(outputPath) &&
      fs.statSync(outputPath).isDirectory()
    ) {
      generatedFiles.forEach(({ fileName, content }) => {
        outFiles[fileName] = {
          output: content.fileContents + common
        };
      });

      writeGeneratedFiles(outFiles, outputPath);

      writtenFiles += Object.keys(outFiles).length;
    } else {
      fs.writeFileSync(
        outputPath,
        generatedFiles.map(o => o.content.fileContents).join("\n") + common
      );

      writtenFiles += 1;
    }
  } else if (target === "typescript" || target === "ts") {
    const context = compileToIR(schema, document, options);
    const generatedFiles = generateTypescriptLocalSource(context);
    const generatedGlobalFile = generateTypescriptGlobalSource(context);

    const outFiles: {
      [fileName: string]: BasicGeneratedFile;
    } = {};

    if (
      nextToSources ||
      (fs.existsSync(outputPath) && fs.statSync(outputPath).isDirectory())
    ) {
      if (options.globalTypesFile) {
        const globalTypesDir = path.dirname(options.globalTypesFile);
        if (!fs.existsSync(globalTypesDir)) {
          fs.mkdirSync(globalTypesDir);
        }
      } else if (nextToSources && !fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath);
      }

      const globalSourcePath =
        options.globalTypesFile ||
        path.join(
          outputPath,
          `globalTypes.${options.tsFileExtension ||
            TYPESCRIPT_DEFAULT_FILE_EXTENSION}`
        );
      outFiles[globalSourcePath] = {
        output: generatedGlobalFile.fileContents
      };

      generatedFiles.forEach(({ sourcePath, fileName, content }) => {
        let dir = outputPath;
        if (nextToSources) {
          dir = path.join(
            path.dirname(path.relative(rootPath, toPath(sourcePath))),
            dir
          );
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir);
          }
        }

        const outFilePath = path.join(dir, fileName);
        outFiles[outFilePath] = {
          output: content({ outputPath: outFilePath, globalSourcePath })
            .fileContents
        };
      });

      writeGeneratedFiles(outFiles, path.resolve("."));

      writtenFiles += Object.keys(outFiles).length;
    } else {
      fs.writeFileSync(
        outputPath,
        generatedFiles.map(o => o.content().fileContents).join("\n") +
          "\n" +
          generatedGlobalFile.fileContents
      );

      writtenFiles += 1;
    }
  } else {
    let output;
    const context = compileToLegacyIR(schema, document, {
      ...options,
      exposeTypeNodes: target === "json-modern"
    });
    switch (target) {
      case "json-modern":
      case "json":
        output = serializeToJSON(context, {
          exposeTypeNodes: Boolean(options.exposeTypeNodes)
        });
        break;
      case "scala":
        output = generateScalaSource(context);
    }

    if (outputPath) {
      fs.writeFileSync(outputPath, output);
      writtenFiles += 1;
    } else {
      console.log(output);
    }
  }

  return writtenFiles;
}

function writeGeneratedFiles(
  generatedFiles: { [fileName: string]: BasicGeneratedFile },
  outputDirectory: string,
  terminator: string = ""
) {
  for (const [fileName, generatedFile] of Object.entries(generatedFiles)) {
    fs.writeFileSync(
      path.join(outputDirectory, fileName),
      generatedFile.output.concat(terminator)
    );
  }
}

interface OperationIdsMap {
  name: string;
  source: string;
}

function writeOperationIdsMap(context: CompilerContext) {
  let operationIdsMap: { [id: string]: OperationIdsMap } = {};
  Object.keys(context.operations)
    .map(k => context.operations[k])
    .forEach(operation => {
      operationIdsMap[operation.operationId!] = {
        name: operation.operationName,
        source: operation.sourceWithFragments!
      };
    });
  fs.writeFileSync(
    context.options.operationIdsPath,
    JSON.stringify(operationIdsMap, null, 2)
  );
}
