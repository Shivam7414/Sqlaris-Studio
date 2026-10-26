<?php

declare(strict_types=1);

// The parts that need no database.

test('only localhost gets in', function () {
    check(dbv_client_allowed('127.0.0.1', '127.0.0.1:8765'), '127.0.0.1');
    check(dbv_client_allowed('::1', '[::1]:8765'), '::1');
    check(dbv_client_allowed('127.0.0.1', 'localhost'), 'localhost');
    check(! dbv_client_allowed('192.168.1.20', 'localhost:8765'), 'another computer on the network');
    check(! dbv_client_allowed('10.0.0.5', '127.0.0.1'), 'a private address that was not allowed');
    check(! dbv_client_allowed('', 'localhost'), 'no address at all');
});

test('the Host header must name this computer, so a domain pointed at 127.0.0.1 is refused', function () {
    check(! dbv_client_allowed('127.0.0.1', 'evil.example'), 'evil.example');
    check(! dbv_client_allowed('127.0.0.1', 'localhost.evil.example:8765'), 'a name that starts with localhost');
    check(! dbv_client_allowed('127.0.0.1', ''), 'no Host header');
    check(! dbv_client_allowed('172.17.0.1', 'evil.example', '172.17.0.0/16'), 'an allowed address still needs the right Host');
});

test('SQLARIS_ALLOW_FROM adds addresses and ranges, and nothing else', function () {
    check(dbv_client_allowed('172.17.0.1', 'localhost:8765', '172.17.0.1'), 'one address');
    check(dbv_client_allowed('172.18.4.9', 'localhost', '10.0.0.0/8, 172.16.0.0/12'), 'in the second range');
    check(! dbv_client_allowed('172.32.0.1', 'localhost', '172.16.0.0/12'), 'just outside the range');
    check(dbv_client_allowed('fd00::5', 'localhost', 'fd00::/8'), 'an IPv6 range');
    check(! dbv_client_allowed('10.0.0.1', 'localhost', 'not-an-address, 10.0.0.1/99, /8'), 'nonsense ranges allow nothing');
});

test('a CIDR range matches on bits that are not a whole byte', function () {
    check(dbv_ip_in_range('192.168.1.130', '192.168.1.128/25'), 'inside /25');
    check(! dbv_ip_in_range('192.168.1.127', '192.168.1.128/25'), 'outside /25');
    check(dbv_ip_in_range('8.8.8.8', '0.0.0.0/0'), '/0 is everything');
    check(! dbv_ip_in_range('127.0.0.1', '::1/128'), 'IPv4 never matches an IPv6 range');
});

test('new names may only be letters, digits and underscores', function () {
    same('orders_copy', dbv_new_name('  orders_copy '));
    same('_x', dbv_new_name('_x'));

    foreach (['', '1st', 'a b', 'a-b', 'a;drop table x', 'a"b', 'a`b', "a'b", 'ä', str_repeat('a', 64), "a\nb"] as $bad) {
        fails(fn () => dbv_new_name($bad), 'letters, digits and underscores');
    }
});

test('a search escapes LIKE wildcards, so % and _ match themselves', function () {
    same('50\\% off', dbv_like('50% off'));
    same('a\\_b', dbv_like('a_b'));
    same('back\\\\slash', dbv_like('back\\slash'));
});

test('.env lines are read with quotes and trailing comments', function () {
    $file = tempnam(sys_get_temp_dir(), 'env');
    file_put_contents($file, implode("\n", [
        '# a comment',
        'PLAIN=value',
        'SPACED = spaced value  # a note',
        'QUOTED="has # hash"',
        "SINGLE='x'",
        'EMPTY=',
        'not a line',
    ]));

    same(['PLAIN' => 'value', 'SPACED' => 'spaced value', 'QUOTED' => 'has # hash', 'SINGLE' => 'x', 'EMPTY' => ''], dbv_env_file($file));
    same([], dbv_env_file($file.'-missing'));
    unlink($file);
});

test('only and hide decide which databases can be opened', function () {
    $server = ['only' => ['shop*'], 'hide' => ['shop_old']];
    check(dbv_listed($server, 'shop'), 'shop');
    check(dbv_listed($server, 'SHOP_2026'), 'matching ignores case');
    check(! dbv_listed($server, 'shop_old'), 'hidden');
    check(! dbv_listed($server, 'postgres'), 'not in only');
    check(! dbv_listed(['only' => [], 'hide' => ['*']], 'anything'), 'hide everything');
    // A pattern is a glob, not a regex.
    check(! dbv_listed(['only' => ['a.c'], 'hide' => []], 'abc'), 'a dot is a dot');
});

// Protected databases. dbv_protection says why a database is protected: 'config' when config.php lists a
// pattern for it, 'you' when the page marked it, null when it is not protected.

test('a pattern in protect protects the databases whose names match it, ignoring case', function () {
    $server = ['key' => 'pg', 'protect' => ['*prod*', 'shop_live']];
    $layout = ['protected' => []];

    same('config', dbv_protection($server, 'prod', $layout), 'the star may match nothing');
    same('config', dbv_protection($server, 'shop_prod_2026', $layout), 'a star on each side');
    same('config', dbv_protection($server, 'MyPROD', $layout), 'matching ignores case');
    same('config', dbv_protection($server, 'shop_live', $layout), 'a name without a star');
    same('config', dbv_protection($server, 'SHOP_LIVE', $layout), 'a name without a star, in another case');
    same(null, dbv_protection($server, 'shop_live_old', $layout), 'without a star the whole name has to match');
    same(null, dbv_protection($server, 'shop', $layout), 'no pattern matches');
});

test('a pattern in protect is a glob, not a regex, and an empty list protects nothing', function () {
    $layout = ['protected' => []];
    $server = ['key' => 'pg', 'protect' => ['a.c', 'x+', 'q?']];

    same('config', dbv_protection($server, 'a.c', $layout));
    same(null, dbv_protection($server, 'abc', $layout), 'a dot is a dot');
    same('config', dbv_protection($server, 'x+', $layout));
    same(null, dbv_protection($server, 'xx', $layout), 'a plus is a plus');
    same(null, dbv_protection($server, 'qq', $layout), 'a question mark is a question mark');
    same(null, dbv_protection(['key' => 'pg', 'protect' => []], 'anything', $layout), 'nothing is listed, nothing is protected');
});

test('the layout protects a database by its id, and only that id', function () {
    $server = ['key' => 'pg', 'protect' => ['*prod*']];
    $layout = ['protected' => ['pg/shop', 'my/orders']];

    same('you', dbv_protection($server, 'shop', $layout), 'the id is in the layout');
    same(null, dbv_protection($server, 'orders', $layout), 'that id is on another server');
    same(null, dbv_protection($server, 'shop_old', $layout), 'a longer name is another database');
    same(null, dbv_protection($server, 'sho', $layout), 'a shorter name is another database');
    same(null, dbv_protection($server, 'shop', ['protected' => []]), 'not in the layout, not in the config');
    same('you', dbv_protection(['key' => 'my', 'protect' => []], 'orders', $layout), 'the same layout protects it on its own server');
});

test('a database the config protects says config, even when the layout protects it too', function () {
    $server = ['key' => 'pg', 'protect' => ['shop_live']];

    same('config', dbv_protection($server, 'shop_live', ['protected' => ['pg/shop_live']]));
    same('you', dbv_protection($server, 'shop_test', ['protected' => ['pg/shop_test']]), 'a database only the layout protects');
});

test('a saved layout keeps only the shape the page reads', function () {
    $clean = dbv_clean_layout([
        'groups' => [
            ['id' => 'u:1', 'label' => 'Mine', 'items' => ['pg/a', 'pg/a', 42, '', 'pg/b']],
            ['id' => 'c:not-mine', 'label' => 'x'],
            ['id' => 'u:2', 'label' => '   '],
            'junk',
        ],
        'order' => ['u:1', ['nested'], str_repeat('x', 301)],
        'hidden' => 'pg/c',
        'folded' => ['u:1' => true, 'u:2' => 'yes'],
        'extra' => 'dropped',
    ]);

    same([['id' => 'u:1', 'label' => 'Mine', 'items' => ['pg/a', 'pg/b']]], $clean['groups']);
    same(['u:1'], $clean['order']);
    same(['pg/c'], $clean['hidden']);
    same(['u:1' => true], (array) $clean['folded']);
    check(! isset($clean['extra']), 'unknown keys are dropped');
});

test('a saved layout keeps the protected databases the way it keeps the hidden ones', function () {
    $clean = dbv_clean_layout([
        'protected' => ['pg/a', 'pg/a', 42, '', ['nested'], null, str_repeat('x', 301), str_repeat('y', 300), 'pg/b'],
        'hidden' => ['pg/c'],
    ]);

    $protected = $clean['protected'] ?? 'missing';

    // The long one is compared by its length, so a failure does not print 300 letters.
    same([4, 300, 4], is_array($protected) ? array_map('strlen', $protected) : $protected, 'strings only, once each, up to 300 characters, in a list');
    same(['pg/a', 'pg/b'], is_array($protected) ? [$protected[0], $protected[2]] : $protected);
    same(['pg/c'], $clean['hidden'], 'the hidden databases are a list of their own');

    same([], dbv_clean_layout([])['protected'] ?? 'missing', 'a layout without the key has none, as a list');
    same([], dbv_clean_layout(['protected' => [42, '', null]])['protected'] ?? 'missing', 'nothing usable is left');
    same('[]', json_encode(dbv_clean_layout([])['protected'] ?? 'missing'), 'and the page gets [] for it');
});

test('a saved diagram view keeps only the shape the page reads', function () {
    $clean = dbv_clean_view([
        'name' => "  Payroll\n",
        'tables' => ['public.a', 'public.a', '', 7, ['nested'], str_repeat('x', 301), 'public.b'],
        'at' => ['public.a' => [1.6, '2'], 'public.b' => [INF, 0], 'public.c' => [0, 0], 'public.x' => 'far'],
        'layout' => 'sideways',
        'detail' => 'all',
        'extra' => 'dropped',
    ]);

    same('Payroll', $clean['name']);
    same(['public.a', 'public.b'], $clean['tables']);
    same(['public.a' => [2, 2]], (array) $clean['at'], 'only two finite numbers for a table in the view');
    same(['flow', 'all'], [$clean['layout'], $clean['detail']]);
    check(! isset($clean['extra']), 'unknown keys are dropped');
    same(null, dbv_clean_view(['name' => 'No tables', 'tables' => []]));
    same(null, dbv_clean_view(['name' => str_repeat('y', 61), 'tables' => ['public.a']]));
    same(null, dbv_clean_view('junk'));
});

test('an IN filter splits on commas and new lines and binds every item', function () {
    same(['t in (?, ?, ?)', ['a', 'b', "c'd"]], dbv_in('t', "a, b\nc'd,,"));
    same(['1 = 1', []], dbv_in('t', ' , '));
});
