/**
 * Compiles src/ to dist/ with Solid's JSX compiler.
 *
 * Without this the package ships raw TSX, and the loader that installs plugins
 * from npm compiles JSX without Solid's getter wrapping: every expression in the
 * panel is evaluated once, so the panel renders one frame and never updates.
 * The local-directory loader applies the Solid compiler, which is why the defect
 * only appeared after installing from the registry.
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transformFileSync } from "@babel/core";

const SRC = "src";
const OUT = "dist";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const sources = readdirSync(SRC).filter((file) => /\.tsx?$/.test(file));

for (const file of sources) {
  const { code } = transformFileSync(join(SRC, file), {
    filename: file,
    presets: [
      ["@babel/preset-typescript", { isTSX: true, allExtensions: true }],
      // OpenTUI supplies a custom renderer, so the JSX must target its runtime
      // rather than solid-js/web. `validate` off keeps the compiler from
      // reporting every OpenTUI element as a misspelled HTML tag.
      [
        "babel-preset-solid",
        { generate: "universal", moduleName: "@opentui/solid", validate: false },
      ],
    ],
    babelrc: false,
    configFile: false,
  });

  // ESM needs explicit extensions, and the sources are written without them so
  // the type checker resolves them in bundler mode.
  const rewritten = code.replace(/from "(\.[^"]+)"/g, (match, specifier) =>
    specifier.endsWith(".js") ? match : `from "${specifier}.js"`,
  );

  writeFileSync(join(OUT, file.replace(/\.tsx?$/, ".js")), rewritten);
}

const entry = readFileSync(join(OUT, "tui.js"), "utf8");
if (!/get index\(\)/.test(entry)) {
  throw new Error(
    "dist/tui.js has no getter props: the Solid compiler did not run, and the panel would render a single frame",
  );
}

console.log(`built ${sources.length} files into ${OUT}/`);
