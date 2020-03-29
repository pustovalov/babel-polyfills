// @flow

import defineProvider, {
  type Utils,
} from "@babel/helper-define-polyfill-provider";

import resolve from "resolve";
import debounce from "lodash.debounce";

import polyfills from "../data/polyfills.json";

import {
  type Descriptor,
  Globals,
  StaticProperties,
  InstanceProperties,
} from "./mappings";

type Options = {|
  missingDependencies?: {
    log?: "per-file" | "deferred",
    // When true, log all the polyfills without checking if they are installed
    all?: boolean,
  },
|};

export default defineProvider<Options>(function(
  { shouldInjectPolyfill, createMetaResolver, debug },
  options,
  dirname,
) {
  const resolvePolyfill = createMetaResolver<Descriptor[]>({
    global: Globals,
    static: StaticProperties,
    instance: InstanceProperties,
  });

  const installedDeps = new Set();
  const missingDeps = new Set();

  function mark(desc) {
    debug(desc.name);

    const dep = `${desc.package}@^${desc.version}`;
    if (installedDeps.has(dep) || missingDeps.has(dep)) return;

    if (
      options.missingDependencies?.all ||
      !hasDependency(dirname, desc.package)
    ) {
      missingDeps.add(dep);
    } else {
      installedDeps.add(dep);
    }
  }

  function createDescIterator(cb: (Descriptor, Utils, Object) => void) {
    return (meta, utils, path) => {
      const resolved = resolvePolyfill(meta);
      if (!resolved) return;

      for (const desc of resolved.desc) {
        if (shouldInjectPolyfill(desc.name)) cb(desc, utils, path);
      }
    };
  }

  return {
    name: "es-shims",
    polyfills,

    usageGlobal: createDescIterator((desc, utils) => {
      if (desc.global === false) return;

      utils.injectGlobalImport(`${desc.package}/auto.js`);

      mark(desc);
    }),

    usagePure: createDescIterator((desc, utils, path) => {
      if (desc.pure === false) return;

      const id = utils.injectDefaultImport(
        `${desc.package}/implementation.js`,
        desc.name,
      );
      path.replaceWith(id);

      mark(desc);
    }),

    post() {
      if (options.missingDependencies?.log === "per-file") {
        logMissingDependencies(missingDeps);
      } else {
        laterLogMissingDependencies(missingDeps);
      }
    },
  };
});

function hasDependency(basedir, name) {
  try {
    resolve.sync(name, { basedir });
    return true;
  } catch {
    return false;
  }
}

function logMissingDependencies(missingDeps) {
  if (missingDeps.size === 0) return;

  const deps = Array.from(missingDeps)
    .sort()
    .join(" ");

  console.warn(
    "\nSome polyfills have been added but are not present in your dependencies.\n" +
      "Please run one of the following commands:\n" +
      `\tnpm install --save ${deps}\n` +
      `\tyarn add ${deps}\n`,
  );
}

const laterLogMissingDependencies = (() => {
  let allMissingDeps = new Set();

  const laterLogMissingDependencies = debounce(() => {
    logMissingDependencies(allMissingDeps);
    allMissingDeps = new Set();
  }, 1000);

  return missingDeps => {
    missingDeps.forEach(name => allMissingDeps.add(name));
    laterLogMissingDependencies();
  };
})();