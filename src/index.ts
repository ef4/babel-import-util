import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';

type BabelTypes = typeof t;

export class ImportUtil {
  constructor(private t: BabelTypes, private program: NodePath<t.Program>) {}

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
    let declaration = this.findImportFrom(moduleSpecifier);
    if (declaration) {
      let specifier = declaration
        .get('specifiers')
        .find((spec) => matchSpecifier(spec, exportedName));
      if (specifier && target.scope.getBinding(specifier.node.local.name)?.kind === 'module') {
        return this.t.identifier(specifier.node.local.name);
      } else {
        return this.addSpecifier(target, declaration, exportedName, nameHint);
      }
    } else {
      let declaration = this.insertAfterExistingImports(
        this.t.importDeclaration([], this.t.stringLiteral(moduleSpecifier))
      );
      return this.addSpecifier(target, declaration, exportedName, nameHint);
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

  private addSpecifier(
    target: NodePath<t.Node>,
    declaration: NodePath<t.ImportDeclaration>,
    exportedName: string,
    nameHint: string | undefined
  ): t.Identifier {
    let local = this.t.identifier(
      unusedNameLike(target, desiredName(nameHint, exportedName, target))
    );
    let specifier = this.buildSpecifier(exportedName, local);
    declaration.node.specifiers.push(specifier);
    declaration.scope.registerBinding(
      'module',
      declaration.get(`specifiers.${declaration.node.specifiers.length - 1}`) as NodePath
    );
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
      if (path.isImportDeclaration() && path.node.source.value === moduleSpecifier) {
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

function desiredName(nameHint: string | undefined, exportedName: string, target: NodePath<t.Node>) {
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
    if (target.isIdentifier()) {
      return target.node.name;
    } else {
      return target.scope.generateUidIdentifierBasedOnNode(target.node).name;
    }
  } else {
    return exportedName;
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
