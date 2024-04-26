import { runDefault } from './test-support';
import { ImportUtil } from '../src/index';
import type * as Babel from '@babel/core';
import type { PluginObj, TransformOptions, PluginItem, Visitor } from '@babel/core';
import { transform as transform7 } from '@babel/core';
// @ts-ignore no upstream types
import TSSyntax from '@babel/plugin-syntax-typescript';
import 'code-equality-assertions/jest';

describe('ImportUtil', () => {
  let testTransforms: PluginItem[] = [];
  let t: typeof Babel.types;

  function addPlugin(visitor: Visitor<State>) {
    function testTransform(babel: typeof Babel): PluginObj<State> {
      t = babel.types;
      return {
        visitor: {
          ...visitor,
          Program: {
            enter(path, state) {
              state.util = new ImportUtil(babel, path);
            },
            ...(visitor.Program ?? {}),
          },
        },
      };
    }
    testTransforms.push(testTransform);
  }

  function transform(code: string) {
    if (testTransforms.length === 0) {
      throw new Error(`each test must call addPlugin`);
    }
    let options7: TransformOptions = {
      plugins: [...testTransforms, TSSyntax],
    };
    if (!options7.filename) {
      options7.filename = 'sample.js';
    }
    return transform7(code, options7)!.code!;
  }

  const dependencies = {
    m: {
      thing(arg: string) {
        return `you said: ${arg}.`;
      },
      default(arg: string) {
        return `default said: ${arg}.`;
      },
      __esModule: true,
    },
    n: {
      thing(arg: string) {
        return `n said: ${arg}.`;
      },
      __esModule: true,
    },
  };

  function countReferences(moduleName: string, exportedName: string) {
    let referenceCount: number | undefined;
    addPlugin({
      Program: {
        exit(path) {
          for (let item of path.get('body')) {
            if (!item.isImportDeclaration() || item.node.source.value !== moduleName) {
              continue;
            }
            for (let spec of item.get('specifiers')) {
              if (
                spec.node.type !== 'ImportSpecifier' ||
                spec.node.imported.type !== 'Identifier' ||
                spec.node.imported.name !== exportedName
              ) {
                continue;
              }
              let binding = path.scope.getBinding(spec.node.local.name);
              referenceCount = binding?.referencePaths.length;
            }
          }
        },
      },
    });
    return {
      get count() {
        return referenceCount;
      },
    };
  }

  afterEach(() => {
    testTransforms = [];
  });

  test('can generate an import', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'thing'));
        }
      },
    });
    let code = transform(`
      export default function() {
        return myTarget('foo');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: foo.');
    expect(code).toMatch(/import \{ thing \} from ['"]m['"]/);
  });

  test('can generate an unreferenced import', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          callee.replaceWith(state.util.import(callee, 'm', 'thing'));
          callee.scope.crawl();
        }
      },
    });
    let code = transform(`
      export default function() {
        return myTarget('foo');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: foo.');
    expect(code).toMatch(/import \{ thing \} from ['"]m['"]/);
  });

  test('can generate a default import', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myDefaultTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'default'));
        }
      },
    });
    let code = transform(`
      export default function() {
        return myDefaultTarget('foo');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('default said: foo.');
    expect(code).toMatch(/import myDefaultTarget from ['"]m['"]/);
  });

  test('emits new imports after preexisting other imports', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myDefaultTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'default'));
        }
      },
    });
    let code = transform(`
      import "whatever";

      export default function() {
        return myDefaultTarget('foo');
      }
      `);
    expect(code).toEqualCode(`
      import "whatever";
      import myDefaultTarget from "m";
      export default function () {
        return myDefaultTarget("foo");
      }
    `);
  });

  test('emits added imports in the order they were added', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'thing'));
        } else if (callee.node.name === 'second') {
          state.util.replaceWith(callee, (i) => i.import('n', 'thing'));
        }
      },
    });
    let code = transform(`
      export default function () {
        myTarget();
        second();
      }
    `);
    expect(code).toEqualCode(`
      import { thing } from "m";
      import { thing as thing0 } from "n";
      export default function () {
        thing();
        thing0();
      }
    `);
  });

  test('can generate a namespace import', () => {
    addPlugin({
      MemberExpression(path, state) {
        let obj = path.get('object');
        if (!obj.isIdentifier()) {
          return;
        }
        if (obj.node.name === 'myNamespaceTarget') {
          state.util.replaceWith(obj, (i) => i.import('m', '*'));
        }
      },
    });
    let code = transform(`
      export default function() {
        return myNamespaceTarget.thing('a') + " " + myNamespaceTarget.default('b');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: a. default said: b.');
    expect(code).toMatch(/import \* as myNamespaceTarget from ['"]m['"]/);
  });

  test('namespace binding avoids namespace imports', () => {
    addPlugin({
      MemberExpression(path, state) {
        let obj = path.get('object');
        if (!obj.isIdentifier()) {
          return;
        }
        if (obj.node.name === 'myNamespaceTarget') {
          state.util.replaceWith(obj, (i) => i.import('m', '*'));
        }
      },
    });
    let code = transform(`
      import * as foo from 'm';
      export default function(foo) {
        return myNamespaceTarget.thing('a') + " " + myNamespaceTarget.default('b');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: a. default said: b.');
    expect(code).toMatch(/import \* as myNamespaceTarget from ['"]m['"]/);
  });

  test('namespace binding avoids named imports', () => {
    addPlugin({
      MemberExpression(path, state) {
        let obj = path.get('object');
        if (!obj.isIdentifier()) {
          return;
        }
        if (obj.node.name === 'myNamespaceTarget') {
          state.util.replaceWith(obj, (i) => i.import('m', '*'));
        }
      },
    });
    let code = transform(`
      import { x } from 'm';
      export default function() {
        return myNamespaceTarget.thing('a') + " " + myNamespaceTarget.default('b');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: a. default said: b.');
    expect(code).toMatch(/import \* as myNamespaceTarget from ['"]m['"]/);
  });

  test('namespace binding uses namespaced imports', () => {
    addPlugin({
      MemberExpression(path, state) {
        let obj = path.get('object');
        if (!obj.isIdentifier()) {
          return;
        }
        if (obj.node.name === 'myNamespaceTarget') {
          state.util.replaceWith(obj, (i) => i.import('m', '*'));
        }
      },
    });
    let code = transform(`
      import * as b from 'm';
      export default function() {
        return myNamespaceTarget.thing('a') + " " + myNamespaceTarget.default('b');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: a. default said: b.');
    expect(code).toMatch(/import \* as b from ['"]m['"]/);
  });

  test('namespace binding uses default imports', () => {
    addPlugin({
      MemberExpression(path, state) {
        let obj = path.get('object');
        if (!obj.isIdentifier()) {
          return;
        }
        if (obj.node.name === 'myNamespaceTarget') {
          state.util.replaceWith(obj, (i) => i.import('m', '*'));
        }
      },
    });
    let code = transform(`
      import b from 'm';
      export default function() {
        return myNamespaceTarget.thing('a') + " " + myNamespaceTarget.default('b');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: a. default said: b.');
    expect(code).toMatch(/import b, \* as myNamespaceTarget from ['"]m['"]/);
  });

  test('named binding avoids namespace import', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'thing'));
        } else if (callee.node.name === 'second') {
          state.util.replaceWith(callee, (i) => i.import('n', 'thing'));
        }
      },
    });
    let code = transform(`
      import * as x from 'm';
      export default function () {
        myTarget();
        second();
      }
    `);
    expect(code).toEqualCode(`
      import * as x from 'm';
      import { thing } from "m";
      import { thing as thing0 } from "n";
      export default function () {
        thing();
        thing0();
      }
    `);
  });

  test('can use an optional name hint', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myHintTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'default', 'HINT'));
        }
      },
    });
    let code = transform(`
      export default function() {
        return myHintTarget('foo');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('default said: foo.');
    expect(code).toMatch(/import HINT from ['"]m['"]/);
  });

  test('sanitizes name hint to make it a valid javascript identifier', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myMessyHintTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'default', 'this-is: the hint!'));
        }
      },
    });
    let code = transform(`
      export default function() {
        return myMessyHintTarget('foo');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('default said: foo.');
    expect(code).toMatch(/import thisIsTheHint from ['"]m['"]/);
  });

  test('avoids an existing local binding', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'thing'));
        }
      },
    });
    let code = transform(`
      export default function() {
        let thing = 'hello';
        return myTarget(thing);
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: hello.');
    expect(code).toMatch(/import \{ thing as thing0 \} from ['"]m['"]/);
  });

  test('uses an existing import', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'thing'));
        }
      },
    });
    let code = transform(`
      import { thing } from 'm';
      export default function() {
        return myTarget('foo');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: foo.');
    expect(code.match(/import/g)?.length).toEqual(1);
  });

  test('does not use an existing type-only import', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'thing'));
        }
      },
    });
    let code = transform(`
      import type { thing } from 'm';
      export default function() {
        return myTarget('foo');
      }
      `);
    expect(code).toEqualCode(`
      import type { thing } from 'm';
      import { thing as thing0 } from 'm';
      export default function () {
        return thing0('foo');
      }
    `);
  });

  test('adds to an existing import', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'thing'));
        }
      },
    });
    let code = transform(`
      import { other } from 'm';
      export default function() {
        return myTarget('foo');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: foo.');
    expect(code.match(/import/g)?.length).toEqual(1);
    expect(code).toMatch(/import \{ other, thing \} from ['"]m['"]/);
  });

  test('does not add to an existing type-only import', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'thing'));
        }
      },
    });
    let code = transform(`
      import type { other } from 'm';
      export default function() {
        return myTarget('foo');
      }
      `);
    expect(code).toEqualCode(`
      import type { other } from 'm';
      import { thing } from 'm';
      export default function () {
        return thing('foo');
      }
    `);
  });

  test('adds to an existing value import with an unrelated type-only specifier', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'thing'));
        }
      },
    });
    let code = transform(`
      import { type other } from 'm';
      export default function() {
        return myTarget('foo');
      }
      `);
    expect(code).toEqualCode(`
      import { type other, thing } from 'm';
      export default function () {
        return thing('foo');
      }
    `);
  });

  test('subsequent imports avoid previously created bindings', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'thing'));
        } else if (callee.node.name === 'second') {
          state.util.replaceWith(callee, (i) => i.import('n', 'thing'));
        }
      },
    });
    let code = transform(`
      export default function() {
        return myTarget("a") + " | " + second("b");
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: a. | n said: b.');
    expect(code).toMatch(/import \{ thing \} from ['"]m['"]/);
    expect(code).toMatch(/import \{ thing as thing0 \} from ['"]n['"]/);
  });

  test('multiple uses share an import', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'thing'));
        } else if (callee.node.name === 'myDefaultTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'default'));
        }
      },
    });
    let code = transform(`
      export default function() {
        return myTarget("a") + " | " + myTarget("b") + " | " + myDefaultTarget("c");
      }
      `);
    expect(code).toMatch(/import myDefaultTarget, \{ thing \} from ['"]m['"]/);
    expect(runDefault(code, { dependencies })).toEqual(
      'you said: a. | you said: b. | default said: c.'
    );
    expect(code.match(/import/g)?.length).toEqual(1);
  });

  test('multiple uses in different scopes share a specifier', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'thing'));
        }
      },
    });
    let code = transform(`
      function a() {
        return myTarget('a');
      }
      function b() {
        return myTarget('b');
      }
      export default function() {
        return a() + " | " + b();
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: a. | you said: b.');
    expect(code).toMatch(/import \{ thing \} from ['"]m['"]/);
    expect(code.match(/import/g)?.length).toEqual(1);
  });

  test('resolves conflicts between different local scope collisions', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          state.util.replaceWith(callee, (i) => i.import('m', 'thing'));
        }
      },
    });
    let code = transform(`
      export default function() {
        let first = myTarget("a");
        let second = (function(thing) {
          return myTarget(thing);
        })("b");
        return first + " | " + second;
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: a. | you said: b.');
    expect(code).toMatch(/import \{ thing, thing as thing0 \} from ['"]m['"]/);
    expect(code.match(/import/g)?.length).toEqual(1);
  });

  test('can add a side-effect import', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'needsSideEffectThing') {
          state.util.importForSideEffect('side-effect-thing');
        }
      },
    });
    let code = transform(`
      needsSideEffectThing();
    `);
    expect(code).toMatch(/import ['"]side-effect-thing['"]/);
  });

  test('side-effect import has no effect on existing import', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'needsSideEffectThing') {
          state.util.importForSideEffect('side-effect-thing');
        }
      },
    });
    let code = transform(`
      import x from 'side-effect-thing';
      needsSideEffectThing();
    `);
    expect(code).toMatch(/import x from ['"]side-effect-thing['"]/);
    expect(code).not.toMatch(/import ['"]side-effect-thing['"]/);
  });

  test('can remove one specifier', () => {
    addPlugin({
      Program: {
        exit(_path, state) {
          state.util.removeImport('whatever', 'a');
        },
      },
    });
    let code = transform(`
      import { a, b } from 'whatever';
      import other from 'x';
    `);
    expect(code).toMatch(/import \{ b \} from 'whatever'/);
    expect(code).toMatch(/import other from 'x'/);
  });

  test('can remove whole statement', () => {
    addPlugin({
      Program: {
        exit(_path, state) {
          state.util.removeImport('whatever', 'a');
        },
      },
    });
    let code = transform(`
      import { a } from 'whatever';
      import other from 'x';
    `);
    expect(code).not.toMatch(/whatever/);
    expect(code).toMatch(/import other from 'x'/);
  });

  test('can remove namespace import', () => {
    addPlugin({
      Program: {
        exit(_path, state) {
          state.util.removeImport('remove-my-namespace', '*');
        },
      },
    });
    let code = transform(`
      import * as a from 'remove-my-namespace';
      import * as other from 'x';
    `);
    expect(code).not.toMatch(/remove-my-namespace/);
    expect(code).toMatch(/import \* as other from 'x'/);
  });

  test('can remove all imports', () => {
    addPlugin({
      Program: {
        exit(_path, state) {
          state.util.removeAllImports('remove-all');
        },
      },
    });
    let code = transform(`
      import 'remove-all';
    `);
    expect(code).not.toMatch(/remove-all/);
  });

  test('inserts identifier correctly when replacing a larger expression', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'replacesWholeExpression') {
          state.util.replaceWith(path, (i) =>
            t.callExpression(i.import('m', 'impl'), [t.stringLiteral('x')])
          );
        }
      },
    });
    let code = transform(`
      replacesWholeExpression()
    `);
    expect(code).toEqualCode(`
      import { impl } from 'm';
      impl('x');
    `);
  });

  test("handles scope collisions within the user's new expression", () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'target') {
          state.util.replaceWith(path, (i) =>
            t.functionExpression(
              null,
              [t.identifier('impl')],
              t.blockStatement([
                t.expressionStatement(
                  t.callExpression(i.import('m', 'impl'), [t.stringLiteral('x')])
                ),
              ])
            )
          );
        }
      },
    });
    let code = transform(`
      target()
    `);
    expect(code).toEqualCode(`
      import { impl as impl0} from 'm';
      (function (impl) {
        impl0("x");
      });
    `);
  });

  test('can insertAfter', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'target') {
          state.util.insertAfter(path, (i) =>
            t.callExpression(i.import('m', 'impl'), [t.stringLiteral('x')])
          );
        }
      },
    });
    let references = countReferences('m', 'impl');
    let code = transform(`
      target()
    `);
    expect(code).toEqualCode(`
      import { impl } from 'm';
      target();
      impl('x');
    `);
    expect(references.count).toEqual(1);
  });

  test('can insertBefore', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'target') {
          state.util.insertBefore(path, (i) =>
            t.callExpression(i.import('m', 'impl'), [t.stringLiteral('x')])
          );
        }
      },
    });
    let references = countReferences('m', 'impl');

    let code = transform(`
      target()
    `);
    expect(code).toEqualCode(`
      import { impl } from 'm';
      impl('x');
      target();
    `);
    expect(references.count).toEqual(1);
  });

  test('unreferenced import is unreferenced', () => {
    addPlugin({
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'target') {
          path.set('callee', state.util.import(path, 'm', 'impl'));
        }
      },
    });
    let references = countReferences('m', 'impl');
    let code = transform(`
      target()
    `);
    expect(code).toEqualCode(`
      import { impl } from 'm';
      impl();
    `);
    expect(references.count).toEqual(0);
  });
});

interface State {
  util: ImportUtil;
}
