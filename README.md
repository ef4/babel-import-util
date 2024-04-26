# babel-import-util

Makes it easier for a babel plugin to emit imported names. Key benefits:

- the output composes correctly with subsequent babel plugins, because we update Babel's understanding of the bindings
- redundant imports will be deduplicated automatically
- written in TypeScript

## Usage by example:

If you want to rewrite:

```js
myTarget('hello world');
```

To:

```js
import { theMethod } from 'my-implementation';
theMethod('hello world');
```

Your plugin would look like this:

```js
function testTransform(babel) {
  return {
    visitor: {
      Program: {
        enter(path, state) {
          // Always instantiate the ImportUtil instance at the Program scope
          state.importUtil = new ImportUtil(babel.types, path);
        },
      },
      CallExpression(path, state) {
        let callee = path.get('callee');
        if (callee.isIdentifier() && callee.node.name === 'myTarget') {
          state.importUtil.replaceWith(callee, (i) =>
            i.import(callee, 'my-implementation', 'theMethod')
          );
        }
      },
    },
  };
}
```

## API

```ts
import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';

class ImportUtil {
  /*
   Replace `target` with the new node produced by your callback. Your
   callback can use `i.import` to gain access to imported identifiers.

   Example:

   util.replaceWith(path, (i) =>
     t.callExpression(i.import('my-library', 'someFunction'), [])
   );
  */
  replaceWith<T extends t.Node, R extends t.Node>(
    target: NodePath<T>,
    fn: (i: Importer) => R
  ): NodePath<R>;

  /*
    Similar to `replaceWith` above, except instead of replacing the target 
    we will insert the new Node before or after it.
  */
  insertAfter<T extends t.Node, R extends t.Node>(
    target: NodePath<T>,
    fn: (i: Importer) => R
  ): NodePath<R>;
  insertBefore<T extends t.Node, R extends t.Node>(
    target: NodePath<T>,
    fn: (i: Importer) => R
  ): NodePath<R>;

  // If needed, adds a bare import like:
  //    import "your-module";
  importForSideEffect(moduleSpecifier: string): void;

  // Remove an import specifier. If the removed specifier is
  // the last one on the whole import statement, the whole
  // statement is also removed.
  //
  // You can use "default" and "*" as exportedName to handle
  // those special cases.
  removeImport(moduleSpecifier: string, exportedName: string): void;

  // Remove all imports from the given moduleSpecifier. Unlike
  // removeImport(), this can also remove "bare" import statements
  //  that were purely for side effect.
  removeAllImports(moduleSpecifier: string): void;

  // Import the given value (if needed) and return an Identifier representing
  // it.
  // CAUTION: this is a lower-level API that leaves some of the reference
  // safety up to you. It's better to use replaceWith, insertAfter, insertBefore,
  // or mutate. But this can still be helpful in contexts where you're already
  // planning to manage babel's scopes anyawy.
  import(
    // the spot at which you will insert the Identifier we return to you
    target: NodePath<t.Node>,

    // the path to the module you're importing from
    moduleSpecifier: string,

    // the name you're importing from that module. Use "default" for the default
    // export. Use "*" for the namespace.
    exportedName: string,

    // Optional hint for helping us pick a name for the imported binding
    nameHint?: string
  ): t.Identifier;
}
```
