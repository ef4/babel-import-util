import { allBabelVersions, runDefault } from './test-support';
import { ImportUtil } from '../src/index';
import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';

function importUtilTests(transform: (code: string) => string) {
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

  test('can generate an import', () => {
    let code = transform(`
      export default function() {
        return myTarget('foo');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: foo.');
    expect(code).toMatch(/import \{ thing \} from ['"]m['"]/);
  });

  test('can generate a default import', () => {
    let code = transform(`
      export default function() {
        return myDefaultTarget('foo');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('default said: foo.');
    expect(code).toMatch(/import myDefaultTarget from ['"]m['"]/);
  });

  test('can generate a namespace import', () => {
    let code = transform(`
      export default function() {
        return myNamespaceTarget.thing('a') + " " + myNamespaceTarget.default('b');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: a. default said: b.');
    expect(code).toMatch(/import \* as myNamespaceTarget from ['"]m['"]/);
  });

  test('can use an optional name hint', () => {
    let code = transform(`
      export default function() {
        return myHintTarget('foo');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('default said: foo.');
    expect(code).toMatch(/import HINT from ['"]m['"]/);
  });

  test('avoids an existing local binding', () => {
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
    let code = transform(`
      import { thing } from 'm';
      export default function() {
        return myTarget('foo');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: foo.');
    expect(code.match(/import/g)?.length).toEqual(1);
  });

  test('adds to an existing import', () => {
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

  test('subsequent imports avoid previously created bindings', () => {
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
    let code = transform(`
      export default function() {
        return myTarget("a") + " | " + myTarget("b");
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('you said: a. | you said: b.');
    expect(code).toMatch(/import \{ thing \} from ['"]m['"]/);
    expect(code.match(/import/g)?.length).toEqual(1);
  });

  test('multiple uses in different scopes share a specifier', () => {
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
    let code = transform(`
      needsSideEffectThing();
    `);
    expect(code).toMatch(/import ['"]side-effect-thing['"]/);
  });

  test('side-effect import has no effect on existing import', () => {
    let code = transform(`
      import x from 'side-effect-thing';
      needsSideEffectThing();
    `);
    expect(code).toMatch(/import x from ['"]side-effect-thing['"]/);
    expect(code).not.toMatch(/import ['"]side-effect-thing['"]/);
  });

  test('can remove one specifier', () => {
    let code = transform(`
      import { a, b } from 'whatever';
      import other from 'x';
    `);
    expect(code).toMatch(/import \{ b \} from 'whatever'/);
    expect(code).toMatch(/import other from 'x'/);
  });

  test('can remove whole statement', () => {
    let code = transform(`
      import { a } from 'whatever';
      import other from 'x';
    `);
    expect(code).not.toMatch(/whatever/);
    expect(code).toMatch(/import other from 'x'/);
  });

  test('can remove namespace import', () => {
    let code = transform(`
      import * as a from 'remove-my-namespace';
      import * as other from 'x';
    `);
    expect(code).not.toMatch(/remove-my-namespace/);
    expect(code).toMatch(/import \* as other from 'x'/);
  });

  test('can remove all imports', () => {
    let code = transform(`
      import 'remove-all';
    `);
    expect(code).not.toMatch(/remove-all/);
  });

  test("emitted imports get run through other plugin's ImportDeclaration hooks", () => {
    let code = transform(`
      changeMe()
    `);
    expect(code).toMatch(/from "ive-been-changed"/);
  });

  test("emitted side-effectful imports get run through other plugin's ImportDeclaration hooks", () => {
    let code = transform(`
      sideEffectChangeMe()
    `);
    expect(code).toMatch(/import "ive-been-changed"/);
  });

  test("added specifiers get run through other plugin's ImportSpecifier hooks", () => {
    let code = transform(`
      import { other } from "test-import-specifier-handling";
      addTargetThing();
    `);
    expect(code).toMatch(/changedTargetThing/);
  });

  test("added and removed specifier doesn't break other plugins hooks", () => {
    let code = transform(`
      addAndRemove();
    `);
    expect(code).toMatch(/a\(\)/);
    expect(code).not.toMatch(/import/);
  });

  test("added and removed specifier doesn't break other plugins hooks", () => {
    let code = transform(`
      addAndRemoveAll();
    `);
    expect(code).toMatch(/a\(\)/);
    expect(code).not.toMatch(/import/);
  });
}

interface State {
  adder: ImportUtil;
}

function testTransform(babel: { types: typeof t }): unknown {
  return {
    visitor: {
      Program: {
        enter(path: NodePath<t.Program>, state: State) {
          state.adder = new ImportUtil(babel.types, path);
        },
        exit(_path: NodePath<t.Program>, state: State) {
          state.adder.removeImport('whatever', 'a');
          state.adder.removeImport('remove-my-namespace', '*');
          state.adder.removeAllImports('remove-all');
        },
      },
      CallExpression(path: NodePath<t.CallExpression>, state: State) {
        let callee = path.get('callee');
        if (!callee.isIdentifier()) {
          return;
        }
        if (callee.node.name === 'myTarget') {
          callee.replaceWith(state.adder.import(callee, 'm', 'thing'));
        } else if (callee.node.name === 'second') {
          callee.replaceWith(state.adder.import(callee, 'n', 'thing'));
        } else if (callee.node.name === 'myDefaultTarget') {
          callee.replaceWith(state.adder.import(callee, 'm', 'default'));
        } else if (callee.node.name === 'myHintTarget') {
          callee.replaceWith(state.adder.import(callee, 'm', 'default', 'HINT'));
        } else if (callee.node.name === 'needsSideEffectThing') {
          state.adder.importForSideEffect('side-effect-thing');
        } else if (callee.node.name === 'changeMe') {
          callee.replaceWith(state.adder.import(callee, 'change-me', 'default'));
        } else if (callee.node.name === 'sideEffectChangeMe') {
          state.adder.importForSideEffect('change-me');
        } else if (callee.node.name === 'addTargetThing') {
          callee.replaceWith(
            state.adder.import(callee, 'test-import-specifier-handling', 'targetThing')
          );
        } else if (callee.node.name === 'addAndRemove') {
          callee.replaceWith(state.adder.import(callee, 'whatever', 'a'));
        } else if (callee.node.name === 'addAndRemoveAll') {
          callee.replaceWith(state.adder.import(callee, 'remove-all', 'a'));
        }
      },
      MemberExpression(path: NodePath<t.MemberExpression>, state: State) {
        let obj = path.get('object');
        if (!obj.isIdentifier()) {
          return;
        }
        if (obj.node.name === 'myNamespaceTarget') {
          obj.replaceWith(state.adder.import(obj, 'm', '*'));
        }
      },
      ImportDeclaration(path: NodePath<t.ImportDeclaration>) {
        if (path.node.source.value === 'change-me') {
          path.node.source.value = 'ive-been-changed';
        }
      },
      ImportSpecifier(path: NodePath<t.ImportSpecifier>) {
        let value =
          path.node.imported.type === 'StringLiteral'
            ? path.node.imported.value
            : path.node.imported.name;
        if (
          // running this check unconditionally is important -- it is making
          // sure that this plugin never sees a path with a missing parent.
          path.parent.type === 'ImportDeclaration' &&
          path.parent.source.value === 'test-import-specifier-handling' &&
          value === 'targetThing'
        ) {
          path.node.imported = babel.types.identifier('changedTargetThing');
        }
      },
    },
  };
}

describe('import-adder', () => {
  allBabelVersions({
    babelConfig() {
      return {
        plugins: [testTransform],
      };
    },
    createTests: importUtilTests,
  });
});
