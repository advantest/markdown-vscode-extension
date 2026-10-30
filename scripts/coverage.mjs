// Merges the coverage of the unit tests and of the tests in VS Code into one report, and fails if it falls below
// the thresholds. Both runs write Istanbul's coverage-final.json below coverage/; only the extension's own sources in
// src/ are counted, not the libraries bundled with it.
//
//   node scripts/coverage.mjs

import { readFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const THRESHOLD = 80;
const REPORTS_DIR = 'coverage';
const SOURCES = resolve('src') + sep;

const coverageMap = libCoverage.createCoverageMap({});
let parts = 0;
for await (const file of glob(`${REPORTS_DIR}/*/coverage-final.json`)) {
	parts++;
	const data = JSON.parse(readFileSync(file, 'utf8'));
	for (const [path, fileCoverage] of Object.entries(data)) {
		// The runs may spell the drive letter of the same file differently.
		const normalised = resolve(path).replace(/^[a-z]:/, (drive) => drive.toUpperCase());
		if (normalised.toLowerCase().startsWith(SOURCES.toLowerCase())) {
			coverageMap.merge({ [normalised]: { ...fileCoverage, path: normalised } });
		}
	}
}
if (parts === 0) {
	console.error(`No coverage found in ${REPORTS_DIR}/*/coverage-final.json. Run "npm test" first.`);
	process.exit(1);
}

const context = libReport.createContext({ dir: REPORTS_DIR, coverageMap });
reports.create('text').execute(context);
reports.create('html', { subdir: 'html' }).execute(context);

const summary = coverageMap.getCoverageSummary();
let failed = false;
for (const metric of ['lines', 'branches', 'functions', 'statements']) {
	const percent = summary[metric].pct;
	if (percent < THRESHOLD) {
		console.error(`The coverage of ${metric}, ${percent} %, is below ${THRESHOLD} %.`);
		failed = true;
	}
}
process.exitCode = failed ? 1 : 0;
