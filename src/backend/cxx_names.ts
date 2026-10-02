/*
 * Helpers to deal with (demangled) C++ symbol names when talking to gdb.
 *
 * objdump/nm give us names like 'ns::Pool<int, 8u>::count' or 'ns::(anonymous namespace)::x'. These are not
 * always valid gdb expressions and gdb may not even be able to find them until it has read the debug info of
 * the right compilation unit. Its lookup tables use the names from the debug info ('Pool<int, 8>') which do
 * not always match what the demangler produces ('Pool<int, 8u>').
 *
 * No dependencies on purpose, so this file can be unit-tested without a debug session.
 */

const IDENTIFIER_RE = /^[A-Za-z_$][\w$]*$/;
const FORMAT_SUFFIX_RE = /,[bdhonx]$/i;
const COMPILER_GENERATED_RE = new RegExp('^(?:'
    + 'vtable|VTT|construction vtable|typeinfo|typeinfo name|guard variable|reference temporary #\\d+|'
    + 'TLS init function|TLS wrapper function|virtual thunk|non-virtual thunk|covariant return thunk'
    + ') (?:for|to) ');

/** True for a plain identifier, which is what all names in C are */
export function isPlainIdentifier(name: string): boolean {
    return IDENTIFIER_RE.test(name);
}

/** True for objects the compiler creates on its own. They have no debug info and are of no interest in a variables view */
export function isCompilerGeneratedName(name: string): boolean {
    return COMPILER_GENERATED_RE.test(name);
}

/**
 * Convert a demangled name to how the compiler spells it in the debug info, as far as we can tell. The
 * demangler adds a type suffix to integer template arguments ('Pool<int, 8u>'), gcc/gdb do not ('Pool<int, 8>')
 */
export function toDebugInfoName(name: string): string {
    return name.replace(/\b(\d+)(?:ull|ul|ll|u|l)\b/gi, '$1');
}

/** True if the name can be parsed by gdb as an expression without quoting it */
export function isExpressibleName(name: string): boolean {
    return !/\(anonymous namespace\)|[{}[\]'"]/.test(name);
}

function quote(str: string): string {
    return `'${str}'`;
}

/**
 * Returns gdb expressions to try, best one first, for a global/static variable given its demangled name
 * and (optionally) the source file that defines it.
 */
export function gdbExpressionsForSymbol(name: string, file?: string): string[] {
    if (isPlainIdentifier(name)) {
        return [name];
    }
    // A quoted name is looked up as a symbol, as is. Unlike a C++ expression, that also works when stopped
    // in a C function where gdb switches to the C language and '::' is a syntax error. We can end up in
    // C code any time, so it is not enough for an expression to work when the variable is first shown
    const ret = [quote(name)];
    if (isExpressibleName(name)) {
        // For a static member, this is resolved via the type of its class. Helps if gdb does not have
        // the symbol under the name that the demangler gave us
        ret.push(toDebugInfoName(name));
    }
    if (file) {
        // Makes gdb read the debug info of (some) compilation unit that uses the file before the lookup
        ret.push(`${quote(file.replace(/\\/g, '/'))}::${quote(name)}`);
    }
    return ret;
}

/** Expression for a static (local linkage) variable in a given source file */
export function gdbExpressionForFileStatic(name: string, file: string): string {
    file = quote(file.replace(/\\/g, '/'));
    // C names are left alone. This is what we always did and what a user would type
    return `${file}::${isPlainIdentifier(name) ? name : quote(name)}`;
}

/** Name for a gdb variable object. They cannot contain white space, quotes, etc. */
export function isSafeGdbVarName(name: string): boolean {
    return /^[\w$:.]+$/.test(name);
}

/**
 * Splits 'ns::Class<int, (char)65>::member' into ['ns::Class<int, (char)65>', 'member']. The qualifier is empty
 * if there is none. Brackets of any kind are skipped over, so '::' inside template arguments or parameter lists
 * do not count.
 */
export function splitQualifiedName(name: string): [string, string] {
    const opMatch = /^(.*?)::(operator(?![\w$]).*)$/.exec(name);
    if (opMatch) {
        // 'operator<', 'operator->' and friends would confuse the bracket matching
        return [opMatch[1], opMatch[2]];
    }
    let depth = 0;
    for (let ix = name.length - 1; ix > 0; ix--) {
        const ch = name[ix];
        if ((ch === '>') || (ch === ')') || (ch === ']') || (ch === '}')) {
            depth++;
        } else if ((ch === '<') || (ch === '(') || (ch === '[') || (ch === '{')) {
            depth--;
        } else if ((depth === 0) && (ch === ':') && (name[ix - 1] === ':')) {
            return [name.substring(0, ix - 1), name.substring(ix + 1)];
        }
    }
    return ['', name];
}

/**
 * If name looks like a data member of a class/namespace ('ns::Class<int>::member') return the qualifier
 * ('ns::Class<int>'), or an empty string otherwise.
 */
export function getMemberQualifier(name: string): string {
    const [qualifier, member] = splitQualifiedName(name);
    if (!qualifier || !IDENTIFIER_RE.test(member)) {
        return '';
    }
    // 'func(int)::var' is a static local of a function and not a member of anything
    return (qualifier.endsWith(')') && !qualifier.endsWith('(anonymous namespace)')) ? '' : qualifier;
}

/**
 * Returns the symbol name if the expression is nothing but a reference to a C++ symbol that gdb may fail to
 * find without help: a quoted name with an optional file ('file.cpp'::'ns::Pool<int, 8u>::count') or an
 * unquoted qualified name with template arguments (ns::Pool<int, 8>::count). Otherwise, returns an empty string.
 */
export function getSymbolNameFromExpression(expression: string): string {
    let expr = expression.trim();
    if (FORMAT_SUFFIX_RE.test(expr)) {
        expr = expr.substring(0, expr.length - 2).trim();
    }
    const quoted = /^(?:'[^']+'::)?'([^']+)'$/.exec(expr);
    if (quoted) {
        return quoted[1];
    }
    if (!expr.includes('::') || !expr.includes('<') || !/^[A-Za-z_$][\w$:<>,\s*&()-]*[\w$>]$/.test(expr)) {
        return '';
    }
    let depth = 0;
    for (const ch of expr) {
        depth += (ch === '<') ? 1 : ((ch === '>') ? -1 : 0);
        if (depth < 0) {
            return '';
        }
    }
    return (depth === 0) ? expr : '';
}

/**
 * Creates a (POSIX basic) regular expression for gdb's 'info variables' that matches the given symbol name, no
 * matter how its template arguments are spelled or if they are there at all. gdb matches it against the names
 * in its lookup tables and then reads the debug info of every compilation unit that has a match.
 */
export function makeInfoVariablesRegex(name: string): string {
    let ret = '';
    let depth = 0;
    for (let ix = 0; ix < name.length; ix++) {
        const ch = name[ix];
        if ((ch === '<') && ((depth > 0) || /[\w$]/.test(name[ix - 1] || ''))) {
            if (depth === 0) {
                ret += '.*';
            }
            depth++;
        } else if ((ch === '>') && (depth > 0)) {
            depth--;
        } else if (depth === 0) {
            ret += /[\\.*[\]^$]/.test(ch) ? '\\' + ch : ch;
        }
    }
    return `^${ret}$`;
}
