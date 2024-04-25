import 'jest';
import { transform as transform7 } from '@babel/core';
import { createContext, Script } from 'vm';

interface RunDefaultOptions {
  dependencies?: { [name: string]: any };
}

export function toCJS(code: string): string {
  return transform7(code, {
    plugins: [
      require.resolve('@babel/plugin-transform-modules-commonjs'),
      require.resolve('@babel/plugin-transform-typescript'),
    ],
  })!.code!;
}

export function runDefault(code: string, opts: RunDefaultOptions = {}): any {
  let cjsCode = toCJS(code);

  function myRequire(name: string): any {
    if (opts.dependencies && opts.dependencies[name]) {
      return opts.dependencies[name];
    }
    return require(name);
  }

  let context = createContext({
    exports: {},
    require: myRequire,
  });
  let script = new Script(cjsCode);
  script.runInContext(context);
  return context.exports.default();
}

export interface Transform {
  (code: string, opts?: { filename?: string }): string;
  babelMajorVersion: 6 | 7;
  usingPresets: boolean;
}
