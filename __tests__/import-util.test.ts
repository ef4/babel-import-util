import { allBabelVersions, runDefault } from './test-support';
import { ImportUtil } from '../src/index';
import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import 'code-equality-assertions/jest';

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

  test('emits new imports after preexisting other imports', () => {
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

  test('sanitizes name hint to make it a valid javascript identifier', () => {
    let code = transform(`
      export default function() {
        return myMessyHintTarget('foo');
      }
      `);
    expect(runDefault(code, { dependencies })).toEqual('default said: foo.');
    expect(code).toMatch(/import thisIsTheHint from ['"]m['"]/);
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
        } else if (callee.node.name === 'myMessyHintTarget') {
          callee.replaceWith(state.adder.import(callee, 'm', 'default', 'this-is: the hint!'));
        } else if (callee.node.name === 'needsSideEffectThing') {
          state.adder.importForSideEffect('side-effect-thing');
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
