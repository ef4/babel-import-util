import type * as Babel from '@babel/core';
import type { types as t, NodePath } from '@babel/core';

export class ImportUtil {
  private t: typeof Babel.types;

  constructor(private babel: typeof Babel, private program: NodePath<t.Program>) {
    this.t = babel.types;
  }

  // remove one imported binding. If this is the last thing imported from the
  // given moduleSpecifier, the whole statement will also be removed.
  removeImport(moduleSpecifier: string, exportedName: string): void {
    for (let topLevelPath of this.program.get('body')) {
      if (!matchModule(topLevelPath, moduleSpecifier)) {
        continue;
      }

      let importSpecifierPath = topLevelPath
        .get('specifiers')
        .find((specifierPath) => matchSpecifier(specifierPath, exportedName));
      if (importSpecifierPath) {
        if (topLevelPath.node.specifiers.length === 1) {
          topLevelPath.remove();
        } else {
          importSpecifierPath.remove();
        }
      }
    }
  }

  // remove all imports from the given moduleSpecifier
  removeAllImports(moduleSpecifier: string): void {
    for (let topLevelPath of this.program.get('body')) {
      if (matchModule(topLevelPath, moduleSpecifier)) {
        topLevelPath.remove();
      }
    }
  }

  // Import the given value (if needed) and return an Identifier representing
  // it.
  //
  // This method is trickier to use safely than our higher-level methods
  // (`insertAfter`, `insertBefore`, `replaceWith`, `mutate`) because after you
  // insert the identifier into the AST, it's up to you to ensure that babel's
  // scope system is aware of the new reference. The other methods do that for
  // you automatically.
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
  ): t.Identifier {
    return this.unreferencedImport(
      target,
      moduleSpecifier,
      exportedName,
      desiredName(nameHint, exportedName, defaultNameHint(target))
    );
  }

  // Import the given value (if needed) and return an Identifier representing
  // it.
  private unreferencedImport(
    // the spot at which you will insert the Identifier we return to you
    target: NodePath<t.Node>,

    // the path to the module you're importing from
    moduleSpecifier: string,

    // the name you're importing from that module. Use "default" for the default
    // export. Use "*" for the namespace.
    exportedName: string,

    // the preferred name you want, if we neeed to create a new binding. You
    // might get something similar instead, to avoid collisions.
    preferredName: string
  ): t.Identifier {
    let isNamespaceImport = exportedName === '*';
    let isDefaultImport = exportedName === 'default';
    let isNamedImport = !isDefaultImport && !isNamespaceImport;
    let declaration = this.findImportFrom(moduleSpecifier);
    let hasNamespaceSpecifier = declaration?.node.specifiers.find(
      (s) => s.type === 'ImportNamespaceSpecifier'
    );
    let hasNamedSpecifiers = declaration?.node.specifiers.find((s) => s.type === 'ImportSpecifier');

    /**
     * the file has a preexisting non-namespace import and a transform tries to add a namespace import, so they don't get combined
     * the file has a preexisting namespace import and a transform tries to add a non-namespace import, so they don't get combined
     * the file has a preexisting namespace import and a transform tries to add a namespace import, so they don't get combined
     */
    let cannotUseExistingDeclaration =
      (hasNamedSpecifiers && isNamespaceImport) ||
      (hasNamespaceSpecifier && isNamedImport) ||
      (hasNamespaceSpecifier && isNamespaceImport);

    if (!cannotUseExistingDeclaration && declaration) {
      let specifier = declaration
        .get('specifiers')
        .find((spec) => matchSpecifier(spec, exportedName));
      if (specifier && target.scope.getBinding(specifier.node.local.name)?.kind === 'module') {
        return this.t.identifier(specifier.node.local.name);
      } else {
        return this.addSpecifier(target, declaration, exportedName, preferredName);
      }
    } else {
      let declaration = this.insertAfterExistingImports(
        this.t.importDeclaration([], this.t.stringLiteral(moduleSpecifier))
      );
      return this.addSpecifier(target, declaration, exportedName, preferredName);
    }
  }

  importForSideEffect(moduleSpecifier: string): void {
    let declaration = this.findImportFrom(moduleSpecifier);
    if (!declaration) {
      this.insertAfterExistingImports(
        this.t.importDeclaration([], this.t.stringLiteral(moduleSpecifier))
      );
    }
  }

  replaceWith<T extends t.Node, R extends t.Node>(
    target: NodePath<T>,
    fn: (i: Importer) => R
  ): NodePath<R> {
    return this.mutate((i) => target.replaceWith(fn(i))[0], defaultNameHint(target));
  }

  insertAfter<T extends t.Node, R extends t.Node>(
    target: NodePath<T>,
    fn: (i: Importer) => R
  ): NodePath<R> {
    return this.mutate((i) => target.insertAfter(fn(i))[0] as NodePath<R>, defaultNameHint(target));
  }

  insertBefore<T extends t.Node, R extends t.Node>(
    target: NodePath<T>,
    fn: (i: Importer) => R
  ): NodePath<R> {
    return this.mutate(
      (i) => target.insertBefore(fn(i))[0] as NodePath<R>,
      defaultNameHint(target)
    );
  }

  // Low-level method for when you don't want to use our higher-level methods
  // (replaceWith, insertBefore, insertAfter)
  mutate<Replacement extends t.Node>(
    fn: (importer: Importer) => NodePath<Replacement>,
    defaultNameHint?: string
  ): NodePath<Replacement> {
    let symbols: Map<
      t.Identifier,
      { moduleSpecifier: string; exportedName: string; nameHint: string | undefined }
    > = new Map();
    const importer: Importer = {
      import: (moduleSpecifier: string, exportedName: string, nameHint?: string) => {
        let identifier = this.t.identifier('__babel_import_util_placeholder__');
        symbols.set(identifier, { moduleSpecifier, exportedName, nameHint });
        return identifier;
      },
    };

    const updateReference = (path: NodePath) => {
      if (!path.isIdentifier()) {
        return;
      }
      let hit = symbols.get(path.node);
      if (hit) {
        let newIdentifier = this.unreferencedImport(
          path,
          hit.moduleSpecifier,
          hit.exportedName,
          desiredName(hit.nameHint, hit.exportedName, defaultNameHint)
        );
        path.replaceWith(newIdentifier);
        let binding = path.scope.getBinding(newIdentifier.name);
        if (!binding) {
          // we create the binding at the point where we add the import, so this
          // would indicate broken behavior
          throw new Error(`bug: this is supposed to never happen`);
        }
        binding.reference(path);
      }
    };

    let result = fn(importer);
    updateReference(result);
    this.babel.traverse(
      result.node,
      {
        ReferencedIdentifier: (path) => {
          updateReference(path);
        },
      },
      result.scope,
      {},
      result
    );
    return result;
  }

  private addSpecifier(
    target: NodePath<t.Node>,
    declaration: NodePath<t.ImportDeclaration>,
    exportedName: string,
    preferredName: string
  ): t.Identifier {
    let local = this.t.identifier(unusedNameLike(target, preferredName));
    let specifier = this.buildSpecifier(exportedName, local);
    let added: NodePath;
    if (specifier.type === 'ImportDefaultSpecifier') {
      declaration.node.specifiers.unshift(specifier);
      added = declaration.get(`specifiers.0`) as NodePath;
    } else {
      declaration.node.specifiers.push(specifier);
      added = declaration.get(`specifiers.${declaration.node.specifiers.length - 1}`) as NodePath;
    }
    declaration.scope.registerBinding('module', added);
    return local;
  }

  private buildSpecifier(exportedName: string, localName: t.Identifier) {
    switch (exportedName) {
      case 'default':
        return this.t.importDefaultSpecifier(localName);
      case '*':
        return this.t.importNamespaceSpecifier(localName);
      default:
        return this.t.importSpecifier(localName, this.t.identifier(exportedName));
    }
  }

  private findImportFrom(moduleSpecifier: string): NodePath<t.ImportDeclaration> | undefined {
    for (let path of this.program.get('body')) {
      if (
        path.isImportDeclaration() &&
        path.node.source.value === moduleSpecifier &&
        path.node.importKind !== 'type'
      ) {
        return path;
      }
    }
    return undefined;
  }

  private insertAfterExistingImports<S extends t.Statement>(statement: S): NodePath<S> {
    let lastIndex: number | undefined;
    for (let [index, node] of this.program.node.body.entries()) {
      if (node.type === 'ImportDeclaration') {
        lastIndex = index;
      }
    }
    if (lastIndex == null) {
      // we are intentionally not using babel's container-aware methods, because
      // while in theory it's nice that they schedule other plugins to run on
      // our nodes, in practice those nodes might get mutated or removed by some
      // other plugin in the intervening time causing failures.
      this.program.node.body.unshift(statement);
      return this.program.get('body.0') as NodePath<S>;
    } else {
      this.program.node.body.splice(lastIndex + 1, 0, statement);
      return this.program.get(`body.${lastIndex + 1}`) as NodePath<S>;
    }
  }
}

function unusedNameLike(path: NodePath<t.Node>, name: string): string {
  let candidate = name;
  let counter = 0;
  while (path.scope.hasBinding(candidate)) {
    candidate = `${name}${counter++}`;
  }
  return candidate;
}

function name(node: t.StringLiteral | t.Identifier): string {
  if (node.type === 'StringLiteral') {
    return node.value;
  } else {
    return node.name;
  }
}

function desiredName(
  nameHint: string | undefined,
  exportedName: string,
  defaultNameHint: string | undefined
) {
  if (nameHint) {
    // first we opportunistically do camelization when an illegal character is
    // followed by a lowercase letter, in an effort to aid readability of the
    // output.
    let cleaned = nameHint.replace(/[^a-zA-Z_]([a-z])/g, (_m, letter) => letter.toUpperCase());
    // then we unliterally strip all remaining illegal characters.
    cleaned = cleaned.replace(/[^a-zA-Z_]/g, '');
    return cleaned;
  }
  if (exportedName === 'default' || exportedName === '*') {
    return defaultNameHint ?? 'a';
  } else {
    return exportedName;
  }
}

function defaultNameHint(target: NodePath): string | undefined {
  if (target?.isIdentifier()) {
    return target.node.name;
  } else if (target) {
    return target.scope.generateUidIdentifierBasedOnNode(target.node).name;
  } else {
    return undefined;
  }
}

function matchSpecifier(spec: NodePath<any>, exportedName: string): boolean {
  switch (exportedName) {
    case 'default':
      return spec.isImportDefaultSpecifier();
    case '*':
      return spec.isImportNamespaceSpecifier();
    default:
      return spec.isImportSpecifier() && name(spec.node.imported) === exportedName;
  }
}

function matchModule(
  path: NodePath<any>,
  moduleSpecifier: string
): path is NodePath<t.ImportDeclaration> {
  return path.isImportDeclaration() && path.get('source').node.value === moduleSpecifier;
}

export interface Importer {
  // Import the given value (if needed) and return an Identifier representing
  // it.
  import(
    // the path to the module you're importing from
    moduleSpecifier: string,

    // the name you're importing from that module. Use "default" for the default
    // export. Use "*" for the namespace.
    exportedName: string,

    // Optional hint for helping us pick a name for the imported binding
    nameHint?: string
  ): t.Identifier;
}
