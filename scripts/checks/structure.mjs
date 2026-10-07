import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import ts from "typescript";
const root = process.cwd(),
  errors = [];
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === ".well-known"
        ? []
        : files(join(directory, e.name))
      : [join(directory, e.name)],
  );
}
const code = [...files("src"), ...files("tests"), ...files("scripts")].filter(
  (f) => /\.(ts|tsx|mjs)$/.test(f),
);
for (const file of code) {
  const ast = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  function visit(node) {
    let spec;
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      spec = node.moduleSpecifier.text;
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      ts.isStringLiteral(node.arguments[0])
    )
      spec = node.arguments[0].text;
    if (spec && (spec.startsWith("@/") || spec.startsWith("."))) {
      const path = spec.startsWith("@/")
        ? resolve(root, "src", spec.slice(2))
        : resolve(dirname(file), spec);
      if (
        ![
          path,
          path + ".ts",
          path + ".tsx",
          path + ".mjs",
          join(path, "index.ts"),
        ].some(existsSync)
      )
        errors.push(`${file}: unresolved ${spec}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
for (const file of [
  "README.md",
  ...files("docs").filter(
    (f) => f.endsWith(".md") && !f.includes("provider-source"),
  ),
]) {
  const content = readFileSync(file, "utf8");
  for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1];
    if (/^(https?:|#|mailto:|app:|\/)/.test(link)) continue;
    const target = link.split("#")[0];
    if (target && !existsSync(resolve(dirname(file), target)))
      errors.push(`${file}: broken link ${link}`);
  }
}
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const command of Object.values(pkg.scripts))
  for (const match of command.matchAll(/scripts\/[\w./-]+\.(?:mjs|ts)/g))
    if (!existsSync(match[0])) errors.push(`package.json: missing ${match[0]}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Structure check passed: ${code.length} code files, local document links, and npm entry points.`,
  );
