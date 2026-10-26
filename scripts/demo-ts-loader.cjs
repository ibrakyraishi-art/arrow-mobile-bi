/**
 * Загрузчик TypeScript для node-скриптов демо-данных (генерация CSV, проверки).
 *
 * Без новых пакетов: берём `typescript` из devDependencies и транспилируем
 * .ts-файлы из lib/ «на лету» в CommonJS; алиас `@/…` резолвится в корень
 * репозитория (как `paths` в tsconfig). Типы здесь не проверяются — это делает
 * `npm run check`.
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === "server-only") return require.resolve("./demo-ts-loader.cjs");
  if (request.startsWith("@/")) {
    request = path.join(ROOT, request.slice(2));
  }
  try {
    return originalResolve.call(this, request, parent, ...rest);
  } catch (e) {
    // Импорт без расширения: пробуем .ts / .tsx / index.ts.
    const base = path.isAbsolute(request)
      ? request
      : parent && parent.filename
        ? path.resolve(path.dirname(parent.filename), request)
        : request;
    for (const cand of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (fs.existsSync(cand)) return cand;
    }
    throw e;
  }
};

require.extensions[".ts"] = function (module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const out = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  module._compile(out.outputText, filename);
};

module.exports = { ROOT };
