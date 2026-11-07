/**
 * Prettier plugin: keeps every import and re-export (`export ... from`) on a single line,
 * whatever the printWidth. Wraps the built-in estree printer and prints those statements
 * with an infinite width, so the named list never breaks into one name per line.
 */
import * as estree from 'prettier/plugins/estree';
import { doc } from 'prettier';

const base = estree.printers.estree;

const isOneLiner = node =>
    node.type === 'ImportDeclaration' ||
    ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source != null);

export const printers = {
    estree: {
        ...base,
        print(path, options, print, args) {
            const printed = base.print(path, options, print, args);
            if (!isOneLiner(path.node)) {
                return printed;
            }
            const { formatted } = doc.printer.printDocToString(printed, { ...options, printWidth: Infinity });
            return formatted;
        },
    },
};
