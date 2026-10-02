import * as assert from 'assert';
import {
    gdbExpressionForFileStatic, gdbExpressionsForSymbol, getMemberQualifier, getSymbolNameFromExpression,
    isCompilerGeneratedName, isExpressibleName, isPlainIdentifier, isSafeGdbVarName, makeInfoVariablesRegex,
    splitQualifiedName, toDebugInfoName
} from '../../src/backend/cxx_names';

suite('C++ symbol names', () => {
    test('C names', () => {
        assert.strictEqual(isPlainIdentifier('counter'), true);
        assert.strictEqual(isPlainIdentifier('_SEGGER_RTT'), true);
        assert.strictEqual(isPlainIdentifier('app::Scheduler::ticks'), false);
        assert.strictEqual(isPlainIdentifier('counter.0'), false);
        assert.strictEqual(isPlainIdentifier('g_maxSeen<int>'), false);
        assert.strictEqual(isPlainIdentifier(''), false);
    });

    test('Compiler generated objects', () => {
        assert.strictEqual(isCompilerGeneratedName('vtable for app::Foo'), true);
        assert.strictEqual(isCompilerGeneratedName('typeinfo name for app::Foo<int>'), true);
        assert.strictEqual(isCompilerGeneratedName('guard variable for app::get()::instance'), true);
        assert.strictEqual(isCompilerGeneratedName('non-virtual thunk to app::Foo::bar()'), true);
        assert.strictEqual(isCompilerGeneratedName('app::Foo::vtable'), false);
        assert.strictEqual(isCompilerGeneratedName('typeinfo_cache'), false);
    });

    test('Names as spelled in debug info', () => {
        assert.strictEqual(toDebugInfoName('app::Pool<int, 8u>::count'), 'app::Pool<int, 8>::count');
        assert.strictEqual(toDebugInfoName('Pool<Item, 16ul>::Pool<long, -1l>::x'), 'Pool<Item, 16>::Pool<long, -1>::x');
        assert.strictEqual(toDebugInfoName('Mask<4294967295ull, 0ll>::value'), 'Mask<4294967295, 0>::value');
        // Nothing to convert, digits that are part of an identifier stay as they are
        assert.strictEqual(toDebugInfoName('app::Scheduler::ticks'), 'app::Scheduler::ticks');
        assert.strictEqual(toDebugInfoName('Fifo8u<char8_t, x1l>::v2u'), 'Fifo8u<char8_t, x1l>::v2u');
        assert.strictEqual(toDebugInfoName('Foo<(char)65, (app::Mode)1>::x'), 'Foo<(char)65, (app::Mode)1>::x');
    });

    test('Expressible names', () => {
        assert.strictEqual(isExpressibleName('app::Pool<int, 8u>::count'), true);
        assert.strictEqual(isExpressibleName('app::accumulate<float>(float)::total'), true);
        assert.strictEqual(isExpressibleName('app::(anonymous namespace)::x'), false);
        assert.strictEqual(isExpressibleName('main::{lambda()#1}::operator()() const::n'), false);
        assert.strictEqual(isExpressibleName('foo[abi:cxx11]'), false);
    });

    test('Expressions for globals', () => {
        // C names are used as they are, like we always did
        assert.deepStrictEqual(gdbExpressionsForSymbol('g_counter'), ['g_counter']);
        assert.deepStrictEqual(gdbExpressionsForSymbol('g_weak', '/src/main.c'), ['g_weak']);
        // For C++, the quoted name comes first. It is the only form that also works in a C frame
        assert.deepStrictEqual(gdbExpressionsForSymbol('app::Pool<int, 8u>::count', '/src/pool.hpp'), [
            '\'app::Pool<int, 8u>::count\'',
            'app::Pool<int, 8>::count',
            '\'/src/pool.hpp\'::\'app::Pool<int, 8u>::count\''
        ]);
        assert.deepStrictEqual(gdbExpressionsForSymbol('app::Scheduler::load', 'C:\\src\\sched.hpp'), [
            '\'app::Scheduler::load\'',
            'app::Scheduler::load',
            '\'C:/src/sched.hpp\'::\'app::Scheduler::load\''
        ]);
        assert.deepStrictEqual(gdbExpressionsForSymbol('app::Scheduler::ticks'), [
            '\'app::Scheduler::ticks\'',
            'app::Scheduler::ticks'
        ]);
        assert.deepStrictEqual(gdbExpressionsForSymbol('(anonymous namespace)::Foo::x'), [
            '\'(anonymous namespace)::Foo::x\''
        ]);
    });

    test('Expressions for file statics', () => {
        assert.strictEqual(gdbExpressionForFileStatic('counter', '/src/main.c'), '\'/src/main.c\'::counter');
        assert.strictEqual(gdbExpressionForFileStatic('app::s_calls', 'C:\\src\\mod.cpp'), '\'C:/src/mod.cpp\'::\'app::s_calls\'');
        assert.strictEqual(
            gdbExpressionForFileStatic('app::(anonymous namespace)::s_filtered', '/src/mod.cpp'),
            '\'/src/mod.cpp\'::\'app::(anonymous namespace)::s_filtered\'');
        assert.strictEqual(
            gdbExpressionForFileStatic('app::tick()::lastSeen', '/src/main.cpp'),
            '\'/src/main.cpp\'::\'app::tick()::lastSeen\'');
    });

    test('gdb variable object names', () => {
        assert.strictEqual(isSafeGdbVarName('app::Scheduler::ticks'), true);
        assert.strictEqual(isSafeGdbVarName('counter.0'), true);
        assert.strictEqual(isSafeGdbVarName('app::Pool<int, 8u>::count'), false);
        assert.strictEqual(isSafeGdbVarName('app::(anonymous namespace)::x'), false);
        assert.strictEqual(isSafeGdbVarName(''), false);
    });

    test('Qualifiers', () => {
        assert.deepStrictEqual(splitQualifiedName('main'), ['', 'main']);
        assert.deepStrictEqual(splitQualifiedName('app::Scheduler::tick'), ['app::Scheduler', 'tick']);
        assert.deepStrictEqual(splitQualifiedName('app::Pool<app::Item, 16u>::push'), ['app::Pool<app::Item, 16u>', 'push']);
        assert.deepStrictEqual(splitQualifiedName('app::Pool<int, 8u>::push(int const&)'), ['app::Pool<int, 8u>', 'push(int const&)']);
        assert.deepStrictEqual(splitQualifiedName('app::accumulate<float>(float)::total'), ['app::accumulate<float>(float)', 'total']);
        assert.deepStrictEqual(splitQualifiedName('app::accumulate<app::Sample>'), ['app', 'accumulate<app::Sample>']);
        assert.deepStrictEqual(splitQualifiedName('app::Vec::operator<'), ['app::Vec', 'operator<']);
        assert.deepStrictEqual(splitQualifiedName('app::Vec::operator->'), ['app::Vec', 'operator->']);
        assert.deepStrictEqual(splitQualifiedName('app::Vec<int>::operator()'), ['app::Vec<int>', 'operator()']);
        assert.deepStrictEqual(splitQualifiedName('app::operators::count'), ['app::operators', 'count']);
        assert.deepStrictEqual(splitQualifiedName('(anonymous namespace)::Foo::bar'), ['(anonymous namespace)::Foo', 'bar']);
        assert.deepStrictEqual(splitQualifiedName(''), ['', '']);

        assert.strictEqual(getMemberQualifier('app::Pool<int, 8u>::count'), 'app::Pool<int, 8u>');
        assert.strictEqual(getMemberQualifier('app::Scheduler::ticks'), 'app::Scheduler');
        assert.strictEqual(getMemberQualifier('g_plainGlobal'), '');
        // Not data members: a variable template and a static local of a member function
        assert.strictEqual(getMemberQualifier('app::g_maxSeen<int>'), '');
        assert.strictEqual(getMemberQualifier('app::Scheduler::tick()::lastSeen'), '');
        assert.strictEqual(getMemberQualifier('(anonymous namespace)::count'), '(anonymous namespace)');
    });

    test('Symbols in expressions', () => {
        assert.strictEqual(getSymbolNameFromExpression('\'app::Pool<int, 8u>::count\''), 'app::Pool<int, 8u>::count');
        assert.strictEqual(getSymbolNameFromExpression('\'/src/pool.hpp\'::\'app::Pool<int, 8u>::count\''), 'app::Pool<int, 8u>::count');
        assert.strictEqual(getSymbolNameFromExpression(' \'app::g_maxSeen<float>\',x'), 'app::g_maxSeen<float>');
        assert.strictEqual(getSymbolNameFromExpression('app::g_maxSeen<float>'), 'app::g_maxSeen<float>');
        assert.strictEqual(getSymbolNameFromExpression('app::Pool<app::Item, 16>::count,h'), 'app::Pool<app::Item, 16>::count');
        // Everything else is an expression that gdb either understands on its own or not at all
        for (const expr of [
            'counter', 'app::Scheduler::ticks', 'this->count', 'buf.data[3]', 'a < b', 'ns::a < ns::b', 'ns::a<b>::c + 1',
            'std::max<int>(a, b)', '\'/src/main.c\'::counter', '*(int *)0x20000000', '\'a\' == ns::b<c>::d'
        ]) {
            assert.strictEqual(getSymbolNameFromExpression(expr), '', expr);
        }
    });

    test('Regular expressions for info variables', () => {
        assert.strictEqual(makeInfoVariablesRegex('app::Scheduler::load'), '^app::Scheduler::load$');
        assert.strictEqual(makeInfoVariablesRegex('app::g_maxSeen<float>'), '^app::g_maxSeen.*$');
        assert.strictEqual(makeInfoVariablesRegex('app::Pool<app::Item<int>, 16u>::count'), '^app::Pool.*::count$');
        assert.strictEqual(makeInfoVariablesRegex('A<int>::B<char>::c'), '^A.*::B.*::c$');
        assert.strictEqual(makeInfoVariablesRegex('app::accumulate<float>(float)::total'), '^app::accumulate.*(float)::total$');
        assert.strictEqual(makeInfoVariablesRegex('counter.0'), '^counter\\.0$');
        assert.strictEqual(makeInfoVariablesRegex('app::(anonymous namespace)::x'), '^app::(anonymous namespace)::x$');

        // What gdb has in its tables vs. what is demangled must both match
        const re = new RegExp(makeInfoVariablesRegex('app::Pool<app::Item, 16u>::count'));
        for (const name of ['app::Pool<app::Item, 16u>::count', 'app::Pool<app::Item, 16>::count', 'app::Pool::count']) {
            assert.ok(re.test(name), name);
        }
        assert.ok(!re.test('app::Pool<int, 8>::counter'));
        assert.ok(!re.test('other::app::Pool<int, 8>::count'));
    });
});
