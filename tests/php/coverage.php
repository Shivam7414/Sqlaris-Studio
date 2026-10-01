<?php

declare(strict_types=1);

// Line coverage, only when PCOV is loaded and COVERAGE_DIR names a folder.
// The test runner requires this file, and the test server loads it before
// every request, so both the unit tests and the API are measured. Each
// process writes what it ran to a file of its own; coverage-report.php adds
// them up. Without PCOV this does nothing, so the tests never need it.

if (extension_loaded('pcov') && ($dir = getenv('COVERAGE_DIR'))) {
    // PCOV instruments every file once it is enabled, but records nothing until asked to.
    \pcov\start();

    register_shutdown_function(function () use ($dir) {
        \pcov\stop();
        file_put_contents($dir.'/'.getmypid().'-'.hrtime(true).'.json', json_encode(\pcov\collect()));
        // The built-in server is one process for every request, so each one starts from nothing.
        \pcov\clear();
    });
}
